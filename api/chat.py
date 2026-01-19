import uuid
from datetime import datetime
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status
from rq.job import Job, JobStatus
from sqlalchemy import Column, DateTime, String, Text
from sqlalchemy.orm import Session

from api.auth import Base, CurrentUser, engine, get_current_user, get_db_session
from rq_queue.client.rq_client import queue
from rq_queue.queues.worker import process_query

router = APIRouter()




class JobRecord(Base):


    __tablename__ = "job_records"

    id = Column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    job_id = Column(String(100), unique=True, nullable=False, index=True)
    user_id = Column(String(36), nullable=False, index=True)
    query = Column(Text, nullable=False)
    status = Column(String(50), default="queued")
    result = Column(Text, nullable=True)
    error = Column(Text, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)


# Create the table
try:
    Base.metadata.create_all(bind=engine)
except Exception as e:
    print(f"Warning: Could not create job_records table: {e}")



def create_job_record(db: Session, job_id: str, user_id: str, query: str) -> JobRecord:

    record = JobRecord(
        job_id=job_id,
        user_id=user_id,
        query=query,
        status="queued",
    )
    db.add(record)
    db.commit()
    db.refresh(record)
    return record


def get_job_record(db: Session, job_id: str) -> Optional[JobRecord]:

    return db.query(JobRecord).filter(JobRecord.job_id == job_id).first()


def update_job_status(db: Session, job_id: str, status: str, result: str = None, error: str = None) -> Optional[JobRecord]:

    record = get_job_record(db, job_id)
    if record:
        record.status = status
        if result:
            record.result = result
        if error:
            record.error = error
        db.commit()
        db.refresh(record)
    return record


def get_user_jobs(db: Session, user_id: str, limit: int = 50) -> list[JobRecord]:
    """Get all jobs for a specific user."""
    return (
        db.query(JobRecord)
        .filter(JobRecord.user_id == user_id)
        .order_by(JobRecord.created_at.desc())
        .limit(limit)
        .all()
    )




@router.post("/chat")
def chat(
    query: str = Query(..., description="The chat query of user"),
    current_user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db_session),
):

    job = queue.enqueue(
        process_query,
        query,
        current_user.user_id,
    )


    create_job_record(db, job.id, current_user.user_id, query)

    return {
        "status": "queued",
        "job_id": job.id,
        "job_status": job.get_status(),
        "user_id": current_user.user_id,
    }


@router.get("/job-status")
def get_result(
    job_id: str = Query(..., description="Job ID"),
    current_user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db_session),
):

    job_record = get_job_record(db, job_id)

    if job_record is None:
        return {"status": "not_found"}


    if job_record.user_id != current_user.user_id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Access denied: This job belongs to another user",
        )

    job: Job = queue.fetch_job(job_id)

    if job is None:

        return {
            "status": job_record.status,
            "result": job_record.result,
            "error": job_record.error,
        }

    status_value = job.get_status()

    if status_value == JobStatus.FINISHED:

        update_job_status(db, job_id, "finished", result=str(job.result) if job.result else None)
        return {
            "status": "finished",
            "result": job.result,
        }

    if status_value == JobStatus.FAILED:

        error_msg = str(job.exc_info) if job.exc_info else "Unknown error"
        update_job_status(db, job_id, "failed", error=error_msg)
        return {
            "status": "failed",
            "error": error_msg,
        }


    update_job_status(db, job_id, str(status_value))

    return {
        "status": status_value,
    }


@router.get("/jobs")
def list_jobs(
    limit: int = Query(default=20, ge=1, le=100, description="Number of jobs to return"),
    current_user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db_session),
):
    """
    List all jobs for the current authenticated user.

    Returns job history with status and timestamps.
    """
    jobs = get_user_jobs(db, current_user.user_id, limit)

    return {
        "status": "success",
        "user_id": current_user.user_id,
        "count": len(jobs),
        "jobs": [
            {
                "job_id": job.job_id,
                "query": job.query[:100] + "..." if len(job.query) > 100 else job.query,
                "status": job.status,
                "created_at": job.created_at.isoformat(),
                "updated_at": job.updated_at.isoformat(),
            }
            for job in jobs
        ],
    }


@router.get("/chat-history")
def get_chat_history(
    limit: int = Query(default=20, ge=1, le=100, description="Number of recent messages"),
    current_user: CurrentUser = Depends(get_current_user),
):

    from memory import mem_client

    try:

        memories = mem_client.search(
            query="",
            user_id=current_user.user_id,
            limit=limit,
        )


        chat_memories = []
        results = memories.get("results", []) if isinstance(memories, dict) else memories

        for memory in results:
            if isinstance(memory, dict):
                metadata = memory.get("metadata", {})
                if metadata.get("source") == "chat":
                    chat_memories.append({
                        "content": memory.get("memory", ""),
                        "created_at": memory.get("created_at"),
                        "metadata": metadata,
                    })

        return {
            "status": "success",
            "user_id": current_user.user_id,
            "count": len(chat_memories),
            "history": chat_memories,
        }

    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to retrieve chat history: {str(e)}",
        )
