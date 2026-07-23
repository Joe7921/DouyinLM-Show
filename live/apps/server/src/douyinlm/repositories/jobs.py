from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from sqlalchemy import func, select

from douyinlm.repositories.database import Database
from douyinlm.repositories.models import Job, JobEvent


@dataclass(frozen=True)
class ClaimedJob:
    id: str
    kind: str
    payload: dict[str, Any]


def append_job_event(
    database: Database,
    job_id: str,
    *,
    stage: str,
    progress: int,
    message: str,
    detail: dict[str, Any] | None = None,
) -> JobEvent:
    with database.session() as session:
        sequence = session.scalar(
            select(func.coalesce(func.max(JobEvent.sequence), 0) + 1).where(
                JobEvent.job_id == job_id
            )
        )
        event = JobEvent(
            job_id=job_id,
            sequence=int(sequence or 1),
            stage=stage,
            progress=max(0, min(100, progress)),
            message=message,
            detail_json=detail or {},
        )
        session.add(event)
        session.commit()
        session.refresh(event)
        return event


def claim_next_job(database: Database) -> ClaimedJob | None:
    with database.session() as session:
        job = session.scalar(
            select(Job).where(Job.status == "queued").order_by(Job.created_at).limit(1)
        )
        if job is None:
            return None
        job.status = "running"
        job.attempts += 1
        job.last_error = None
        session.commit()
        return ClaimedJob(id=job.id, kind=job.kind, payload=dict(job.payload_json))


def finish_job(database: Database, job_id: str) -> None:
    with database.session() as session:
        job = session.get(Job, job_id)
        if job is None:
            return
        job.status = "completed"
        job.last_error = None
        session.commit()


def fail_job(database: Database, job_id: str, *, message: str, blocked: bool) -> None:
    with database.session() as session:
        job = session.get(Job, job_id)
        if job is None:
            return
        job.status = "blocked" if blocked else "failed"
        job.last_error = message[:1000]
        session.commit()
