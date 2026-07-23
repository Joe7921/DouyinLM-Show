from __future__ import annotations

import argparse
import os
import sqlite3
from collections.abc import Sequence
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path, PurePosixPath
from typing import Any, Literal
from uuid import uuid4

from douyinlm.audit_demo_evidence import AuditIssue, audit_demo_evidence
from douyinlm.domain.schemas import ImportManifest

APPLY_CONFIRMATION = "APPLY-DEMO-METADATA"
_ALLOWED_AUDIT_CODES = frozenset(
    {
        "video_metadata_mismatch",
        "permission_metadata_mismatch",
    }
)
_VIDEO_FIELDS = ("title", "author", "source_url")
_PERMISSION_FIELDS = ("author", "source_url", "scope", "evidence_path")


@dataclass(frozen=True)
class MetadataChange:
    file_identifier: str
    target: Literal["Video", "PermissionRecord"]
    field: str


@dataclass(frozen=True)
class SyncResult:
    status: Literal["blocked", "dry-run", "applied", "no-op", "failed"]
    changes: tuple[MetadataChange, ...]
    issues: tuple[AuditIssue, ...] = ()
    backup_name: str | None = None

    @property
    def ok(self) -> bool:
        return self.status in {"dry-run", "applied", "no-op"}

    @property
    def exit_code(self) -> int:
        return 0 if self.ok else 1

    def render(self) -> str:
        labels = {
            "blocked": "BLOCKED",
            "dry-run": "DRY-RUN",
            "applied": "APPLIED",
            "no-op": "NO-OP",
            "failed": "FAILED",
        }
        label = labels[self.status]
        lines = [
            f"DEMO METADATA SYNC {label}",
            f"mode={self.status}",
        ]
        for change in sorted(
            self.changes,
            key=lambda item: (item.file_identifier.casefold(), item.target, item.field),
        ):
            lines.append(
                f"CHANGE file={change.file_identifier} "
                f"target={change.target} field={change.field}"
            )
        if self.backup_name is not None:
            lines.append(f"BACKUP file={self.backup_name}")
        for issue in sorted(
            self.issues,
            key=lambda item: (item.location, item.code, item.message),
        ):
            lines.append(f"ERROR {issue.location} [{issue.code}] {issue.message}")
        changed_files = len({item.file_identifier for item in self.changes})
        lines.append(
            "SUMMARY "
            f"status={label} files={changed_files} "
            f"changes={len(self.changes)} errors={len(self.issues)} "
            f"backup={1 if self.backup_name else 0}"
        )
        return "\n".join(lines)


@dataclass(frozen=True)
class _SyncRow:
    video_id: str
    original_filename: str
    title: str | None
    author: str | None
    source_url: str | None
    source_hash: str
    status: str | None
    analysis_version: int | None
    current_job_id: str | None
    permission_id: str
    permission_author: str | None
    permission_source_url: str | None
    permission_scope: str | None
    permission_evidence_path: str | None
    permission_confirmed_by_user: int


@dataclass(frozen=True)
class _PlanRecord:
    file_identifier: str
    video_id: str
    permission_id: str
    video_updates: tuple[tuple[str, str], ...]
    permission_updates: tuple[tuple[str, str], ...]


@dataclass(frozen=True)
class _SyncPlan:
    records: tuple[_PlanRecord, ...]
    pre_update_rows: tuple[_SyncRow, ...]

    @property
    def changes(self) -> tuple[MetadataChange, ...]:
        changes: list[MetadataChange] = []
        for record in self.records:
            changes.extend(
                MetadataChange(record.file_identifier, "Video", field)
                for field, _value in record.video_updates
            )
            changes.extend(
                MetadataChange(record.file_identifier, "PermissionRecord", field)
                for field, _value in record.permission_updates
            )
        return tuple(changes)


