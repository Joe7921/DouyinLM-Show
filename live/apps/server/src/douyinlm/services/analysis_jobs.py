from __future__ import annotations

from douyinlm.repositories.database import Database
from douyinlm.repositories.jobs import append_job_event
from douyinlm.repositories.models import Job, Video


def queue_reanalysis(database: Database, video_id: str) -> str | None:
    """Create a forced analysis job without copying any prior model output."""
    with database.session() as session:
        video = session.get(Video, video_id)
        if video is None:
            return None
        job = Job(
            kind="analyze_video",
            status="queued",
            payload_json={"video_id": video.id, "force": True},
        )
        session.add(job)
        session.flush()
        video.status = "queued"
        video.current_job_id = job.id
        video.error_code = None
        video.error_message = None
        session.commit()
        job_id = job.id
    append_job_event(
        database,
        job_id,
        stage="queued",
        progress=0,
        message="已创建全新解析版本，不复用旧模型结果。",
    )
    return job_id
