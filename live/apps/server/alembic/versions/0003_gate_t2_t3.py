"""Add the Gate T2/T3 workspace and artifact compiler tables.

Revision ID: 0003_gate_t2_t3
Revises: 0002_gate_t1
Create Date: 2026-07-22 09:00:00
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "0003_gate_t2_t3"
down_revision: str | None = "0002_gate_t1"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "workspaces",
        sa.Column(
            "launch_scope_json",
            sa.JSON(),
            nullable=False,
            # Keep whitespace after the colon: SQLAlchemy text() otherwise
            # interprets ``:null`` as a bind parameter and emits invalid JSON.
            server_default=sa.text(
                "'{\"mode\":\"home\",\"category_id\": null,\"video_ids\":[]}'"
            ),
        ),
    )
    op.add_column(
        "workspaces",
        sa.Column(
            "confirmed_constraints_json",
            sa.JSON(),
            nullable=False,
            server_default=sa.text("'[]'"),
        ),
    )
    op.add_column(
        "workspaces",
        sa.Column("clarification_count", sa.Integer(), nullable=False, server_default="0"),
    )
    op.add_column("workspaces", sa.Column("active_job_id", sa.String(length=36), nullable=True))
    op.add_column(
        "workspaces", sa.Column("current_artifact_id", sa.String(length=36), nullable=True)
    )

    op.create_table(
        "workspace_messages",
        sa.Column("id", sa.String(length=36), primary_key=True),
        sa.Column(
            "workspace_id",
            sa.String(length=36),
            sa.ForeignKey("workspaces.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("role", sa.String(length=32), nullable=False),
        sa.Column("content", sa.Text(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index(
        "ix_workspace_messages_workspace_created",
        "workspace_messages",
        ["workspace_id", "created_at"],
    )

    op.create_table(
        "workspace_sources",
        sa.Column("id", sa.String(length=36), primary_key=True),
        sa.Column(
            "workspace_id",
            sa.String(length=36),
            sa.ForeignKey("workspaces.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "video_id",
            sa.String(length=36),
            sa.ForeignKey("videos.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("decision", sa.String(length=16), nullable=False),
        sa.Column("reason", sa.Text(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.UniqueConstraint("workspace_id", "video_id", name="uq_workspace_source_video"),
    )
    op.create_index(
        "ix_workspace_sources_workspace_decision",
        "workspace_sources",
        ["workspace_id", "decision"],
    )

    op.create_table(
        "artifacts",
        sa.Column("id", sa.String(length=36), primary_key=True),
        sa.Column(
            "workspace_id",
            sa.String(length=36),
            sa.ForeignKey("workspaces.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "kind",
            sa.String(length=64),
            nullable=False,
            server_default="shooting_task_card",
        ),
        sa.Column("title", sa.String(length=300), nullable=False),
        sa.Column("purpose", sa.Text(), nullable=False),
        sa.Column("conflicts_json", sa.JSON(), nullable=False, server_default=sa.text("'[]'")),
        sa.Column(
            "uncertainties_json", sa.JSON(), nullable=False, server_default=sa.text("'[]'")
        ),
        sa.Column("compact_variant_json", sa.JSON(), nullable=True),
        sa.Column("version", sa.Integer(), nullable=False, server_default="1"),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.UniqueConstraint("workspace_id", name="uq_artifact_workspace"),
    )

    op.create_table(
        "artifact_versions",
        sa.Column("id", sa.String(length=36), primary_key=True),
        sa.Column(
            "artifact_id",
            sa.String(length=36),
            sa.ForeignKey("artifacts.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("version", sa.Integer(), nullable=False),
        sa.Column("document_json", sa.JSON(), nullable=False),
        sa.Column("instruction", sa.Text(), nullable=True),
        sa.Column(
            "job_id",
            sa.String(length=36),
            sa.ForeignKey("jobs.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.UniqueConstraint("artifact_id", "version", name="uq_artifact_version"),
    )
    op.create_index(
        "ix_artifact_versions_artifact_created",
        "artifact_versions",
        ["artifact_id", "created_at"],
    )

    op.create_table(
        "artifact_sections",
        sa.Column("id", sa.String(length=36), primary_key=True),
        sa.Column(
            "artifact_id",
            sa.String(length=36),
            sa.ForeignKey("artifacts.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("title", sa.String(length=120), nullable=False),
        sa.Column("sort_order", sa.Integer(), nullable=False),
        sa.UniqueConstraint("artifact_id", "sort_order", name="uq_artifact_section_order"),
    )

    op.create_table(
        "artifact_items",
        sa.Column("id", sa.String(length=36), primary_key=True),
        sa.Column(
            "artifact_id",
            sa.String(length=36),
            sa.ForeignKey("artifacts.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "section_id",
            sa.String(length=36),
            sa.ForeignKey("artifact_sections.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("text", sa.Text(), nullable=False),
        sa.Column("detail", sa.Text(), nullable=True),
        sa.Column("checked", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("adjustment_rule", sa.Text(), nullable=True),
        sa.Column("sort_order", sa.Integer(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index(
        "ix_artifact_items_section_order", "artifact_items", ["section_id", "sort_order"]
    )

    op.create_table(
        "provenance_refs",
        sa.Column("id", sa.String(length=36), primary_key=True),
        sa.Column(
            "workspace_id",
            sa.String(length=36),
            sa.ForeignKey("workspaces.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("kind", sa.String(length=16), nullable=False),
        sa.Column("source_id", sa.String(length=200), nullable=False),
        sa.Column("evidence_summary", sa.Text(), nullable=False),
        sa.Column("confidence", sa.Float(), nullable=True),
        sa.Column("start_ms", sa.Integer(), nullable=True),
        sa.Column("end_ms", sa.Integer(), nullable=True),
        sa.Column("retrieved_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("web_title", sa.Text(), nullable=True),
        sa.Column("web_url", sa.Text(), nullable=True),
        sa.Column("web_publisher", sa.String(length=300), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index(
        "ix_provenance_workspace_kind", "provenance_refs", ["workspace_id", "kind"]
    )

    op.create_table(
        "artifact_item_provenance",
        sa.Column(
            "item_id",
            sa.String(length=36),
            sa.ForeignKey("artifact_items.id", ondelete="CASCADE"),
            primary_key=True,
        ),
        sa.Column(
            "provenance_id",
            sa.String(length=36),
            sa.ForeignKey("provenance_refs.id", ondelete="CASCADE"),
            primary_key=True,
        ),
    )

    with op.batch_alter_table("provider_calls") as batch_op:
        batch_op.add_column(sa.Column("workspace_id", sa.String(length=36), nullable=True))
        batch_op.add_column(sa.Column("job_id", sa.String(length=36), nullable=True))
        batch_op.create_foreign_key(
            "fk_provider_calls_workspace_id",
            "workspaces",
            ["workspace_id"],
            ["id"],
            ondelete="SET NULL",
        )
        batch_op.create_foreign_key(
            "fk_provider_calls_job_id",
            "jobs",
            ["job_id"],
            ["id"],
            ondelete="SET NULL",
        )
    op.create_index("ix_provider_calls_workspace", "provider_calls", ["workspace_id"])


def downgrade() -> None:
    op.drop_index("ix_provider_calls_workspace", table_name="provider_calls")
    with op.batch_alter_table("provider_calls") as batch_op:
        batch_op.drop_constraint("fk_provider_calls_job_id", type_="foreignkey")
        batch_op.drop_constraint("fk_provider_calls_workspace_id", type_="foreignkey")
        batch_op.drop_column("job_id")
        batch_op.drop_column("workspace_id")
    op.drop_table("artifact_item_provenance")
    op.drop_index("ix_provenance_workspace_kind", table_name="provenance_refs")
    op.drop_table("provenance_refs")
    op.drop_index("ix_artifact_items_section_order", table_name="artifact_items")
    op.drop_table("artifact_items")
    op.drop_table("artifact_sections")
    op.drop_index("ix_artifact_versions_artifact_created", table_name="artifact_versions")
    op.drop_table("artifact_versions")
    op.drop_table("artifacts")
    op.drop_index("ix_workspace_sources_workspace_decision", table_name="workspace_sources")
    op.drop_table("workspace_sources")
    op.drop_index("ix_workspace_messages_workspace_created", table_name="workspace_messages")
    op.drop_table("workspace_messages")
    for name in (
        "current_artifact_id",
        "active_job_id",
        "clarification_count",
        "confirmed_constraints_json",
        "launch_scope_json",
    ):
        op.drop_column("workspaces", name)
