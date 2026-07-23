from __future__ import annotations

import argparse
import hashlib
import json
import sqlite3
import time
from collections import Counter
from contextlib import suppress
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from pathlib import Path
from threading import Lock
from typing import Any

from fastapi.testclient import TestClient
from sqlalchemy import func, select

from douyinlm.domain.schemas import ArtifactDocument, ProvenanceDetail, WorkspaceDetail
from douyinlm.main import create_app
from douyinlm.providers.compiler import ArkCompilerProvider, CompilerProvider
from douyinlm.providers.errors import PipelineError
from douyinlm.repositories.database import Database
from douyinlm.repositories.models import (
    Artifact,
    ArtifactVersion,
    JobEvent,
    ProviderCall,
    Workspace,
)
from douyinlm.services.collection_artifact_compiler import (
    CollectionArtifactCompiler,
    has_direct_video_support,
)
from douyinlm.settings import Settings

RUN7_GOAL = (
    "我准备在晴天白天去海边用手机给朋友拍自然互动人像，"
    "生成一张现场拍摄任务卡"
)
RUN7_CLARIFICATION = "使用手机，优先自然互动，现场光线变化时允许条件化调整。"
RUN7_REVISION = "压缩成一屏小纸条"
RUN7_EVIDENCE_FILE = "run7-evidence.json"
RUN7_WORKSPACE_FILE = "workspace-terminal.json"
UTC_PLUS_8 = timezone(timedelta(hours=8))
_TOOL_PHASES = {
    "emit_workspace_compilation": "compile",
    "emit_artifact_revision": "revision",
}


@dataclass
class ProviderAttemptLedger:
    max_total: int = 4
    max_by_phase: dict[str, int] = field(
        default_factory=lambda: {"compile": 2, "revision": 2}
    )
    _total: int = field(default=0, init=False, repr=False)
    _by_phase: Counter[str] = field(default_factory=Counter, init=False, repr=False)
    _lock: Lock = field(default_factory=Lock, init=False, repr=False)

    def observe(self, tool_name: str, _provider_attempt: int) -> None:
        phase = _TOOL_PHASES.get(tool_name)
        if phase is None:
            raise PipelineError(
                "provider_attempt_budget_exhausted",
                "Run 7 拒绝了未声明的外部模型操作。",
            )
        with self._lock:
            if (
                self._total >= self.max_total
                or self._by_phase[phase] >= self.max_by_phase[phase]
            ):
                raise PipelineError(
                    "provider_attempt_budget_exhausted",
                    f"Run 7 的 {phase} 外部尝试额度已用完，已停止继续请求。",
                )
            self._total += 1
            self._by_phase[phase] += 1

    def snapshot(self) -> dict[str, Any]:
        with self._lock:
            return {
                "total": self._total,
                "max_total": self.max_total,
                "by_phase": {
                    phase: self._by_phase[phase]
                    for phase in ("compile", "revision")
                },
                "max_by_phase": dict(self.max_by_phase),
            }


class Run7Failure(RuntimeError):
    def __init__(self, stage: str, code: str, message: str) -> None:
        super().__init__(message)
        self.stage = stage
        self.code = code
        self.message = message


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Run the formal isolated douyinLM Live Run 7 acceptance."
    )
    parser.add_argument(
        "--run-dir",
        type=Path,
        required=True,
        help="New evidence directory under apps/server/tmp.",
    )
    parser.add_argument("--goal", default=RUN7_GOAL)
    parser.add_argument("--clarification", default=RUN7_CLARIFICATION)
    parser.add_argument("--timeout", type=float, default=240.0)
    args = parser.parse_args()

    settings = Settings()
    if settings.ark_api_key is None:
        print(
            json.dumps(
                {
                    "result": "blocked",
                    "code": "ark_not_configured",
                    "message": "Run 7 未找到本机 Ark 配置，未发送外部请求。",
                },
                ensure_ascii=False,
            )
        )
        return 2
    if not settings.database_path.is_file():
        print(
            json.dumps(
                {
                    "result": "blocked",
                    "code": "source_database_missing",
                    "message": "Run 7 未找到主数据库，未发送外部请求。",
                },
                ensure_ascii=False,
            )
        )
        return 2

    server_root = Path(__file__).resolve().parents[2]
    scratch_root = (server_root / "tmp").resolve()
    run_dir = _safe_cli_run_dir(args.run_dir, scratch_root)
    ledger = ProviderAttemptLedger()
    evidence, passed = run_acceptance(
        base_settings=settings,
        source_database=settings.database_path,
        run_dir=run_dir,
        goal=args.goal,
        clarification=args.clarification,
        timeout_seconds=args.timeout,
        attempt_ledger=ledger,
        mode="live",
    )
    print(
        json.dumps(
            {
                "result": evidence["result"],
                "started_at_utc8": evidence["started_at_utc8"],
                "workspace_id": evidence["workspace_id"],
                "provider_attempts": evidence["provider_attempts"],
                "evidence_file": RUN7_EVIDENCE_FILE,
            },
            ensure_ascii=False,
        )
    )
    return 0 if passed else 2


