import os
from typing import Annotated, Any

from dotenv import load_dotenv
from langchain.messages import HumanMessage, SystemMessage
from langchain_ollama import ChatOllama
from langgraph.graph import END, START, StateGraph
from langgraph.graph.message import add_messages
from typing_extensions import TypedDict

from memory import mem_client

load_dotenv()

OLLAMA_HOST = os.getenv("OLLAMA_HOST", "http://localhost:11434")

llm = ChatOllama(
    model="llama3.2",
    base_url=OLLAMA_HOST,
)

SYSTEM_PROMPT = """
You are a helpful AI Assistant who answers the user based on the available retrieved context and the conversation.

Rules:
- Prefer answering using the retrieved context when it is relevant.
- If the retrieved context does not contain enough information, say you don't know and ask the user to upload/ingest the relevant document(s) or provide more details.
- If the context includes location hints (e.g., filename, page number), guide the user to the most relevant location(s).
"""


class State(TypedDict):
    messages: Annotated[list, add_messages]
    usr_id: str
    memory_context: str


def _last_user_query(messages: list) -> str:
    for msg in reversed(messages or []):
        if isinstance(msg, HumanMessage):
            content = getattr(msg, "content", "")
            if isinstance(content, str):
                return content.strip()

            return str(content).strip()
    return ""


def _format_memories_for_prompt(
    memories: Any, max_items: int = 8, max_chars: int = 1200
) -> str:
    if not memories:
        return ""

    items = memories
    if isinstance(memories, dict) and "results" in memories:
        items = memories.get("results") or []

    if not isinstance(items, list):
        return str(items)

    lines: list[str] = []
    for item in items[:max_items]:
        if not isinstance(item, dict):
            continue

        text = (item.get("memory") or "").strip()
        meta = item.get("metadata") or {}
        filename = meta.get("filename")
        page = meta.get("page")

        header_bits = []
        if filename:
            header_bits.append(str(filename))
        if page is not None and page != "":
            header_bits.append(f"page {page}")

        header = f"[{' | '.join(header_bits)}]" if header_bits else "[memory]"
        if len(text) > max_chars:
            text = text[:max_chars].rstrip() + "…"

        if text:
            lines.append(f"{header} {text}")

    return "\n".join(lines)


def memory_extractor(state: State):
    usr_id = state.get("usr_id", "")
    query = _last_user_query(state.get("messages", []))

    # Single unified retrieval across all stored memories (documents, chat, etc.).
    hits = mem_client.search(
        query=query,
        user_id=usr_id,
        limit=5,
    )

    return {"memory_context": _format_memories_for_prompt(hits)}


def chatbot(state: State):
    mem_ctx = (state.get("memory_context", "") or "").strip()

    system = SYSTEM_PROMPT.strip()
    if mem_ctx:
        system = system + "\n\nRetrieved context:\n" + mem_ctx

    msgs = state.get("messages", [])
    if msgs and isinstance(msgs[0], SystemMessage):
        msgs = [SystemMessage(content=system)] + msgs[1:]
    else:
        msgs = [SystemMessage(content=system)] + msgs

    response = llm.invoke(msgs)
    return {"messages": [response]}


graph_builder = StateGraph(State)

graph_builder.add_node("extract_from_memory", memory_extractor)
graph_builder.add_node("chatbot", chatbot)

graph_builder.add_edge(START, "extract_from_memory")
graph_builder.add_edge("extract_from_memory", "chatbot")
graph_builder.add_edge("chatbot", END)

graph = graph_builder.compile()


def main(query: str = "", usr_id: str = ""):
    initial_state = {
        "messages": [SystemMessage(content=SYSTEM_PROMPT), HumanMessage(content=query)],
        "usr_id": usr_id,
        "memory_context": "",
    }

    # Cast to satisfy static typing around LangGraph's invoke input schema.
    result = graph.invoke(initial_state)  # type: ignore[arg-type]
    final_response = None

    if isinstance(result, dict):
        msgs = result.get("messages") or []
        if msgs:
            final_response = msgs[-1]

    if final_response:
        mem_client.add(
            [
                {"role": "user", "content": query},
                {"role": "assistant", "content": final_response.content},
            ],
            infer=False,
            user_id=usr_id,
            metadata={"source": "chat"},
        )
        return final_response.content

    return ""
