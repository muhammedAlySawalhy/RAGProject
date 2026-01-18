import os
from dotenv import load_dotenv
from typing_extensions import TypedDict
from typing import Annotated
from langgraph.graph.message import add_messages
from langgraph.graph import StateGraph, START, END
from langchain_ollama import ChatOllama
from langchain.messages import HumanMessage, SystemMessage
load_dotenv()
from memory import mem_client

OLLAMA_HOST = os.getenv("OLLAMA_HOST", "http://localhost:11434")

llm = ChatOllama(
    model="llama3.1:latest",
    base_url=OLLAMA_HOST,
)

SYSTEM_PROMPT = """
You are a helpful AI Assistant who answers user query based on the available context retrieved from a PDF file along with page_contents and page number.

You should only answer the user based on the following context and navigate the user to open the right page number to know more.
"""

class State(TypedDict):
    messages: Annotated[list, add_messages]
    usr_id: str
    query: str

def memory_extractor(state: State):
    query = state.get("query", "")
    usr_id = state.get("usr_id", "")
    
    response = mem_client.search(
        query=query,
        user_id=usr_id,
    )
    return {"messages": [str(response)]}

def chatbot(state: State):
    response = llm.invoke(state.get("messages"))
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
        "query": query
    }
    updated_state = graph.stream(initial_state)
    final_response = None
    
    for chunk in updated_state:
        for node_name, node_output in chunk.items():
            if "messages" in node_output and node_output["messages"]:
                final_response = node_output["messages"][-1]
                yield final_response
    
    if final_response:
        mem_client.add(
            [
                {"role": "user", "content": query},
                {"role": "assistant", "content": final_response.content if hasattr(final_response, 'content') else str(final_response)},
            ],
            user_id=usr_id,
        )