def run_acceptance(
    *,
    base_settings: Settings,
    source_database: Path,
    run_dir: Path,
    goal: str = RUN7_GOAL,
    clarification: str = RUN7_CLARIFICATION,
    timeout_seconds: float = 240.0,
    compiler_provider: CompilerProvider | None = None,
    attempt_ledger: ProviderAttemptLedger | None = None,
    mode: str = "live",
) -> tuple[dict[str, Any], bool]:
    ledger = attempt_ledger or ProviderAttemptLedger()
    started_at = _now_utc8()
    evidence = _new_evidence(started_at=started_at, mode=mode, ledger=ledger)
    passed = False
    source_fingerprint_before: dict[str, str] = {}
    database: Database | None = None
    workspace: WorkspaceDetail | None = None
    provider: CompilerProvider | None = compiler_provider
    provider_calls_before = 0
    run_dir_created = False

    try:
        if run_dir.exists():
            raise Run7Failure(
                "preflight",
                "run_directory_exists",
                "Run 7 证据目录已存在；为防止覆盖，已拒绝执行。",
            )
        run_dir.mkdir(parents=True)
        run_dir_created = True
        isolated_data = run_dir / "data"
        isolated_data.mkdir()
        source_fingerprint_before = _database_fingerprint(source_database)
        _backup_database(source_database, isolated_data / "douyinlm.db")
        evidence["isolation"]["source_database_read_only"] = True

        isolated_settings = base_settings.model_copy(
            update={
                "app_mode": "stage",
                "data_dir": isolated_data,
                "web_dist_dir": run_dir / "missing-web-dist",
                "compiler_max_attempts": 2,
                "web_search_enabled": False,
            }
        )
        provider = compiler_provider or ArkCompilerProvider(
            isolated_settings,
            attempt_observer=ledger.observe,
        )

        with TestClient(
            create_app(isolated_settings, compiler_provider=provider)
        ) as client:
            database = client.app.state.database
            provider_calls_before = _provider_call_total(database)
            evidence["provider_calls"]["before"] = provider_calls_before
            evidence["selection"]["candidates"] = _ready_candidate_count(client)

            compile_started = time.perf_counter()
            evidence["compile_submitted_at_utc8"] = _now_utc8()
            started = _request_json(
                client,
                "POST",
                "/api/skills/collection-artifact-compiler/run",
                {
                    "scope": {
                        "mode": "home",
                        "category_id": None,
                        "video_ids": [],
                    },
                    "goal": goal,
                    "conversation": [],
                    "tool_policy": {
                        "allow_web_search": False,
                        "generation_authorized": True,
                    },
                },
                stage="compile",
            )
            workspace_id = str(started["workspace_id"])
            evidence["workspace_id"] = workspace_id
            compile_job = _wait_for_job(
                client,
                str(started["job_id"]),
                timeout_seconds,
                stage="compile",
            )
            evidence["timings_seconds"]["compile"] = _elapsed(compile_started)
            _require_completed_job(database, str(started["job_id"]), compile_job, "compile")
            workspace = _get_workspace(client, workspace_id, stage="compile")

            if workspace.state == "clarifying":
                continued = _request_json(
                    client,
                    "POST",
                    f"/api/workspaces/{workspace.id}/messages",
                    {"text": clarification},
                    stage="clarification",
                )
                clarification_job = _wait_for_job(
                    client,
                    str(continued["job_id"]),
                    timeout_seconds,
                    stage="clarification",
                )
                evidence["timings_seconds"]["compile"] = _elapsed(compile_started)
                _require_completed_job(
                    database,
                    str(continued["job_id"]),
                    clarification_job,
                    "clarification",
                )
                workspace = _get_workspace(client, workspace.id, stage="clarification")

            evidence["timings_seconds"]["compile"] = _elapsed(compile_started)
            evidence["selection"]["clarifications"] = _clarification_count(
                database, workspace.id
            )
            if evidence["selection"]["clarifications"] > 1:
                raise Run7Failure(
                    "clarification",
                    "clarification_limit_exceeded",
                    "Run 7 出现超过一次追问，验收停止。",
                )
            if workspace.state != "ready" or workspace.artifact is None:
                raise Run7Failure(
                    "compile",
                    "workspace_not_ready",
                    f"Compile 结束后 Workspace 状态为 {workspace.state}。",
                )

            artifact_before = workspace.artifact
            evidence["artifact_id"] = artifact_before.id
            evidence["selection"]["adopted"] = len(workspace.adopted_videos)
            evidence["selection"]["excluded"] = len(workspace.excluded_videos)
            evidence["source_audit"]["initial"] = _audit_artifact_sources(
                client, artifact_before
            )
            if not evidence["source_audit"]["initial"]["passed"]:
                raise Run7Failure(
                    "initial_source_audit",
                    "semantic_source_coverage_failed",
                    "首版 Artifact 的逐项来源语义验收未通过。",
                )

            first_item = _first_artifact_item(artifact_before)
            check_calls_before = _provider_call_total(database)
            checked_response = _request_json(
                client,
                "PATCH",
                f"/api/artifacts/{artifact_before.id}/items/{first_item.id}",
                {"checked": True},
                stage="checklist",
            )
            checked_workspace = _get_workspace(
                client, workspace.id, stage="checklist"
            )
            if checked_workspace.artifact is None:
                raise Run7Failure(
                    "checklist",
                    "artifact_missing_after_check",
                    "Checklist 勾选后 Artifact 丢失。",
                )
            artifact_after_check = checked_workspace.artifact
            check_calls_after = _provider_call_total(database)
            checked_preserved = _item_checked(artifact_after_check, first_item.id)
            evidence["checklist"] = {
                "checked": bool(checked_response.get("checked")),
                "artifact_version_before": artifact_before.version,
                "artifact_version_after": artifact_after_check.version,
                "provider_call_delta": check_calls_after - check_calls_before,
            }
            if (
                not checked_preserved
                or artifact_after_check.version != artifact_before.version
                or check_calls_after != check_calls_before
            ):
                raise Run7Failure(
                    "checklist",
                    "checklist_changed_content_version",
                    "Checklist 勾选错误地改变了 Artifact 版本或触发了模型调用。",
                )

            revision_started = time.perf_counter()
            revision = _request_json(
                client,
                "POST",
                f"/api/artifacts/{artifact_before.id}/revisions",
                {"instruction": RUN7_REVISION},
                stage="revision",
            )
            if (
                revision.get("artifact_id") != artifact_before.id
                or revision.get("version_before") != artifact_before.version
            ):
                raise Run7Failure(
                    "revision",
                    "revision_start_contract_failed",
                    "Revision 启动响应没有指向同一 Artifact 版本。",
                )
            revision_job = _wait_for_job(
                client,
                str(revision["job_id"]),
                timeout_seconds,
                stage="revision",
            )
            evidence["timings_seconds"]["revision"] = _elapsed(revision_started)
            _require_completed_job(
                database,
                str(revision["job_id"]),
                revision_job,
                "revision",
            )
            revised_workspace = _get_workspace(client, workspace.id, stage="revision")
            evidence["timings_seconds"]["revision"] = _elapsed(revision_started)
            if revised_workspace.state != "ready" or revised_workspace.artifact is None:
                raise Run7Failure(
                    "revision",
                    "revised_workspace_not_ready",
                    "Revision 结束后 Workspace 没有恢复为 ready。",
                )
            artifact_after_revision = revised_workspace.artifact
            revision_acceptance = _revision_acceptance(
                artifact_before=artifact_before,
                artifact_after=artifact_after_revision,
                checked_item_id=first_item.id,
            )
            evidence["revision"] = revision_acceptance
            if not all(
                revision_acceptance[key]
                for key in (
                    "artifact_id_unchanged",
                    "version_incremented_once",
                    "checked_preserved",
                    "applicable_sources_preserved",
                    "conflict_details_preserved",
                    "compact_lines_valid",
                )
            ):
                raise Run7Failure(
                    "revision",
                    "revision_acceptance_failed",
                    "一屏小纸条 Revision 没有完整保留版本、勾选或仍适用来源。",
                )

            evidence["source_audit"]["revised"] = _audit_artifact_sources(
                client, artifact_after_revision
            )
            if not evidence["source_audit"]["revised"]["passed"]:
                raise Run7Failure(
                    "revised_source_audit",
                    "semantic_source_coverage_failed",
                    "Revision 后 Artifact 的逐项来源语义验收未通过。",
                )

            refresh_started = time.perf_counter()
            refreshed_workspace = _get_workspace(client, workspace.id, stage="refresh")
            evidence["timings_seconds"]["refresh"] = _elapsed(refresh_started)
            refresh_acceptance = _refresh_acceptance(
                refreshed_workspace,
                expected_workspace_id=workspace.id,
                expected_artifact=artifact_after_revision,
                checked_item_id=first_item.id,
            )
            evidence["refresh"] = refresh_acceptance
            if not all(refresh_acceptance.values()):
                raise Run7Failure(
                    "refresh",
                    "refresh_recovery_failed",
                    "刷新读取没有恢复同一 Workspace、Artifact、版本和勾选状态。",
                )

            final_provider_total = _provider_call_total(database)
            provider_call_delta = final_provider_total - provider_calls_before
            evidence["provider_calls"] = {
                "before": provider_calls_before,
                "after": final_provider_total,
                "delta": provider_call_delta,
                "by_operation": _provider_calls_for_workspace(database, workspace.id),
            }
            expected_provider_calls = (
                2 + int(evidence["selection"]["clarifications"])
            )
            if provider_call_delta != expected_provider_calls:
                raise Run7Failure(
                    "provider_call_audit",
                    "provider_call_delta_mismatch",
                    "ProviderCall 增量与 Compile、追问和 Revision 闭环不一致。",
                )
            evidence["database_artifacts"] = _artifact_counts(database, workspace.id)
            if evidence["database_artifacts"] != {
                "artifacts": 1,
                "versions": 2,
            }:
                raise Run7Failure(
                    "revision",
                    "artifact_version_persistence_failed",
                    "Run 7 没有保持单一 Artifact 与两个内容版本。",
                )
            workspace = refreshed_workspace
            evidence["result"] = "passed"
            passed = True

    except Run7Failure as exc:
        evidence["result"] = "failed"
        evidence["failure"] = {
            "stage": exc.stage,
            "code": exc.code,
            "message": exc.message,
        }
    except Exception as exc:  # pragma: no cover - last-resort evidence guard
        evidence["result"] = "failed"
        evidence["failure"] = {
            "stage": "internal",
            "code": "verification_internal_error",
            "message": f"Run 7 验收器发生 {type(exc).__name__}，已停止。",
        }
    finally:
        evidence["provider_attempts"] = ledger.snapshot()
        if database is not None:
            workspace_id = evidence.get("workspace_id")
            if isinstance(workspace_id, str) and provider is not None:
                with suppress(Exception):
                    workspace = CollectionArtifactCompiler(
                        database, provider
                    ).get_workspace(workspace_id)
            final_provider_total = _provider_call_total(database)
            evidence["provider_calls"]["after"] = final_provider_total
            evidence["provider_calls"]["delta"] = (
                final_provider_total - provider_calls_before
            )
            if isinstance(workspace_id, str):
                evidence["provider_calls"]["by_operation"] = (
                    _provider_calls_for_workspace(database, workspace_id)
                )
                evidence["database_artifacts"] = _artifact_counts(
                    database, workspace_id
                )
        if workspace is not None:
            evidence["selection"]["adopted"] = len(workspace.adopted_videos)
            evidence["selection"]["excluded"] = len(workspace.excluded_videos)
            if workspace.artifact is not None and evidence["artifact_id"] is None:
                evidence["artifact_id"] = workspace.artifact.id
        if workspace is not None and run_dir_created:
            _write_json(
                run_dir / RUN7_WORKSPACE_FILE,
                workspace.model_dump(mode="json"),
            )
            evidence["workspace_snapshot_file"] = RUN7_WORKSPACE_FILE
        if source_fingerprint_before:
            source_unchanged = (
                _database_fingerprint(source_database) == source_fingerprint_before
            )
            evidence["isolation"]["source_database_unchanged"] = source_unchanged
            if not source_unchanged:
                passed = False
                evidence["result"] = "failed"
                evidence["failure"] = {
                    "stage": "isolation",
                    "code": "source_database_changed",
                    "message": "Run 7 期间主数据库文件发生变化，结果不计为通过。",
                }
        if run_dir_created:
            _write_json(run_dir / RUN7_EVIDENCE_FILE, evidence)
    return evidence, passed


