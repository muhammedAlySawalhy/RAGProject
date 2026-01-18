# apis/pdf_ingest.py
from fastapi import UploadFile, File, Form
from memory import mem_client as client
from fastapi import APIRouter
from pypdf import PdfReader
import io

router = APIRouter()

@router.post("/ingest-pdf")
async def ingest_pdf(
    file: UploadFile = File(...),
    user_name: str = Form(...)
):
    pdf_content = await file.read()
    
    # Extract text from PDF using pypdf
    pdf_reader = PdfReader(io.BytesIO(pdf_content))
    
    extracted_text = ""
    for page_num, page in enumerate(pdf_reader.pages, 1):
        page_text = page.extract_text()
        if page_text:
            extracted_text += f"\n--- Page {page_num} ---\n{page_text}"
    
    # Add extracted text to memory as plain string content
    pdf_message = {
        "role": "user",
        "content": f"PDF Document: {file.filename}\n{extracted_text}"
    }

    result = client.add([pdf_message], user_id=user_name)
    
    return {
        "status": "success", 
        "result": result, 
        "filename": file.filename,
        "pages": len(pdf_reader.pages)
    }