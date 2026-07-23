from __future__ import annotations

import asyncio
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, HTTPException, Request, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles

from douyinlm.api.routes import router
from douyinlm.jobs.runner import JobRunner
from douyinlm.providers.compiler import (
    ArkCompilerProvider,
    CompilerProvider,
    DeepSeekCompilerProvider,
    FailoverCompilerProvider,
)
from douyinlm.providers.errors import PipelineError
from douyinlm.repositories.database import Database, run_migrations
from douyinlm.services.collection_artifact_compiler import CollectionArtifactCompiler
from douyinlm.services.importer import VideoImporter
from douyinlm.settings import Settings, get_settings
from douyinlm.workflows.video_pipeline import VideoPipeline


def create_app(
    settings: Settings | None = None,
    *,
    compiler_provider: CompilerProvider | None = None,
) -> FastAPI:
    app_settings = settings or get_settings()

    @asynccontextmanager
    async def lifespan(app: FastAPI) -> AsyncIterator[None]:
        app_settings.ensure_runtime_directories()
        run_migrations(app_settings.database_url)
        database = Database(app_settings.database_url)
        pipeline = VideoPipeline(database, app_settings)
        if compiler_provider is not None:
            active_compiler_provider = compiler_provider
        else:
            ark_provider = ArkCompilerProvider(app_settings)
            active_compiler_provider = (
                FailoverCompilerProvider(
                    ark_provider,
                    DeepSeekCompilerProvider(app_settings),
                )
                if app_settings.deepseek_api_key is not None
                else ark_provider
            )
        artifact_compiler = CollectionArtifactCompiler(database, active_compiler_provider)
        job_runner = JobRunner(
            database,
            {
                "analyze_video": pipeline.handle_job,
                "compile_workspace": artifact_compiler.handle_compile_job,
                "revise_artifact": artifact_compiler.handle_revision_job,
            },
        )
        importer = VideoImporter(database, app_settings, job_runner.notify)

        app.state.settings = app_settings
        app.state.database = database
        app.state.pipeline = pipeline
        app.state.importer = importer
        app.state.artifact_compiler = artifact_compiler
        app.state.job_runner = job_runner
        await job_runner.start()
        warmup_task = _start_compiler_warmup(active_compiler_provider)
        app.state.compiler_warmup_task = warmup_task
        try:
            yield
        finally:
            await job_runner.stop()
            if warmup_task is not None:
                await warmup_task
            database.close()

    app = FastAPI(
        title="douyinLM local API",
        version="0.2.0",
        docs_url="/api/docs",
        openapi_url="/api/openapi.json",
        lifespan=lifespan,
    )
    app.add_middleware(
        CORSMiddleware,
        allow_origins=["http://127.0.0.1:5173", "http://localhost:5173"],
        allow_credentials=False,
        allow_methods=["*"],
        allow_headers=["*"],
    )
    app.include_router(router)

    @app.exception_handler(PipelineError)
    async def pipeline_error_handler(_request: Request, exc: PipelineError) -> JSONResponse:
        return JSONResponse(
            status_code=getattr(exc, "status_code", status.HTTP_400_BAD_REQUEST),
            content={
                "code": exc.code,
                "message": exc.message,
                "retryable": exc.retryable,
            },
        )

    _mount_frontend(app, app_settings.resolved_web_dist_dir)
    return app


def _mount_frontend(app: FastAPI, dist_dir: Path) -> None:
    index_file = dist_dir / "index.html"
    assets_dir = dist_dir / "assets"

    if not index_file.is_file():

        @app.get("/", include_in_schema=False)
        def frontend_not_built() -> JSONResponse:
            return JSONResponse(
                {
                    "status": "frontend_not_built",
                    "message": "Run scripts/build-release.cmd or use the Vite dev server.",
                }
            )

        return

    if assets_dir.is_dir():
        app.mount("/assets", StaticFiles(directory=assets_dir), name="assets")

    @app.get("/", include_in_schema=False)
    @app.get("/{requested_path:path}", include_in_schema=False)
    def frontend(request: Request, requested_path: str = "") -> FileResponse:
        if requested_path.startswith("api/"):
            raise HTTPException(status_code=404, detail="API route not found")

        candidate = (dist_dir / requested_path).resolve()
        if candidate.is_file() and candidate.is_relative_to(dist_dir.resolve()):
            return FileResponse(candidate)

        accepts_html = requested_path == "" or "text/html" in request.headers.get(
            "accept", "text/html"
        )
        if not accepts_html:
            raise HTTPException(status_code=404, detail="File not found")
        return FileResponse(index_file)


app = create_app()


def _start_compiler_warmup(provider: CompilerProvider) -> asyncio.Task[None] | None:
    warmup = getattr(provider, "warmup", None)
    if not callable(warmup):
        return None

    async def run() -> None:
        try:
            # Let readiness and the first page load win the GIL before importing the SDK.
            await asyncio.sleep(1.0)
            await asyncio.to_thread(warmup)
        except Exception:
            # Warmup is an optimization only. The real call still reports its exact failure.
            return

    return asyncio.create_task(run(), name="douyinlm-compiler-warmup")
