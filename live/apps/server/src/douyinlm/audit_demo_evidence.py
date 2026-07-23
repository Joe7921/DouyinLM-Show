from __future__ import annotations

import argparse
import re
import sqlite3
from collections.abc import Sequence
from dataclasses import dataclass
from pathlib import Path, PurePosixPath, PureWindowsPath
from urllib.parse import urlsplit

from pydantic import ValidationError

from douyinlm.domain.schemas import ImportManifest, ImportManifestEntry

_HEX_TITLE_RE = re.compile(r"^(?:[0-9a-fA-F]{32}|[0-9a-fA-F]{64})$")
_PLACEHOLDER_MARKERS = ("待真实填写", "可留空", "replace-with")


@dataclass(frozen=True)
class AuditIssue:
    location: str
    code: str
    message: str


@dataclass(frozen=True)
class AuditResult:
    manifest_entries: int
    database_videos: int
    issues: tuple[AuditIssue, ...]

    @property
    def ok(self) -> bool:
        return not self.issues

    def render(self) -> str:
        status = "PASS" if self.ok else "FAIL"
        lines = [
            f"DEMO EVIDENCE AUDIT {status}",
            "manifest=manifest.json database=douyinlm.db mode=read-only",
        ]
        for issue in sorted(
            self.issues,
            key=lambda item: (item.location, item.code, item.message),
        ):
            lines.append(
                f"ERROR {issue.location} [{issue.code}] {issue.message}"
            )
        lines.append(
            "SUMMARY "
            f"status={status} manifest_entries={self.manifest_entries} "
            f"database_videos={self.database_videos} errors={len(self.issues)}"
        )
        return "\n".join(lines)


@dataclass(frozen=True)
class DatabaseVideo:
    index: int
    original_filename: str | None
    title: str | None
    author: str | None
    source_url: str | None
    source_hash: str | None
    permission_id: str | None
    permission_author: str | None
    permission_source_url: str | None
    permission_scope: str | None
    permission_evidence_path: str | None
    permission_confirmed_by_user: int | None


def audit_demo_evidence(manifest_path: Path, data_dir: Path) -> AuditResult:
    issues: list[AuditIssue] = []
    manifest = _load_manifest(Path(manifest_path), issues)
    if manifest is None:
        return AuditResult(manifest_entries=0, database_videos=0, issues=tuple(issues))

    manifest_path = Path(manifest_path).resolve()
    _audit_manifest(manifest, manifest_path.parent, issues)
    database_videos = _load_database_videos(Path(data_dir), issues)
    if database_videos is not None:
        _audit_coverage_and_metadata(manifest, database_videos, issues)
    return AuditResult(
        manifest_entries=len(manifest.videos),
        database_videos=len(database_videos or []),
        issues=tuple(issues),
    )


def _load_manifest(path: Path, issues: list[AuditIssue]) -> ImportManifest | None:
    try:
        raw = path.read_text(encoding="utf-8")
    except OSError:
        issues.append(
            AuditIssue("manifest", "manifest_unreadable", "清单文件不存在或不可读取。")
        )
        return None
    try:
        return ImportManifest.model_validate_json(raw)
    except ValidationError as exc:
        for error in exc.errors(
            include_url=False,
            include_context=False,
            include_input=False,
        ):
            location = _pydantic_location(error.get("loc", ()))
            issues.append(
                AuditIssue(
                    location,
                    f"manifest_{error['type']}",
                    "字段不符合严格 ImportManifest。",
                )
            )
    except ValueError:
        issues.append(AuditIssue("manifest", "manifest_invalid_json", "清单不是有效 JSON。"))
    return None


def _pydantic_location(parts: Sequence[object]) -> str:
    location = "manifest"
    for part in parts:
        if isinstance(part, int):
            location += f"[{part}]"
        else:
            location += f".{part}"
    return location