def _new_evidence(
    *,
    started_at: str,
    mode: str,
    ledger: ProviderAttemptLedger,
) -> dict[str, Any]:
    return {
        "schema_version": "run7.1",
        "run_number": 7,
        "mode": mode,
        "started_at_utc8": started_at,
        "compile_submitted_at_utc8": None,
        "result": "running",
        "workspace_id": None,
        "artifact_id": None,
        "timings_seconds": {
            "compile": None,
            "revision": None,
            "refresh": None,
        },
        "selection": {
            "candidates": 0,
            "adopted": 0,
            "excluded": 0,
            "clarifications": 0,
        },
        "source_audit": {
            "initial": None,
            "revised": None,
        },
        "checklist": None,
        "revision": None,
        "refresh": None,
        "provider_attempts": ledger.snapshot(),
        "provider_calls": {
            "before": 0,
            "after": 0,
            "delta": 0,
            "by_operation": {},
        },
        "database_artifacts": {
            "artifacts": 0,
            "versions": 0,
        },
        "isolation": {
            "source_database_read_only": False,
            "source_database_unchanged": None,
            "isolated_database": "data/douyinlm.db",
            "mock_fallback": False,
        },
        "workspace_snapshot_file": None,
        "evidence_file": RUN7_EVIDENCE_FILE,
        "failure": None,
    }