def sync_demo_metadata(
    manifest_path: Path,
    data_dir: Path,
    *,
    apply: bool = False,
    confirmation: str | None = None,
) -> SyncResult:
    manifest_path = Path(manifest_path)
    data_dir = Path(data_dir)
    audit = audit_demo_evidence(manifest_path, data_dir)
    blocking_issues = tuple(
        issue for issue in audit.issues if issue.code not in _ALLOWED_AUDIT_CODES
    )
    if blocking_issues:
        return SyncResult(status="blocked", changes=(), issues=blocking_issues)

    try:
        manifest = ImportManifest.model_validate_json(
            manifest_path.read_text(encoding="utf-8")
        )
        plan = _build_plan(manifest, data_dir / "douyinlm.db")
    except Exception as exc:
        return _safe_failure("plan", "plan_failed", exc)

    changes = plan.changes
    if not changes:
        return SyncResult(status="no-op", changes=())
    if not apply:
        return SyncResult(status="dry-run", changes=changes)
    if confirmation != APPLY_CONFIRMATION:
        return SyncResult(
            status="blocked",
            changes=changes,
            issues=(
                AuditIssue(
                    "confirmation",
                    "confirmation_required",
                    "--apply 必须同时提供固定确认短语。",
                ),
            ),
        )
    return _apply_plan(manifest_path, data_dir, manifest, plan)


def _build_plan(manifest: ImportManifest, database_path: Path) -> _SyncPlan:
    connection = _connect_read_only(database_path)
    try:
        rows = _read_sync_rows(connection)
    finally:
        connection.close()
    rows_by_filename = {row.original_filename.casefold(): row for row in rows}
    records: list[_PlanRecord] = []
    for entry in manifest.videos:
        row = rows_by_filename[entry.filename.casefold()]
        video_values = {
            "title": _required_value(entry.title),
            "author": _required_value(entry.author),
            "source_url": _required_value(entry.source_url),
        }
        permission_values = {
            "author": _required_value(entry.author),
            "source_url": _required_value(entry.source_url),
            "scope": _required_value(entry.permission_scope),
            "evidence_path": _normalize_path(
                _required_value(entry.permission_evidence_path)
            ),
        }
        video_updates = tuple(
            (field, value)
            for field, value in video_values.items()
            if getattr(row, field) != value
        )
        permission_updates = tuple(
            (field, value)
            for field, value in permission_values.items()
            if (
                _normalize_existing_permission_value(
                    field,
                    getattr(row, f"permission_{field}"),
                )
                != value
            )
        )
        records.append(
            _PlanRecord(
                file_identifier=_safe_file_identifier(entry.filename),
                video_id=row.video_id,
                permission_id=row.permission_id,
                video_updates=video_updates,
                permission_updates=permission_updates,
            )
        )
    return _SyncPlan(records=tuple(records), pre_update_rows=tuple(rows))


def _required_value(value: str | None) -> str:
    if value is None:
        raise ValueError("validated manifest field unexpectedly missing")
    return value


def _normalize_path(value: str) -> str:
    return PurePosixPath(value.replace("\\", "/")).as_posix()


def _normalize_existing_permission_value(field: str, value: str | None) -> str | None:
    if field == "evidence_path" and value is not None:
        return _normalize_path(value)
    return value


def _safe_file_identifier(filename: str) -> str:
    identifier = PurePosixPath(filename.replace("\\", "/")).name
    cleaned = "".join(character for character in identifier if character.isprintable())
    return cleaned[:120] or "unnamed-file"


def _connect_read_only(database_path: Path) -> sqlite3.Connection:
    uri = f"{database_path.resolve().as_uri()}?mode=ro&immutable=1"
    connection = sqlite3.connect(uri, uri=True)
    connection.row_factory = sqlite3.Row
    return connection


