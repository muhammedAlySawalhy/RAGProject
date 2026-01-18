from fastapi import Query

from rq_queue.client.rq_client import queue
from rq_queue.queues.worker import process_query
from fastapi import APIRouter
router = APIRouter()
@router.post('/chat')
def chat(
        usr_id: str = Query(..., description="The user ID"),
        query: str = Query(..., description="The chat query of user")
):
    job = queue.enqueue(process_query, query,usr_id)

    return { "status": "queued", "job_id": job.id }

@router.get('/job-status')
def get_result(
        job_id: str = Query(..., description="Job ID")
)-> dict:
    job = queue.fetch_job(job_id=job_id)
    result = job.return_value()
    
    return { "result":  result}