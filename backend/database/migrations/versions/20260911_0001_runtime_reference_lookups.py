"""create database-backed runtime reference lookups

Revision ID: 20260911_0001
Revises: 20260910_0002
Create Date: 2026-09-11
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "20260911_0001"
down_revision: str | None = "20260910_0002"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "afgroede_norm_lookup",
        sa.Column("source_order", sa.Integer(), nullable=False, autoincrement=False),
        sa.Column("jb_nr", sa.SmallInteger(), nullable=False),
        sa.Column("afgroedekode", sa.Integer(), nullable=False),
        sa.Column("afgroede", sa.Text(), nullable=False),
        sa.Column("jb_gruppe", sa.Text(), nullable=False),
        sa.Column("vanding", sa.Text(), nullable=False),
        sa.Column("udbytteenhed", sa.Text(), nullable=False),
        sa.Column("udbyttenorm", sa.Float(), nullable=True),
        sa.Column("udbyttenorm_alt", sa.Float(), nullable=True),
        sa.Column("n_norm", sa.Float(), nullable=True),
        sa.Column("p_norm", sa.Float(), nullable=True),
        sa.Column("forfrugtsvaerdi", sa.Float(), nullable=False),
        sa.Column("indregn_ffv", sa.Boolean(), nullable=False),
        sa.Column("driftsform", sa.Text(), nullable=False),
        sa.PrimaryKeyConstraint("source_order", "jb_nr"),
    )
    op.create_index(
        "ix_afgroede_norm_lookup_runtime",
        "afgroede_norm_lookup",
        ["afgroedekode", "jb_nr", "vanding", "source_order"],
    )
    op.create_table(
        "afgroede_nfix_lookup",
        sa.Column("source_order", sa.Integer(), nullable=False, autoincrement=False),
        sa.Column("jb_nr", sa.SmallInteger(), nullable=False),
        sa.Column("afgroedekode", sa.Integer(), nullable=False, autoincrement=False),
        sa.Column("vanding", sa.Text(), nullable=False),
        sa.Column("nfix_kgn_ha", sa.Float(), nullable=False),
        sa.PrimaryKeyConstraint("source_order", "jb_nr"),
    )
    op.create_index(
        "ix_afgroede_nfix_lookup_runtime",
        "afgroede_nfix_lookup",
        ["afgroedekode", "jb_nr", "vanding", "source_order"],
    )
    op.create_table(
        "nuar_kode",
        sa.Column("afgroedekode", sa.Integer(), nullable=False, autoincrement=False),
        sa.Column("navn", sa.Text(), nullable=False),
        sa.Column("m", sa.SmallInteger(), nullable=True),
        sa.Column("w", sa.SmallInteger(), nullable=True),
        sa.Column("wc", sa.SmallInteger(), nullable=True),
        sa.Column("mp", sa.SmallInteger(), nullable=True),
        sa.Column("wp", sa.SmallInteger(), nullable=True),
        sa.Column("m_ambig", sa.Boolean(), nullable=False),
        sa.Column("w_ambig", sa.Boolean(), nullable=False),
        sa.Column("wc_ambig", sa.Boolean(), nullable=False),
        sa.Column("mp_ambig", sa.Boolean(), nullable=False),
        sa.Column("wp_ambig", sa.Boolean(), nullable=False),
        sa.PrimaryKeyConstraint("afgroedekode"),
    )
    op.create_table(
        "afstromningskategori",
        sa.Column("afgroedekode", sa.Integer(), nullable=False, autoincrement=False),
        sa.Column("standard_kategori", sa.SmallInteger(), nullable=False),
        sa.Column("vinterdaekke_kategori", sa.SmallInteger(), nullable=True),
        sa.PrimaryKeyConstraint("afgroedekode"),
    )
    op.create_table(
        "salgspris",
        sa.Column("source_order", sa.Integer(), nullable=False, autoincrement=False),
        sa.Column("afgroedekode", sa.Integer(), nullable=False),
        sa.Column("driftsform", sa.Text(), nullable=False),
        sa.Column("kvalitet", sa.Text(), nullable=False),
        sa.Column("salgspris", sa.Float(), nullable=False),
        sa.Column("enhed", sa.Text(), nullable=False),
        sa.Column("halm_pris_kr_kg", sa.Float(), nullable=False),
        sa.PrimaryKeyConstraint("source_order"),
    )
    op.create_index(
        "ix_salgspris_lookup", "salgspris", ["afgroedekode", "driftsform", "kvalitet"],
    )
    op.create_table(
        "halmudbytte",
        sa.Column("source_order", sa.Integer(), nullable=False, autoincrement=False),
        sa.Column("afgroedekode", sa.Integer(), nullable=False),
        sa.Column("jordbonitet", sa.Text(), nullable=False),
        sa.Column("halm_udbytte_kg_ha", sa.Float(), nullable=False),
        sa.PrimaryKeyConstraint("source_order"),
    )
    op.create_index("ix_halmudbytte_lookup", "halmudbytte", ["afgroedekode", "jordbonitet"])
    op.create_table(
        "arbejdssats",
        sa.Column("source_order", sa.Integer(), nullable=False, autoincrement=False),
        sa.Column("behandling", sa.Text(), nullable=False),
        sa.Column("jordbonitet", sa.Text(), nullable=False),
        sa.Column("afgroedekode", sa.Integer(), nullable=True),
        sa.Column("driftsform", sa.Text(), nullable=False),
        sa.Column("pris_kr_per_enhed", sa.Float(), nullable=False),
        sa.PrimaryKeyConstraint("source_order"),
    )
    op.create_index("ix_arbejdssats_lookup", "arbejdssats", ["behandling", "jordbonitet"])
    op.create_table(
        "arbejdsmaengde",
        sa.Column("source_order", sa.Integer(), nullable=False, autoincrement=False),
        sa.Column("afgroedekode", sa.Integer(), nullable=False),
        sa.Column("driftsform", sa.Text(), nullable=False),
        sa.Column("jordbonitet", sa.Text(), nullable=False),
        sa.Column("kvalitet", sa.Text(), nullable=False),
        sa.Column("kategori", sa.Text(), nullable=False),
        sa.Column("behandling", sa.Text(), nullable=False),
        sa.Column("antal", sa.Float(), nullable=False),
        sa.PrimaryKeyConstraint("source_order"),
    )
    op.create_index(
        "ix_arbejdsmaengde_lookup",
        "arbejdsmaengde",
        ["afgroedekode", "driftsform", "jordbonitet", "kvalitet"],
    )
    op.create_table(
        "dyrkningsomkostning",
        sa.Column("source_order", sa.Integer(), nullable=False, autoincrement=False),
        sa.Column("afgroedekode", sa.Integer(), nullable=False),
        sa.Column("driftsform", sa.Text(), nullable=False),
        sa.Column("kategori", sa.Text(), nullable=False),
        sa.Column("behandling", sa.Text(), nullable=False),
        sa.Column("udgift_kr_ha", sa.Float(), nullable=False),
        sa.PrimaryKeyConstraint("source_order"),
    )
    op.create_index(
        "ix_dyrkningsomkostning_lookup",
        "dyrkningsomkostning",
        ["afgroedekode", "driftsform"],
    )
    op.create_table(
        "prisliste",
        sa.Column("source_order", sa.Integer(), nullable=False, autoincrement=False),
        sa.Column("post", sa.Text(), nullable=False),
        sa.Column("kategori", sa.Text(), nullable=False),
        sa.Column("type", sa.Text(), nullable=False),
        sa.Column("pris", sa.Float(), nullable=False),
        sa.Column("enhed", sa.Text(), nullable=False),
        sa.PrimaryKeyConstraint("source_order"),
    )
    op.create_index("ix_prisliste_lookup", "prisliste", ["post"])


def downgrade() -> None:
    op.drop_table("prisliste")
    op.drop_table("dyrkningsomkostning")
    op.drop_table("arbejdsmaengde")
    op.drop_table("arbejdssats")
    op.drop_table("halmudbytte")
    op.drop_table("salgspris")
    op.drop_table("afstromningskategori")
    op.drop_table("nuar_kode")
    op.drop_table("afgroede_nfix_lookup")
    op.drop_table("afgroede_norm_lookup")
