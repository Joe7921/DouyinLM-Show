from __future__ import annotations

from collections.abc import Iterable

from sqlalchemy import select

from douyinlm.domain.schemas import VideoUnderstandingBundle
from douyinlm.providers.errors import PipelineError
from douyinlm.repositories.database import Database
from douyinlm.repositories.models import AnalysisRun, Video, VideoUnderstanding


def load_latest_understanding_bundles(
    database: Database,
    video_ids: Iterable[str] | None = None,
    *,
    require_all: bool = True,
) -> list[VideoUnderstandingBundle]:
    """Return one validated latest-successful understanding bundle per video."""
    requested = list(dict.fromkeys(video_ids)) if video_ids is not None else None
    requested_set = set(requested or [])

    with database.session() as session:
        statement = (
            select(Video, VideoUnderstanding, AnalysisRun)
            .join(VideoUnderstanding, VideoUnderstanding.video_id == Video.id)
            .join(AnalysisRun, AnalysisRun.id == VideoUnderstanding.analysis_run_id)
            .where(AnalysisRun.status == "completed")
            .order_by(Video.created_at, Video.id, AnalysisRun.run_number.desc())
        )
        if requested is not None:
            if not requested:
                return []
            statement = statement.where(Video.id.in_(requested_set))
        rows = session.execute(statement).all()

    latest_by_video: dict[str, VideoUnderstandingBundle] = {}
    for video, understanding, _run in rows:
        if video.id in latest_by_video:
            continue
        bundle = VideoUnderstandingBundle.model_validate(understanding.bundle_json)
        if bundle.video_id != video.id or bundle.source_hash != video.source_hash:
            raise PipelineError(
                "understanding_source_mismatch",
                "视频理解包与原视频身份不一致，已拒绝向上层提供。",
            )
        bundle = bundle.model_copy(
            update={
                "title": video.title,
                "author": video.author,
                "source_url": video.source_url,
            }
        )
        latest_by_video[video.id] = bundle

    if requested is not None:
        missing = [video_id for video_id in requested if video_id not in latest_by_video]
        if missing and require_all:
            raise PipelineError(
                "understanding_not_ready",
                f"所选范围内有 {len(missing)} 条视频尚无成功理解包。",
                retryable=True,
            )
        return [latest_by_video[video_id] for video_id in requested if video_id in latest_by_video]
    return list(latest_by_video.values())