def _audit_manifest(
    manifest: ImportManifest,
    manifest_dir: Path,
    issues: list[AuditIssue],
) -> None:
    if manifest.schema_version != 1:
        issues.append(
            AuditIssue(
                "manifest.schema_version",
                "unsupported_schema_version",
                "最终证据清单只接受 schema_version=1。",
            )
        )
    if not manifest.videos:
        issues.append(
            AuditIssue("manifest.videos", "empty_manifest", "最终证据清单不能为空。")
        )
        return

    filename_indexes: dict[str, list[int]] = {}
    for index, entry in enumerate(manifest.videos):
        location = f"manifest.videos[{index}]"
        filename = _required_text(entry.filename, location, "filename", issues)
        required_values: dict[str, str | None] = {}
        for field_name in (
            "title",
            "author",
            "source_url",
            "permission_scope",
            "permission_evidence_path",
        ):
            required_values[field_name] = _required_text(
                getattr(entry, field_name),
                location,
                field_name,
                issues,
            )
        if filename is not None:
            filename_indexes.setdefault(filename.casefold(), []).append(index)
        _audit_title(filename, required_values["title"], location, issues)
        for field_name, value in required_values.items():
            if value is not None and _contains_placeholder(value):
                issues.append(
                    AuditIssue(
                        f"{location}.{field_name}",
                        "placeholder_value",
                        "最终证据字段不得使用模板占位值。",
                    )
                )
        if _nonempty(entry.source_url):
            _audit_source_url(str(entry.source_url).strip(), location, issues)
        if _nonempty(entry.permission_evidence_path):
            _audit_evidence_path(
                str(entry.permission_evidence_path).strip(),
                manifest_dir,
                location,
                issues,
            )

    for indexes in filename_indexes.values():
        if len(indexes) < 2:
            continue
        for index in indexes:
            issues.append(
                AuditIssue(
                    f"manifest.videos[{index}].filename",
                    "duplicate_filename",
                    "filename 与清单内另一条记录大小写重复。",
                )
            )


def _required_text(
    value: object,
    location: str,
    field_name: str,
    issues: list[AuditIssue],
) -> str | None:
    if not isinstance(value, str) or not value.strip():
        issues.append(
            AuditIssue(
                f"{location}.{field_name}",
                "required_nonempty",
                "最终证据要求非空字符串。",
            )
        )
        return None
    if value != value.strip():
        issues.append(
            AuditIssue(
                f"{location}.{field_name}",
                "surrounding_whitespace",
                "字段不得包含首尾空白。",
            )
        )
    return value.strip()


def _nonempty(value: object) -> bool:
    return isinstance(value, str) and bool(value.strip())


def _audit_title(
    filename: str | None,
    title: str | None,
    location: str,
    issues: list[AuditIssue],
) -> None:
    if title is None:
        return
    if filename is not None and title.casefold() == Path(filename).stem.casefold():
        issues.append(
            AuditIssue(
                f"{location}.title",
                "title_matches_filename_stem",
                "title 不能直接等于 filename stem。",
            )
        )
    if _HEX_TITLE_RE.fullmatch(title):
        issues.append(
            AuditIssue(
                f"{location}.title",
                "title_is_hash",
                "title 不能是纯 32/64 位十六进制哈希。",
            )
        )


def _contains_placeholder(value: str) -> bool:
    normalized = value.casefold()
    return any(marker.casefold() in normalized for marker in _PLACEHOLDER_MARKERS)


def _audit_source_url(
    value: str,
    location: str,
    issues: list[AuditIssue],
) -> None:
    try:
        parsed = urlsplit(value)
        _ = parsed.port
        host = (parsed.hostname or "").casefold().rstrip(".")
    except ValueError:
        issues.append(
            AuditIssue(
                f"{location}.source_url",
                "invalid_source_url",
                "source_url 不是有效 URL。",
            )
        )
        return
    if parsed.scheme.casefold() != "https":
        issues.append(
            AuditIssue(
                f"{location}.source_url",
                "source_url_requires_https",
                "source_url 必须使用 HTTPS。",
            )
        )
        return
    if parsed.username is not None or parsed.password is not None:
        issues.append(
            AuditIssue(
                f"{location}.source_url",
                "source_url_has_credentials",
                "source_url 不得包含用户名或密码。",
            )
        )
        return
    if host != "douyin.com" and not host.endswith(".douyin.com"):
        issues.append(
            AuditIssue(
                f"{location}.source_url",
                "invalid_douyin_host",
                "source_url host 必须是 douyin.com 或其子域。",
            )
        )
        return
    path_segments = [segment for segment in parsed.path.split("/") if segment]
    if not path_segments:
        issues.append(
            AuditIssue(
                f"{location}.source_url",
                "source_url_path_missing",
                "source_url 必须包含具体视频或分享路径。",
            )
        )
        return
    if any(
        segment.casefold() == "example" or _contains_placeholder(segment)
        for segment in path_segments
    ):
        issues.append(
            AuditIssue(
                f"{location}.source_url",
                "placeholder_source_url_path",
                "source_url 路径不得使用 example 或模板占位值。",
            )
        )


