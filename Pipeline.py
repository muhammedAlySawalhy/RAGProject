import logging
import os
import threading
from typing import Annotated, Any

from dotenv import load_dotenv
from langchain.messages import HumanMessage, SystemMessage
from langchain_ollama import ChatOllama
from langgraph.graph import END, START, StateGraph
from langgraph.graph.message import add_messages
from typing_extensions import TypedDict

from memory import mem_client

load_dotenv()

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

OLLAMA_HOST = os.getenv("OLLAMA_HOST", "http://localhost:11434")
MODEL_NAME = os.getenv("OLLAMA_MODEL", "llama3.2:1b")

# Thread-local storage for per-worker LLM instances
_thread_local = threading.local()


def get_llm() -> ChatOllama:
    """
    Get a thread/worker-local LLM instance.
    
    Each worker process/thread gets its own LLM instance to enable
    true parallel processing without contention.
    """
    if not hasattr(_thread_local, "llm"):
        logger.info(f"Initializing new LLM instance for worker (model={MODEL_NAME}, host={OLLAMA_HOST})")
        _thread_local.llm = ChatOllama(
            model=MODEL_NAME,
            base_url=OLLAMA_HOST,
        )
    return _thread_local.llm

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
    memories: Any, max_items: int = 10, max_chars: int = 1500
) -> str:
    """
    Format memory search results for the LLM prompt.
    Handles multiple possible structures from Mem0:
    - {"results": [...]} (v1.1+ format)
    - {"memories": [...]} (alternative format)
    - Direct list of items
    - Each item can have: memory/text/content/data fields
    """
    if not memories:
        logger.warning("No memories to format (empty/None)")
        return ""

    # Extract the list of items from various possible structures
    items = memories
    if isinstance(memories, dict):
        # Try different possible keys
        items = (
            memories.get("results") 
            or memories.get("memories") 
            or memories.get("data")
            or []
        )
        # Log what we received
        logger.info(f"Memory search returned dict with keys: {list(memories.keys())}")
    
    if not isinstance(items, list):
        logger.warning(f"Unexpected memories type: {type(items)}, converting to string")
        return str(items)

    logger.info(f"Processing {len(items)} memory items")
    
    lines: list[str] = []
    for idx, item in enumerate(items[:max_items]):
        if not isinstance(item, dict):
            # Handle non-dict items (raw strings)
            if item:
                lines.append(f"[memory] {str(item)[:max_chars]}")
            continue

        # Try multiple possible field names for the text content
        # Mem0 stores in "data" payload field but returns as "memory"
        text = (
            item.get("memory")  # v1.1+ standard field
            or item.get("text")  # alternative
            or item.get("content")  # alternative
            or item.get("data")  # raw payload field
            or ""
        )
        if isinstance(text, dict):
            # Sometimes content is nested
            text = text.get("content") or text.get("text") or str(text)
        text = str(text).strip()

        # Extract metadata - can be at top level or nested
        meta = item.get("metadata") or {}
        
        # Also check for top-level promoted fields (Mem0 v1.1+)
        filename = meta.get("filename") or item.get("filename")
        page = meta.get("page") or item.get("page")
        source = meta.get("source") or item.get("source")
        score = item.get("score")
        
        # Build header with available metadata
        header_bits = []
        if filename:
            header_bits.append(str(filename))
        if page is not None and page != "":
            header_bits.append(f"page {page}")
        if source and source != "document":
            header_bits.append(f"source: {source}")
        if score is not None:
            header_bits.append(f"score: {score:.2f}")

        header = f"[{' | '.join(header_bits)}]" if header_bits else "[memory]"
        
        # Truncate long text
        if len(text) > max_chars:
            text = text[:max_chars].rstrip() + "…"

        if text:
            lines.append(f"{header} {text}")
            logger.debug(f"Item {idx}: {header} - {len(text)} chars")
        else:
            logger.warning(f"Item {idx} has empty text, keys: {list(item.keys())}")

    result = "\n\n".join(lines)
    logger.info(f"Formatted {len(lines)} memories into {len(result)} chars")
    return result


def memory_extractor(state: State):
    """Extract relevant memories for the user's query."""
    usr_id = state.get("usr_id", "")
    query = _last_user_query(state.get("messages", []))

    if not query:
        logger.warning("No query found in messages, skipping memory extraction")
        return {"memory_context": ""}

    if not usr_id:
        logger.warning("No user_id provided, skipping memory extraction")
        return {"memory_context": ""}

    logger.info(f"Searching memories for user '{usr_id}' with query: '{query[:80]}...'")

    try:
        # Single unified retrieval across all stored memories (documents, chat, etc.).
        hits = mem_client.search(
            query=query,
            user_id=usr_id,
            limit=10,  # Increased limit for better context
        )
        
        # Log the raw response for debugging
        logger.info(f"Memory search returned type: {type(hits)}")
        if isinstance(hits, dict):
            logger.info(f"Response keys: {list(hits.keys())}")
            results = hits.get("results") or hits.get("memories") or []
            logger.info(f"Found {len(results)} results")
            if results and len(results) > 0:
                # Log first result structure for debugging
                first = results[0]
                logger.info(f"First result keys: {list(first.keys()) if isinstance(first, dict) else type(first)}")
        elif isinstance(hits, list):
            logger.info(f"Direct list with {len(hits)} items")
        else:
            logger.warning(f"Unexpected response type: {type(hits)}")

    except Exception as e:
        logger.error(f"Memory search failed: {e}", exc_info=True)
        hits = None

    formatted = _format_memories_for_prompt(hits)
    
    if formatted:
        logger.info(f"Memory context ready: {len(formatted)} chars")
    else:
        logger.warning("No memory context extracted - check if documents are ingested for this user")
    
    return {"memory_context": formatted}


def chatbot(state: State):
    """Generate response using LLM with memory context."""
    mem_ctx = (state.get("memory_context", "") or "").strip()

    system = SYSTEM_PROMPT.strip()
    if mem_ctx:
        system = system + "\n\nRetrieved context:\n" + mem_ctx
        logger.info(f"Chatbot using {len(mem_ctx)} chars of memory context")
    else:
        logger.warning("Chatbot has NO memory context - will answer without document knowledge")

    msgs = state.get("messages", [])
    if msgs and isinstance(msgs[0], SystemMessage):
        msgs = [SystemMessage(content=system)] + msgs[1:]
    else:
        msgs = [SystemMessage(content=system)] + msgs

    logger.info(f"Invoking LLM with {len(msgs)} messages")
    
    # Get worker-local LLM instance for parallel processing
    llm = get_llm()
    response = llm.invoke(msgs)
    logger.info(f"LLM response length: {len(response.content)} chars")
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
         
            user_id=usr_id,
            metadata={"source": "chat"},
        )
        return final_response.content

    return ""