def _audit_artifact_sources(
    client: TestClient,
    artifact: ArtifactDocument,
) -> dict[str, Any]:
    field_presence: Counter[str] = Counter()
    source_kinds: Counter[str] = Counter()
    action_results: list[dict[str, Any]] = []
    conflict_results: list[dict[str, Any]] = []
    unique_provenance: set[str] = set()
    provenance_reads = 0
    supported_actions = 0
    supported_viewpoints = 0

    for section in artifact.sections:
        for item_index, item in enumerate(section.items):
            provenances = [
                _get_provenance(client, provenance_id)
                for provenance_id in item.provenance_ids
            ]
            provenance_reads += len(provenances)
            unique_provenance.update(item.provenance_ids)
            for provenance in provenances:
                _record_provenance_fields(
                    provenance,
                    field_presence=field_presence,
                    source_kinds=source_kinds,
                )
            evidence_texts = [
                provenance.evidence_summary
                for provenance in provenances
                if provenance.kind == "video"
            ]
            fields = [
                ("text", item.text),
                ("detail", item.detail),
                ("adjustment_rule", item.adjustment_rule),
            ]
            checked_fields = [
                field_name for field_name, statement in fields if statement is not None
            ]
            semantic_supported = bool(provenances) and all(
                provenance.kind == "video"
                and provenance.start_ms is not None
                and provenance.end_ms is not None
                and provenance.video is not None
                for provenance in provenances
            ) and all(
                has_direct_video_support(statement, evidence_texts)
                for _field_name, statement in fields
                if statement is not None
            )
            supported_actions += int(semantic_supported)
            action_results.append(
                {
                    "section_order": section.order,
                    "item_order": item_index,
                    "source_count": len(provenances),
                    "fields_checked": checked_fields,
                    "semantic_supported": semantic_supported,
                }
            )

    for detail_index, detail in enumerate(artifact.conflict_details):
        for viewpoint_index, viewpoint in enumerate(detail.viewpoints):
            provenances = [
                _get_provenance(client, provenance_id)
                for provenance_id in viewpoint.provenance_ids
            ]
            provenance_reads += len(provenances)
            unique_provenance.update(viewpoint.provenance_ids)
            for provenance in provenances:
                _record_provenance_fields(
                    provenance,
                    field_presence=field_presence,
                    source_kinds=source_kinds,
                )
            evidence_texts = [
                provenance.evidence_summary
                for provenance in provenances
                if provenance.kind == "video"
            ]
            semantic_supported = bool(provenances) and all(
                provenance.kind == "video"
                and provenance.start_ms is not None
                and provenance.end_ms is not None
                and provenance.video is not None
                for provenance in provenances
            ) and has_direct_video_support(viewpoint.statement, evidence_texts)
            supported_viewpoints += int(semantic_supported)
            conflict_results.append(
                {
                    "conflict_order": detail_index,
                    "viewpoint_order": viewpoint_index,
                    "source_count": len(provenances),
                    "semantic_supported": semantic_supported,
                }
            )

    total_actions = len(action_results)
    total_viewpoints = len(conflict_results)
    return {
        "passed": (
            total_actions > 0
            and supported_actions == total_actions
            and supported_viewpoints == total_viewpoints
        ),
        "action_items": {
            "total": total_actions,
            "semantically_supported": supported_actions,
        },
        "conflict_viewpoints": {
            "total": total_viewpoints,
            "semantically_supported": supported_viewpoints,
        },
        "provenance_reads": provenance_reads,
        "unique_provenance": len(unique_provenance),
        "source_kinds": dict(sorted(source_kinds.items())),
        "field_presence": {
            field_name: field_presence[field_name]
            for field_name in (
                "id",
                "kind",
                "source_id",
                "evidence_summary",
                "start_ms",
                "end_ms",
                "video.title",
                "video.author",
                "video.source_url",
                "video.playback_url",
            )
        },
        "action_results": action_results,
        "conflict_results": conflict_results,
    }


