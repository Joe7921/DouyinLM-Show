from __future__ import annotations

import hashlib
import os
from collections.abc import Callable
from pathlib import Path
from uuid import uuid4

from fastapi import UploadFile
from sqlalchemy import select

from douyinlm.domain.schemas import (
    ImportedVideo,
    ImportManifest,
    ImportManifestEntry,
    ImportResponse,
)
from douyinlm.providers.errors import PipelineError
from douyinlm.repositories.database import Database
from douyinlm.repositories.jobs import append_job_event
from douyinlm.repositories.models import Job, PermissionRecord, Video, VideoAsset
from douyinlm.settings import Settings

_ALLOWED_EXTENSIONS = {".mp4", ".mov", ".mkv", ".webm"}
_CHUNK_SIZE = 1024 * 1024


class VideoImporter:
    def __init__(
        self,
        database: Database,
        settings: Settings,
        notify_runner: Callable[[], None],
    ) -> None:
        self._database = database
        self._settings = settings
        self._notify_runner = notify_runner

    async def import_uploads(
        self,
        uploads: list[UploadFile],
        *,
        manifest: ImportManifest,
        permission_scope: str,
    ) -> ImportResponse:
        entries = {entry.filename.casefold(): entry for entry in manifest.videos}
        items: list[ImportedVideo] = []
        for upload in uploads:
            filename = self._validate_filename(upload.filename)
            if upload.content_type and not (
                upload.content_type.startswith("video/")
                or upload.content_type == "application/octet-stream"
            ):
                raise PipelineError(
                    "invalid_mime_type",
                    f"{filename} 不是可接受的视频 MIME 类型。",
                )
            entry = entries.get(filename.casefold()) or ImportManifestEntry(filename=filename)
            temp_path, source_hash, size_bytes = await self._write_upload(upload)
            try:
                item = self._finalize_import(
                    temp_path=temp_path,
                    filename=filename,
                    mime_type=upload.content_type,
                    source_hash=source_hash,
                    size_bytes=size_bytes,
                    entry=entry,
                    default_permission_scope=permission_scope,
                )
            finally:
                temp_path.unlink(missing_ok=True)
            items.append(item)
        if items:
            self._notify_runner()
        return ImportResponse(items=items)

    def import_path(
        self,
        source: Path,
        *,
        entry: ImportManifestEntry,
        permission_scope: str,
        mime_type: str = "video/mp4",
    ) -> ImportedVideo:
        filename = self._validate_filename(source.name)
        incoming = self._settings.resolved_data_dir / "incoming" / f"{uuid4()}.part"
        digest = hashlib.sha256()
        size_bytes = 0
        with source.open("rb") as reader, incoming.open("xb") as writer:
            while chunk := reader.read(_CHUNK_SIZE):
                size_bytes += len(chunk)
                if size_bytes > self._settings.max_upload_bytes:
                    raise PipelineError("file_too_large", f"{filename} 超过导入大小上限。")
                digest.update(chunk)
                writer.write(chunk)
        try:
            item = self._finalize_import(
                temp_path=incoming,
                filename=filename,
                mime_type=mime_type,
                source_hash=digest.hexdigest(),
                size_bytes=size_bytes,
                entry=entry,
                default_permission_scope=permission_scope,
            )
        finally:
            incoming.unlink(missing_ok=True)
        self._notify_runner()
        return item

    async def _write_upload(self, upload: UploadFile) -> tuple[Path, str, int]:
        incoming = self._settings.resolved_data_dir / "incoming" / f"{uuid4()}.part"
        digest = hashlib.sha256()
        size_bytes = 0
        try:
            with incoming.open("xb") as writer:
                while chunk := await upload.read(_CHUNK_SIZE):
                    size_bytes += len(chunk)
                    if size_bytes > self._settings.max_upload_bytes:
                        raise PipelineError(
                            "file_too_large",
                            f"{upload.filename or '视频'} 超过导入大小上限。",
                        )
                    digest.update(chunk)
                    writer.write(chunk)
        except Exception:
            incoming.unlink(missing_ok=True)
            raise
        finally:
            await upload.close()
        if size_bytes == 0:
            incoming.unlink(missing_ok=True)
            raise PipelineError("empty_file", "不能导入空文件。")
        return incoming, digest.hexdigest(), size_bytes

    def _finalize_import(
        self,
        *,
        temp_path: Path,
        filename: str,
        mime_type: str | None,
        source_hash: str,
        size_bytes: int,
        entry: ImportManifestEntry,
        default_permission_scope: str,
    ) -> ImportedVideo:
        with self._database.session() as session:
            existing = session.scalar(select(Video).where(Video.source_hash == source_hash))
            if existing is not None:
                return ImportedVideo(
                    video_id=existing.id,
                    job_id=existing.current_job_id,
                    filename=filename,
                    duplicate=True,
                )

        extension = Path(filename).suffix.lower()
        original_dir = self._settings.resolved_data_dir / "originals" / source_hash[:2]
        original_dir.mkdir(parents=True, exist_ok=True)
        original_path = original_dir / f"{source_hash}{extension}"
        if not original_path.exists():
            os.replace(temp_path, original_path)

        video = Video(
            title=(entry.title or Path(filename).stem)[:300],
            author=(entry.author or None),
            source_url=(entry.source_url or None),
            source_hash=source_hash,
            original_filename=filename[:300],
            mime_type=mime_type,
            file_size_bytes=size_bytes,
            status="queued",
        )
        job = Job(kind="analyze_video", status="queued", payload_json={})
        with self._database.session() as session:
            session.add(video)
            session.flush()
            job.payload_json = {"video_id": video.id, "force": False}
            session.add(job)
            session.flush()
            video.current_job_id = job.id
            session.add(
                VideoAsset(
                    video_id=video.id,
                    kind="original",
                    relative_path=original_path.relative_to(
                        self._settings.resolved_data_dir
                    ).as_posix(),
                    sha256=source_hash,
                    mime_type=mime_type,
                    size_bytes=size_bytes,
                )
            )
            session.add(
                PermissionRecord(
                    video_id=video.id,
                    author=entry.author,
                    source_url=entry.source_url,
                    scope=entry.permission_scope or default_permission_scope,
                    evidence_path=entry.permission_evidence_path,
                    confirmed_by_user=True,
                )
            )
            session.commit()
        append_job_event(
            self._database,
            job.id,
            stage="queued",
            progress=0,
            message="视频已安全导入，等待后台理解。",
        )
        return ImportedVideo(
            video_id=video.id,
            job_id=job.id,
            filename=filename,
            duplicate=False,
        )

    @staticmethod
    def _validate_filename(raw_filename: str | None) -> str:
        if not raw_filename or "\x00" in raw_filename:
            raise PipelineError("invalid_filename", "视频文件名无效。")
        filename = Path(raw_filename.replace("\\", "/")).name
        if Path(filename).suffix.lower() not in _ALLOWED_EXTENSIONS:
            raise PipelineError(
                "unsupported_extension",
                f"{filename} 不是 mp4、mov、mkv 或 webm。",
            )
        return filename