def _read_sync_rows(connection: sqlite3.Connection) -> list[_SyncRow]:
    rows = connection.execute(
        """
        SELECT
            v.id AS video_id,
            v.original_filename,
            v.title,
            v.author,
            v.source_url,
            v.source_hash,
            v.status,
            v.analysis_version,
            v.current_job_id,
            p.id AS permission_id,
            p.author AS permission_author,
            p.source_url AS permission_source_url,
            p.scope AS permission_scope,
            p.evidence_path AS permission_evidence_path,
            p.confirmed_by_user AS permission_confirmed_by_user
        FROM videos AS v
        JOIN permission_records AS p ON p.video_id = v.id
        ORDER BY LOWER(v.original_filename), v.id
        """
    ).fetchall()
    return [_SyncRow(**dict(row)) for row in rows]


def _apply_plan(
    manifest_path: Path,
    data_dir: Path,
    manifest: ImportManifest,
    plan: _SyncPlan,
) -> SyncResult:
    database_path = data_dir / "douyinlm.db"
    connection = sqlite3.connect(database_path, timeout=10, isolation_level=None)
    connection.row_factory = sqlite3.Row
    backup_name: str | None = None
    try:
        connection.execute("PRAGMA foreign_keys = ON")
        connection.execute("BEGIN IMMEDIATE")
        if tuple(_read_sync_rows(connection)) != plan.pre_update_rows:
            raise RuntimeError("database changed after dry-run validation")
        locked_audit = audit_demo_evidence(manifest_path, data_dir)
        if any(issue.code not in _ALLOWED_AUDIT_CODES for issue in locked_audit.issues):
            raise RuntimeError("evidence changed after dry-run validation")
        backup_name = _create_backup(database_path, data_dir)
        protected_before = _protected_snapshot(connection)
        _execute_update_plan(connection, plan)
        _verify_update_plan(connection, manifest)
        if _protected_snapshot(connection) != protected_before:
            raise RuntimeError("protected database fields changed")
        connection.commit()
    except Exception as exc:
        if connection.in_transaction:
            connection.rollback()
        return _safe_failure(
            "transaction",
            "transaction_rolled_back",
            exc,
            changes=plan.changes,
            backup_name=backup_name,
        )
    finally:
        connection.close()

    post_apply_audit = audit_demo_evidence(manifest_path, data_dir)
    if not post_apply_audit.ok:
        return SyncResult(
            status="failed",
            changes=plan.changes,
            issues=(
                AuditIssue(
                    "post_apply_audit",
                    "post_apply_audit_failed",
                    "提交后的只读复核失败；请使用已生成备份人工恢复。",
                ),
            ),
            backup_name=backup_name,
        )
    return SyncResult(
        status="applied",
        changes=plan.changes,
        backup_name=backup_name,
    )


def _create_backup(database_path: Path, data_dir: Path) -> str:
    timestamp = datetime.now(UTC).strftime("%Y%m%dT%H%M%S%fZ")
    backup_name = f"douyinlm.before-demo-metadata.{timestamp}.{uuid4().hex[:8]}.db"
    backup_path = data_dir / backup_name
    descriptor = os.open(backup_path, os.O_CREAT | os.O_EXCL | os.O_WRONLY)
    os.close(descriptor)
    source: sqlite3.Connection | None = None
    destination: sqlite3.Connection | None = None
    try:
        source_uri = f"{database_path.resolve().as_uri()}?mode=ro"
        source = sqlite3.connect(source_uri, uri=True)
        destination = sqlite3.connect(backup_path)
        source.backup(destination)
        destination.commit()
        integrity = destination.execute("PRAGMA integrity_check").fetchone()
        if integrity is None or integrity[0] != "ok":
            raise sqlite3.DatabaseError("backup integrity check failed")
    except Exception:
        if destination is not None:
            destination.close()
            destination = None
        if source is not None:
            source.close()
            source = None
        backup_path.unlink(missing_ok=True)
        raise
    finally:
        if destination is not None:
            destination.close()
        if source is not None:
            source.close()
    return backup_name


def _protected_snapshot(connection: sqlite3.Connection) -> tuple[Any, ...]:
    return (
        tuple(
            connection.execute(
                """
                SELECT id, original_filename, source_hash, status,
                       analysis_version, current_job_id
                FROM videos
                ORDER BY id
                """
            ).fetchall()
        ),
        tuple(
            connection.execute(
                """
                SELECT id, video_id, confirmed_by_user
                FROM permission_records
                ORDER BY id
                """
            ).fetchall()
        ),
    )


