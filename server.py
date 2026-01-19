from dotenv import load_dotenv
load_dotenv()

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from api.auth import router as auth_router
from api.pdf_ingest import router as documents_router
from api.chat import router as chat_router


app = FastAPI(
    title="RAG Pipeline API",
    description="Enterprise RAG Pipeline with Authentication",
    version="1.0.0",
)

# CORS middleware for frontend
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # Configure appropriately for production
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Include API routes
app.include_router(auth_router, prefix="/api/auth", tags=["Authentication"])
app.include_router(documents_router, prefix="/api", tags=["Documents"])
app.include_router(chat_router, prefix="/api", tags=["Chat"])


@app.get("/")
def root():
    return {"status": "Server is up and running"}


@app.get("/health")
def health_check():
    return {"status": "healthy"}