def _audit_evidence_path(
    value: str,
    manifest_dir: Path,
    location: str,
    issues: list[AuditIssue],
) -> None:
    windows_path = PureWindowsPath(value)
    posix_path = PurePosixPath(value.replace("\\", "/"))
    field_location = f"{location}.permission_evidence_path"
    if windows_path.anchor or posix_path.is_absolute():
        issues.append(
            AuditIssue(
                field_location,
                "absolute_evidence_path",
                "证据附件必须使用相对 manifest 目录的路径。",
            )
        )
        return
    if ".." in posix_path.parts:
        issues.append(
            AuditIssue(
                field_location,
                "evidence_path_traversal",
                "证据附件路径不得包含上级目录跳转。",
            )
        )
        return
    manifest_root = manifest_dir.resolve()
    try:
        candidate = (manifest_root / Path(value)).resolve()
    except OSError:
        issues.append(
            AuditIssue(
                field_location,
                "invalid_evidence_path",
                "证据附件路径无法解析。",
            )
        )
        return
    if not candidate.is_relative_to(manifest_root):
        issues.append(
            AuditIssue(
                field_location,
                "evidence_path_outside_manifest",
                "证据附件解析后超出 manifest 目录。",
            )
        )
        return
    if not candidate.is_file():
        issues.append(
            AuditIssue(
                field_location,
                "evidence_file_missing",
                "证据附件不存在或不是文件。",
            )
        )
        return
    try:
        size_bytes = candidate.stat().st_size
    except OSError:
        issues.append(
            AuditIssue(
                field_location,
                "evidence_file_unreadable",
                "证据附件无法读取。",
            )
        )
        return
    if size_bytes <= 0:
        issues.append(
            AuditIssue(
                field_location,
                "evidence_file_empty",
                "证据附件必须是非空文件。",
            )
        )


def _load_database_videos(
    data_dir: Path,
    issues: list[AuditIssue],
) -> list[DatabaseVideo] | None:
    database_path = data_dir / "douyinlm.db"
    if not database_path.is_file():
        issues.append(
            AuditIssue(
                "database",
                "database_missing",
                "data-dir 中不存在 douyinlm.db。",
            )
        )
        return None
    connection: sqlite3.Connection | None = None
    try:
        uri = f"{database_path.resolve().as_uri()}?mode=ro&immutable=1"
        connection = sqlite3.connect(uri, uri=True)
        connection.row_factory = sqlite3.Row
        tables = {
            str(row[0])
            for row in connection.execute(
                "SELECT name FROM sqlite_master WHERE type='table' "
                "AND name IN ('videos', 'permission_records')"
            )
        }
        if tables != {"videos", "permission_records"}:
            issues.append(
                AuditIssue(
                    "database",
                    "database_schema_missing",
                    "数据库缺少 videos 或 permission_records 表。",
                )
            )
            return None
        rows = connection.execute(
            """
            SELECT
                v.original_filename,
                v.title,
                v.author,
                v.source_url,
                v.source_hash,
                p.id AS permission_id,
                p.author AS permission_author,
                p.source_url AS permission_source_url,
                p.scope AS permission_scope,
                p.evidence_path AS permission_evidence_path,
                p.confirmed_by_user AS permission_confirmed_by_user
            FROM videos AS v
            LEFT JOIN permission_records AS p ON p.video_id = v.id
            ORDER BY LOWER(COALESCE(v.original_filename, '')), v.id
            """
        ).fetchall()
        orphan_count = int(
            connection.execute(
                """
                SELECT COUNT(*)
                FROM permission_records AS p
                LEFT JOIN videos AS v ON v.id = p.video_id
                WHERE v.id IS NULL
                """
            ).fetchone()[0]
        )
        if orphan_count:
            issues.append(
                AuditIssue(
                    "database.permission_records",
                    "orphan_permission_record",
                    "存在无法对应视频的许可记录。",
                )
            )
        return [
            DatabaseVideo(index=index, **dict(row))
            for index, row in enumerate(rows)
        ]
    except sqlite3.Error:
        issues.append(
            AuditIssue(
                "database",
                "database_read_failed",
                "无法以只读模式核对 SQLite。",
            )
        )
        return None
    finally:
        if connection is not None:
            connection.close()