def _execute_update_plan(connection: sqlite3.Connection, plan: _SyncPlan) -> None:
    for record in plan.records:
        _update_allowed_fields(
            connection,
            table="videos",
            row_id=record.video_id,
            allowed_fields=_VIDEO_FIELDS,
            updates=record.video_updates,
        )
        _update_allowed_fields(
            connection,
            table="permission_records",
            row_id=record.permission_id,
            allowed_fields=_PERMISSION_FIELDS,
            updates=record.permission_updates,
        )


def _update_allowed_fields(
    connection: sqlite3.Connection,
    *,
    table: Literal["videos", "permission_records"],
    row_id: str,
    allowed_fields: tuple[str, ...],
    updates: tuple[tuple[str, str], ...],
) -> None:
    if not updates:
        return
    if any(field not in allowed_fields for field, _value in updates):
        raise RuntimeError("update plan contains a protected field")
    assignments = ", ".join(f'"{field}" = ?' for field, _value in updates)
    values = [value for _field, value in updates]
    cursor = connection.execute(
        f'UPDATE "{table}" SET {assignments} WHERE id = ?',  # noqa: S608
        [*values, row_id],
    )
    if cursor.rowcount != 1:
        raise RuntimeError("metadata target disappeared during transaction")


def _verify_update_plan(
    connection: sqlite3.Connection,
    manifest: ImportManifest,
) -> None:
    rows = _read_sync_rows(connection)
    rows_by_filename = {row.original_filename.casefold(): row for row in rows}
    if len(rows) != len(manifest.videos):
        raise RuntimeError("database coverage changed during transaction")
    for entry in manifest.videos:
        row = rows_by_filename.get(entry.filename.casefold())
        if row is None:
            raise RuntimeError("database coverage changed during transaction")
        expected_video = {
            "title": _required_value(entry.title),
            "author": _required_value(entry.author),
            "source_url": _required_value(entry.source_url),
        }
        expected_permission = {
            "author": _required_value(entry.author),
            "source_url": _required_value(entry.source_url),
            "scope": _required_value(entry.permission_scope),
            "evidence_path": _normalize_path(
                _required_value(entry.permission_evidence_path)
            ),
        }
        if any(getattr(row, field) != value for field, value in expected_video.items()):
            raise RuntimeError("Video metadata verification failed")
        if any(
            getattr(row, f"permission_{field}") != value
            for field, value in expected_permission.items()
        ):
            raise RuntimeError("PermissionRecord metadata verification failed")


def _safe_failure(
    location: str,
    code: str,
    exc: Exception,
    *,
    changes: tuple[MetadataChange, ...] = (),
    backup_name: str | None = None,
) -> SyncResult:
    return SyncResult(
        status="failed",
        changes=changes,
        issues=(
            AuditIssue(
                location,
                code,
                f"同步失败（{type(exc).__name__}）。",
            ),
        ),
        backup_name=backup_name,
    )


def main(argv: Sequence[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description="Safely dry-run or apply final douyinLM demo metadata.",
    )
    parser.add_argument("--manifest", type=Path, required=True)
    parser.add_argument("--data-dir", type=Path, required=True)
    parser.add_argument("--apply", action="store_true")
    parser.add_argument(
        "--confirm",
        help=f"Required with --apply: {APPLY_CONFIRMATION}",
    )
    args = parser.parse_args(argv)
    try:
        result = sync_demo_metadata(
            args.manifest,
            args.data_dir,
            apply=args.apply,
            confirmation=args.confirm,
        )
    except Exception as exc:  # pragma: no cover - final CLI safety boundary
        result = _safe_failure("sync", "internal_sync_error", exc)
    print(result.render())
    return result.exit_code


if __name__ == "__main__":
    raise SystemExit(main())