def _record_provenance_fields(
    provenance: ProvenanceDetail,
    *,
    field_presence: Counter[str],
    source_kinds: Counter[str],
) -> None:
    source_kinds[provenance.kind] += 1
    values: dict[str, object | None] = {
        "id": provenance.id,
        "kind": provenance.kind,
        "source_id": provenance.source_id,
        "evidence_summary": provenance.evidence_summary,
        "start_ms": provenance.start_ms,
        "end_ms": provenance.end_ms,
        "video.title": provenance.video.title if provenance.video is not None else None,
        "video.author": provenance.video.author if provenance.video is not None else None,
        "video.source_url": (
            provenance.video.source_url if provenance.video is not None else None
        ),
        "video.playback_url": (
            provenance.video.playback_url if provenance.video is not None else None
        ),
    }
    for field_name, value in values.items():
        if value is not None and value != "":
            field_presence[field_name] += 1


def _revision_acceptance(
    *,
    artifact_before: ArtifactDocument,
    artifact_after: ArtifactDocument,
    checked_item_id: str,
) -> dict[str, Any]:
    compact_line_count = (
        len(artifact_after.compact_variant.lines)
        if artifact_after.compact_variant is not None
        else 0
    )
    return {
        "instruction": RUN7_REVISION,
        "artifact_id_unchanged": artifact_after.id == artifact_before.id,
        "version_before": artifact_before.version,
        "version_after": artifact_after.version,
        "version_incremented_once": (
            artifact_after.version == artifact_before.version + 1
        ),
        "checked_preserved": _item_checked(artifact_after, checked_item_id),
        "applicable_sources_preserved": (
            _artifact_provenance_ids(artifact_before)
            <= _artifact_provenance_ids(artifact_after)
        ),
        "conflict_details_preserved": (
            artifact_after.conflict_details == artifact_before.conflict_details
        ),
        "compact_line_count": compact_line_count,
        "compact_lines_valid": 1 <= compact_line_count <= 8,
    }