def _audit_coverage_and_metadata(
    manifest: ImportManifest,
    database_videos: list[DatabaseVideo],
    issues: list[AuditIssue],
) -> None:
    manifest_by_filename: dict[str, list[tuple[int, ImportManifestEntry]]] = {}
    for index, entry in enumerate(manifest.videos):
        if _nonempty(entry.filename):
            manifest_by_filename.setdefault(entry.filename.strip().casefold(), []).append(
                (index, entry)
            )

    database_by_filename: dict[str, list[DatabaseVideo]] = {}
    for row in database_videos:
        location = f"database.videos[{row.index}]"
        if not _nonempty(row.original_filename):
            issues.append(
                AuditIssue(
                    f"{location}.original_filename",
                    "database_filename_missing",
                    "数据库演示视频缺少 original_filename。",
                )
            )
            continue
        database_by_filename.setdefault(
            str(row.original_filename).strip().casefold(), []
        ).append(row)

    for rows in database_by_filename.values():
        if len(rows) < 2:
            continue
        for row in rows:
            issues.append(
                AuditIssue(
                    f"database.videos[{row.index}].original_filename",
                    "database_duplicate_filename",
                    "数据库 original_filename 存在大小写重复。",
                )
            )

    manifest_keys = set(manifest_by_filename)
    database_keys = set(database_by_filename)
    for key in sorted(manifest_keys - database_keys):
        for index, _entry in manifest_by_filename[key]:
            issues.append(
                AuditIssue(
                    f"manifest.videos[{index}].filename",
                    "manifest_video_not_in_database",
                    "清单包含数据库中不存在的 original_filename。",
                )
            )
    for key in sorted(database_keys - manifest_keys):
        for row in database_by_filename[key]:
            issues.append(
                AuditIssue(
                    f"database.videos[{row.index}].original_filename",
                    "database_video_missing_from_manifest",
                    "数据库演示视频未被清单覆盖。",
                )
            )

    for key in sorted(manifest_keys & database_keys):
        manifest_rows = manifest_by_filename[key]
        database_rows = database_by_filename[key]
        if len(manifest_rows) != 1 or len(database_rows) != 1:
            continue
        manifest_index, entry = manifest_rows[0]
        row = database_rows[0]
        _audit_matching_record(manifest_index, entry, row, issues)


def _audit_matching_record(
    manifest_index: int,
    entry: ImportManifestEntry,
    row: DatabaseVideo,
    issues: list[AuditIssue],
) -> None:
    location = f"database.videos[{row.index}]"
    if entry.filename != row.original_filename:
        issues.append(
            AuditIssue(
                f"{location}.original_filename",
                "filename_mismatch",
                "original_filename 与清单 filename 大小写或空白不一致。",
            )
        )
    for field_name in ("title", "author", "source_url"):
        expected = getattr(entry, field_name)
        if _nonempty(expected) and expected != getattr(row, field_name):
            issues.append(
                AuditIssue(
                    f"{location}.{field_name}",
                    "video_metadata_mismatch",
                    f"Video.{field_name} 与清单不一致。",
                )
            )
    if not _nonempty(row.source_hash):
        issues.append(
            AuditIssue(
                f"{location}.source_hash",
                "source_hash_missing",
                "Video.source_hash 必须非空。",
            )
        )
    if row.permission_id is None:
        issues.append(
            AuditIssue(
                f"database.permission_records[{row.index}]",
                "permission_record_missing",
                "演示视频缺少 PermissionRecord。",
            )
        )
        return

    permission_location = f"database.permission_records[{row.index}]"
    comparisons = (
        ("author", entry.author, row.permission_author),
        ("source_url", entry.source_url, row.permission_source_url),
        ("scope", entry.permission_scope, row.permission_scope),
        (
            "evidence_path",
            _normalize_relative_path(entry.permission_evidence_path),
            _normalize_relative_path(row.permission_evidence_path),
        ),
    )
    for field_name, expected, actual in comparisons:
        if _nonempty(expected) and expected != actual:
            issues.append(
                AuditIssue(
                    f"{permission_location}.{field_name}",
                    "permission_metadata_mismatch",
                    f"PermissionRecord.{field_name} 与清单不一致。",
                )
            )
    if row.permission_confirmed_by_user != 1:
        issues.append(
            AuditIssue(
                f"{permission_location}.confirmed_by_user",
                "permission_not_confirmed",
                "PermissionRecord.confirmed_by_user 必须为 true。",
            )
        )


def _normalize_relative_path(value: object) -> str | None:
    if not _nonempty(value):
        return None
    return PurePosixPath(str(value).strip().replace("\\", "/")).as_posix()


def main(argv: Sequence[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description="Read-only audit of final douyinLM demo evidence.",
    )
    parser.add_argument("--manifest", type=Path, required=True)
    parser.add_argument("--data-dir", type=Path, required=True)
    args = parser.parse_args(argv)
    try:
        result = audit_demo_evidence(args.manifest, args.data_dir)
    except Exception as exc:  # pragma: no cover - final safety boundary for CLI output
        result = AuditResult(
            manifest_entries=0,
            database_videos=0,
            issues=(
                AuditIssue(
                    "audit",
                    "internal_audit_error",
                    f"审计器出现未预期错误（{type(exc).__name__}）。",
                ),
            ),
        )
    print(result.render())
    return 0 if result.ok else 1


if __name__ == "__main__":
    raise SystemExit(main())
