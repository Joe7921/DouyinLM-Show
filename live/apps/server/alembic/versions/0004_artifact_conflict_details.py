"""Add per-viewpoint provenance for Artifact conflicts.

Revision ID: 0004_artifact_conflict_details
Revises: 0003_gate_t2_t3
Create Date: 2026-07-23 08:00:00
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "0004_artifact_conflict_details"
down_revision: str | None = "0003_gate_t2_t3"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "artifacts",
        sa.Column(
            "conflict_details_json",
            sa.JSON(),
            nullable=False,
            server_default=sa.text("'[]'"),
        ),
    )


def downgrade() -> None:
    op.drop_column("artifacts", "conflict_details_json")