def _refresh_acceptance(
    workspace: WorkspaceDetail,
    *,
    expected_workspace_id: str,
    expected_artifact: ArtifactDocument,
    checked_item_id: str,
) -> dict[str, bool]:
    artifact = workspace.artifact
    return {
        "workspace_same": workspace.id == expected_workspace_id,
        "artifact_same": artifact is not None and artifact.id == expected_artifact.id,
        "version_same": (
            artifact is not None and artifact.version == expected_artifact.version
        ),
        "checked_preserved": (
            artifact is not None and _item_checked(artifact, checked_item_id)
        ),
    }


def _artifact_provenance_ids(artifact: ArtifactDocument) -> set[str]:
    result = {
        provenance_id
        for section in artifact.sections
        for item in section.items
        for provenance_id in item.provenance_ids
    }
    result.update(
        provenance_id
        for detail in artifact.conflict_details
        for viewpoint in detail.viewpoints
        for provenance_id in viewpoint.provenance_ids
    )
    return result


def _first_artifact_item(artifact: ArtifactDocument) -> Any:
    for section in artifact.sections:
        if section.items:
            return section.items[0]
    raise Run7Failure(
        "checklist",
        "artifact_has_no_items",
        "Artifact 没有可用于 Checklist 验收的行动项。",
    )


