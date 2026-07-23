"""Add the Gate T1 video understanding pipeline.

Revision ID: 0002_gate_t1
Revises: 0001_gate_t0
Create Date: 2026-07-21 11:00:00
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0002_gate_t1"
down_revision: str | None = "0001_gate_t0"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("videos", sa.Column("source_hash", sa.String(length=64), nullable=True))
    op.add_column("videos", sa.Column("original_filename", sa.String(length=300), nullable=True))
    op.add_column("videos", sa.Column("mime_type", sa.String(length=100), nullable=True))
    op.add_column("videos", sa.Column("file_size_bytes", sa.BigInteger(), nullable=True))
    op.add_column("videos", sa.Column("duration_ms", sa.Integer(), nullable=True))
    op.add_column("videos", sa.Column("purpose_line", sa.Text(), nullable=True))
    op.add_column("videos", sa.Column("summary", sa.Text(), nullable=True))
    op.add_column("videos", sa.Column("error_code", sa.String(length=64), nullable=True))
    op.add_column("videos", sa.Column("error_message", sa.Text(), nullable=True))
    op.add_column(
        "videos",
        sa.Column("analysis_version", sa.Integer(), nullable=False, server_default="0"),
    )
    op.add_column("videos", sa.Column("current_job_id", sa.String(length=36), nullable=True))
    op.create_index("ux_videos_source_hash", "videos", ["source_hash"], unique=True)

    op.create_table(
        "permission_records",
        sa.Column("id", sa.String(length=36), primary_key=True),
        sa.Column(
            "video_id",
            sa.String(length=36),
            sa.ForeignKey("videos.id", ondelete="CASCADE"),
            nullable=False,
            unique=True,
        ),
        sa.Column("author", sa.String(length=200), nullable=True),
        sa.Column("source_url", sa.Text(), nullable=True),
        sa.Column("scope", sa.Text(), nullable=False),
        sa.Column("evidence_path", sa.Text(), nullable=True),
        sa.Column("confirmed_by_user", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
    )

    op.create_table(
        "video_assets",
        sa.Column("id", sa.String(length=36), primary_key=True),
        sa.Column(
            "video_id",
            sa.String(length=36),
            sa.ForeignKey("videos.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("kind", sa.String(length=32), nullable=False),
        sa.Column("relative_path", sa.Text(), nullable=False),
        sa.Column("sha256", sa.String(length=64), nullable=True),
        sa.Column("mime_type", sa.String(length=100), nullable=True),
        sa.Column("size_bytes", sa.BigInteger(), nullable=True),
        sa.Column("duration_ms", sa.Integer(), nullable=True),
        sa.Column("metadata_json", sa.JSON(), nullable=False, server_default=sa.text("'{}'")),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.UniqueConstraint("video_id", "kind", "relative_path", name="uq_video_asset_path"),
    )
    op.create_index("ix_video_assets_video_kind", "video_assets", ["video_id", "kind"])

    op.create_table(
        "analysis_runs",
        sa.Column("id", sa.String(length=36), primary_key=True),
        sa.Column(
            "video_id",
            sa.String(length=36),
            sa.ForeignKey("videos.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("run_number", sa.Integer(), nullable=False),
        sa.Column("pipeline_version", sa.String(length=40), nullable=False),
        sa.Column("schema_version", sa.String(length=40), nullable=False),
        sa.Column("prompt_version", sa.String(length=40), nullable=False),
        sa.Column("model_id", sa.String(length=160), nullable=False),
        sa.Column("status", sa.String(length=32), nullable=False),
        sa.Column("cache_key", sa.String(length=64), nullable=False),
        sa.Column("provider_response_id", sa.String(length=200), nullable=True),
        sa.Column("error_code", sa.String(length=64), nullable=True),
        sa.Column("error_message", sa.Text(), nullable=True),
        sa.Column("started_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("completed_at", sa.DateTime(timezone=True), nullable=True),
        sa.UniqueConstraint("video_id", "run_number", name="uq_analysis_run_number"),
    )
    op.create_index("ix_analysis_runs_video_status", "analysis_runs", ["video_id", "status"])
    op.create_index("ix_analysis_runs_cache_key", "analysis_runs", ["cache_key"])

    op.create_table(
        "video_understandings",
        sa.Column("id", sa.String(length=36), primary_key=True),
        sa.Column(
            "video_id",
            sa.String(length=36),
            sa.ForeignKey("videos.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "analysis_run_id",
            sa.String(length=36),
            sa.ForeignKey("analysis_runs.id", ondelete="CASCADE"),
            nullable=False,
            unique=True,
        ),
        sa.Column("schema_version", sa.String(length=40), nullable=False),
        sa.Column("purpose_line", sa.Text(), nullable=False),
        sa.Column("summary", sa.Text(), nullable=False),
        sa.Column("bundle_json", sa.JSON(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index(
        "ix_video_understandings_video_created",
        "video_understandings",
        ["video_id", "created_at"],
    )

    op.create_table(
        "video_segments",
        sa.Column("id", sa.String(length=36), primary_key=True),
        sa.Column(
            "video_id",
            sa.String(length=36),
            sa.ForeignKey("videos.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "analysis_run_id",
            sa.String(length=36),
            sa.ForeignKey("analysis_runs.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("kind", sa.String(length=32), nullable=False),
        sa.Column("start_ms", sa.Integer(), nullable=False),
        sa.Column("end_ms", sa.Integer(), nullable=False),
        sa.Column("text", sa.Text(), nullable=True),
        sa.Column("asset_id", sa.String(length=36), sa.ForeignKey("video_assets.id"), nullable=True),
        sa.Column("confidence", sa.Float(), nullable=True),
        sa.Column("metadata_json", sa.JSON(), nullable=False, server_default=sa.text("'{}'")),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index(
        "ix_video_segments_video_kind_start",
        "video_segments",
        ["video_id", "kind", "start_ms"],
    )

    op.create_table(
        "taxonomy_runs",
        sa.Column("id", sa.String(length=36), primary_key=True),
        sa.Column("model_id", sa.String(length=160), nullable=False),
        sa.Column("status", sa.String(length=32), nullable=False),
        sa.Column("input_hash", sa.String(length=64), nullable=False),
        sa.Column("provider_response_id", sa.String(length=200), nullable=True),
        sa.Column("error_code", sa.String(length=64), nullable=True),
        sa.Column("error_message", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("completed_at", sa.DateTime(timezone=True), nullable=True),
    )

    op.create_table(
        "categories",
        sa.Column("id", sa.String(length=36), primary_key=True),
        sa.Column("parent_id", sa.String(length=36), sa.ForeignKey("categories.id"), nullable=True),
        sa.Column(
            "taxonomy_run_id",
            sa.String(length=36),
            sa.ForeignKey("taxonomy_runs.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("key", sa.String(length=100), nullable=False),
        sa.Column("level", sa.Integer(), nullable=False),
        sa.Column("name", sa.String(length=120), nullable=False),
        sa.Column("purpose", sa.Text(), nullable=False),
        sa.Column("sort_order", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.UniqueConstraint("taxonomy_run_id", "key", name="uq_taxonomy_category_key"),
    )
    op.create_index("ix_categories_parent_sort", "categories", ["parent_id", "sort_order"])

    op.create_table(
        "category_memberships",
        sa.Column(
            "category_id",
            sa.String(length=36),
            sa.ForeignKey("categories.id", ondelete="CASCADE"),
            primary_key=True,
        ),
        sa.Column(
            "video_id",
            sa.String(length=36),
            sa.ForeignKey("videos.id", ondelete="CASCADE"),
            primary_key=True,
        ),
        sa.Column("reason", sa.Text(), nullable=False),
        sa.Column("confidence", sa.Float(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index(
        "ix_category_memberships_video",
        "category_memberships",
        ["video_id"],
    )

    op.create_table(
        "job_events",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column(
            "job_id",
            sa.String(length=36),
            sa.ForeignKey("jobs.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("sequence", sa.Integer(), nullable=False),
        sa.Column("stage", sa.String(length=64), nullable=False),
        sa.Column("progress", sa.Integer(), nullable=False),
        sa.Column("message", sa.Text(), nullable=False),
        sa.Column("detail_json", sa.JSON(), nullable=False, server_default=sa.text("'{}'")),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.UniqueConstraint("job_id", "sequence", name="uq_job_event_sequence"),
    )
    op.create_index("ix_job_events_job_sequence", "job_events", ["job_id", "sequence"])

    op.create_table(
        "provider_calls",
        sa.Column("id", sa.String(length=36), primary_key=True),
        sa.Column(
            "analysis_run_id",
            sa.String(length=36),
            sa.ForeignKey("analysis_runs.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column("provider", sa.String(length=64), nullable=False),
        sa.Column("operation", sa.String(length=64), nullable=False),
        sa.Column("model_id", sa.String(length=160), nullable=True),
        sa.Column("status", sa.String(length=32), nullable=False),
        sa.Column("request_hash", sa.String(length=64), nullable=False),
        sa.Column("response_hash", sa.String(length=64), nullable=True),
        sa.Column("response_id", sa.String(length=200), nullable=True),
        sa.Column("duration_ms", sa.Integer(), nullable=False),
        sa.Column("error_code", sa.String(length=64), nullable=True),
        sa.Column("error_message", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index("ix_provider_calls_analysis", "provider_calls", ["analysis_run_id"])


def downgrade() -> None:
    op.drop_index("ix_provider_calls_analysis", table_name="provider_calls")
    op.drop_table("provider_calls")
    op.drop_index("ix_job_events_job_sequence", table_name="job_events")
    op.drop_table("job_events")
    op.drop_index("ix_category_memberships_video", table_name="category_memberships")
    op.drop_table("category_memberships")
    op.drop_index("ix_categories_parent_sort", table_name="categories")
    op.drop_table("categories")
    op.drop_table("taxonomy_runs")
    op.drop_index("ix_video_segments_video_kind_start", table_name="video_segments")
    op.drop_table("video_segments")
    op.drop_index("ix_video_understandings_video_created", table_name="video_understandings")
    op.drop_table("video_understandings")
    op.drop_index("ix_analysis_runs_cache_key", table_name="analysis_runs")
    op.drop_index("ix_analysis_runs_video_status", table_name="analysis_runs")
    op.drop_table("analysis_runs")
    op.drop_index("ix_video_assets_video_kind", table_name="video_assets")
    op.drop_table("video_assets")
    op.drop_table("permission_records")
    op.drop_index("ux_videos_source_hash", table_name="videos")
    for name in (
        "current_job_id",
        "analysis_version",
        "error_message",
        "error_code",
        "summary",
        "purpose_line",
        "duration_ms",
        "file_size_bytes",
        "mime_type",
        "original_filename",
        "source_hash",
    ):
        op.drop_column("videos", name)
