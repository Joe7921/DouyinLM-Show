from __future__ import annotations

import asyncio
from collections.abc import Callable
from contextlib import suppress
from datetime import UTC, datetime
from typing import Any

from sqlalchemy import update

from douyinlm.providers.errors import PipelineError, ProviderNotConfigured
from douyinlm.repositories.database import Database
from douyinlm.repositories.jobs import (
    append_job_event,
    claim_next_job,
    fail_job,
    finish_job,
)
from douyinlm.repositories.models import Job

JobHandler = Callable[[str, dict[str, Any]], None]


class JobRunner:
    def __init__(self, database: Database, handlers: dict[str, JobHandler] | None = None) -> None:
        self._database = database
        self._handlers = handlers or {}
        self._task: asyncio.Task[None] | None = None
        self._stop_event = asyncio.Event()
        self._wake_event = asyncio.Event()
        self.last_heartbeat: datetime | None = None

    @property
    def running(self) -> bool:
        return self._task is not None and not self._task.done()

    async def start(self) -> None:
        if self.running:
            return
        self._recover_interrupted_jobs()
        self._stop_event.clear()
        self._wake_event.clear()
        self._task = asyncio.create_task(self._run(), name="douyinlm-job-runner")
        await asyncio.sleep(0)

    async def stop(self) -> None:
        self._stop_event.set()
        self._wake_event.set()
        if self._task is not None:
            await self._task
        self._task = None

    def notify(self) -> None:
        self._wake_event.set()

    def _recover_interrupted_jobs(self) -> None:
        with self._database.session() as session:
            session.execute(
                update(Job)
                .where(Job.status == "running")
                .values(status="queued", last_error="Recovered after service restart")
            )
            session.commit()

    async def _run(self) -> None:
        while not self._stop_event.is_set():
            self.last_heartbeat = datetime.now(UTC)
            claimed = await asyncio.to_thread(claim_next_job, self._database)
            if claimed is None:
                self._wake_event.clear()
                with suppress(TimeoutError):
                    await asyncio.wait_for(self._wake_event.wait(), timeout=0.5)
                continue
            await asyncio.to_thread(self._execute, claimed.id, claimed.kind, claimed.payload)

    def _execute(self, job_id: str, kind: str, payload: dict[str, Any]) -> None:
        handler = self._handlers.get(kind)
        if handler is None:
            error = PipelineError("job_handler_missing", f"没有可执行 {kind} 的任务处理器。")
            fail_job(self._database, job_id, message=error.message, blocked=False)
            append_job_event(
                self._database,
                job_id,
                stage="failed",
                progress=100,
                message=error.message,
            )
            return
        try:
            handler(job_id, payload)
        except PipelineError as exc:
            blocked = isinstance(exc, ProviderNotConfigured)
            append_job_event(
                self._database,
                job_id,
                stage="blocked" if blocked else "failed",
                progress=100,
                message=exc.message,
                detail={"code": exc.code, "retryable": exc.retryable},
            )
            fail_job(self._database, job_id, message=exc.message, blocked=blocked)
            return
        except Exception as exc:
            message = f"后台任务出现未预期错误（{type(exc).__name__}）。"
            fail_job(self._database, job_id, message=message, blocked=False)
            append_job_event(
                self._database,
                job_id,
                stage="failed",
                progress=100,
                message=message,
            )
            return
        finish_job(self._database, job_id)