def _item_checked(artifact: ArtifactDocument, item_id: str) -> bool:
    return any(
        item.id == item_id and item.checked
        for section in artifact.sections
        for item in section.items
    )


def _get_provenance(client: TestClient, provenance_id: str) -> ProvenanceDetail:
    response = client.get(f"/api/provenance/{provenance_id}")
    if not 200 <= response.status_code < 300:
        raise Run7Failure(
            "source_audit",
            "provenance_unreadable",
            "Artifact 引用的 Provenance 无法读取。",
        )
    try:
        return ProvenanceDetail.model_validate(response.json())
    except Exception as exc:
        raise Run7Failure(
            "source_audit",
            "provenance_schema_invalid",
            "Artifact 引用的 Provenance 不符合服务端契约。",
        ) from exc


def _get_workspace(
    client: TestClient,
    workspace_id: str,
    *,
    stage: str,
) -> WorkspaceDetail:
    payload = _request_json(
        client,
        "GET",
        f"/api/workspaces/{workspace_id}",
        None,
        stage=stage,
    )
    try:
        return WorkspaceDetail.model_validate(payload)
    except Exception as exc:
        raise Run7Failure(
            stage,
            "workspace_schema_invalid",
            "Workspace 响应不符合服务端契约。",
        ) from exc


def _request_json(
    client: TestClient,
    method: str,
    path: str,
    payload: object | None,
    *,
    stage: str,
) -> dict[str, Any]:
    response = client.request(method, path, json=payload)
    if not 200 <= response.status_code < 300:
        raise Run7Failure(
            stage,
            "http_request_failed",
            f"{stage} 请求返回 HTTP {response.status_code}。",
        )
    value = response.json()
    if not isinstance(value, dict):
        raise Run7Failure(
            stage,
            "http_response_invalid",
            f"{stage} 请求没有返回 JSON 对象。",
        )
    return value


def _wait_for_job(
    client: TestClient,
    job_id: str,
    timeout_seconds: float,
    *,
    stage: str,
) -> dict[str, Any]:
    deadline = time.monotonic() + timeout_seconds
    latest: dict[str, Any] = {}
    while time.monotonic() < deadline:
        latest = _request_json(
            client,
            "GET",
            f"/api/jobs/{job_id}",
            None,
            stage=stage,
        )
        if latest.get("status") in {"completed", "failed", "blocked"}:
            return latest
        time.sleep(0.1)
    raise Run7Failure(
        stage,
        "job_timeout",
        f"{stage} Job 在 {timeout_seconds:g} 秒内没有结束。",
    )


