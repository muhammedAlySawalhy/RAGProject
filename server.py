from dotenv import load_dotenv
load_dotenv()

from fastapi import FastAPI
from api.pdf_ingest import router as pdf_router
from api.chat import router as chat_router


app = FastAPI()

# Include API routes
app.include_router(pdf_router, prefix="/api", tags=["PDF"])
app.include_router(chat_router, prefix="/api", tags=["Chat"])

@app.get('/')
def root():
    return {"status": 'Server is up and running'}