def _require_completed_job(
    database: Database,
    job_id: str,
    job: dict[str, Any],
    stage: str,
) -> None:
    if job.get("status") == "completed":
        return
    with database.session() as session:
        latest_event = session.scalar(
            select(JobEvent)
            .where(JobEvent.job_id == job_id)
            .order_by(JobEvent.sequence.desc())
            .limit(1)
        )
    code = "job_failed"
    if latest_event is not None and isinstance(latest_event.detail_json, dict):
        code = str(latest_event.detail_json.get("code") or code)
    last_error = job.get("last_error")
    message = (
        str(last_error)
        if isinstance(last_error, str) and last_error.strip()
        else f"{stage} Job 以 {job.get('status')} 结束。"
    )
    raise Run7Failure(stage, code, message)


def _ready_candidate_count(client: TestClient) -> int:
    collection = _request_json(
        client,
        "GET",
        "/api/collection",
        None,
        stage="preflight",
    )
    videos = collection.get("videos")
    if not isinstance(videos, list):
        raise Run7Failure(
            "preflight",
            "collection_schema_invalid",
            "收藏接口没有返回候选视频列表。",
        )
    return sum(
        1
        for video in videos
        if isinstance(video, dict) and video.get("status") == "ready"
    )


def _provider_call_total(database: Database) -> int:
    with database.session() as session:
        return int(session.scalar(select(func.count()).select_from(ProviderCall)) or 0)


def _provider_calls_for_workspace(
    database: Database,
    workspace_id: str,
) -> dict[str, int]:
    with database.session() as session:
        rows = session.execute(
            select(ProviderCall.operation, func.count())
            .where(ProviderCall.workspace_id == workspace_id)
            .group_by(ProviderCall.operation)
            .order_by(ProviderCall.operation)
        ).all()
    return {str(operation): int(count) for operation, count in rows}


def _clarification_count(database: Database, workspace_id: str) -> int:
    with database.session() as session:
        workspace = session.get(Workspace, workspace_id)
        if workspace is None:
            raise Run7Failure(
                "clarification",
                "workspace_not_found",
                "无法读取追问次数，因为 Workspace 不存在。",
            )
        return int(workspace.clarification_count)


def _artifact_counts(database: Database, workspace_id: str) -> dict[str, int]:
    with database.session() as session:
        artifact_ids = session.scalars(
            select(Artifact.id).where(Artifact.workspace_id == workspace_id)
        ).all()
        versions = (
            int(
                session.scalar(
                    select(func.count())
                    .select_from(ArtifactVersion)
                    .where(ArtifactVersion.artifact_id.in_(artifact_ids))
                )
                or 0
            )
            if artifact_ids
            else 0
        )
    return {"artifacts": len(artifact_ids), "versions": versions}


def _safe_cli_run_dir(requested: Path, scratch_root: Path) -> Path:
    candidate = requested if requested.is_absolute() else Path.cwd() / requested
    resolved = candidate.resolve()
    if not resolved.is_relative_to(scratch_root):
        raise SystemExit("Run 7 证据目录必须位于 apps/server/tmp 内。")
    return resolved


def _backup_database(source: Path, target: Path) -> None:
    with (
        sqlite3.connect(
            f"file:{source.resolve().as_posix()}?mode=ro",
            uri=True,
        ) as source_connection,
        sqlite3.connect(target) as target_connection,
    ):
        source_connection.backup(target_connection)


def _database_fingerprint(database_path: Path) -> dict[str, str]:
    return (
        {"database": _sha256_file(database_path)}
        if database_path.is_file()
        else {}
    )


def _sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _write_json(path: Path, payload: object) -> None:
    path.write_text(
        json.dumps(payload, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )


def _now_utc8() -> str:
    return datetime.now(UTC_PLUS_8).isoformat(timespec="seconds")


def _elapsed(started: float) -> float:
    return round(time.perf_counter() - started, 3)


if __name__ == "__main__":
    raise SystemExit(main())
