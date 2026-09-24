"""Consolidate per-code crop reference values into afgroede.

Revision ID: 20260925_0001
Revises: 20260922_0001
Create Date: 2026-09-25
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "20260925_0001"
down_revision: str | None = "20260922_0001"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

_NORM_COLUMNS = (
    "afgroede",
    "udbytteenhed",
    "p_norm",
    "forfrugtsvaerdi",
    "indregn_ffv",
)


def upgrade() -> None:
    op.create_table(
        "afgroede",
        sa.Column("afgroedekode", sa.Integer(), primary_key=True, autoincrement=False),
        sa.Column("navn", sa.Text(), nullable=True),
        sa.Column("norm_navn", sa.Text(), nullable=True),
        sa.Column("permanent", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("has_nuar", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("m", sa.SmallInteger(), nullable=True),
        sa.Column("w", sa.SmallInteger(), nullable=True),
        sa.Column("wc", sa.SmallInteger(), nullable=True),
        sa.Column("mp", sa.SmallInteger(), nullable=True),
        sa.Column("wp", sa.SmallInteger(), nullable=True),
        sa.Column("m_ambig", sa.Boolean(), nullable=True),
        sa.Column("w_ambig", sa.Boolean(), nullable=True),
        sa.Column("wc_ambig", sa.Boolean(), nullable=True),
        sa.Column("mp_ambig", sa.Boolean(), nullable=True),
        sa.Column("wp_ambig", sa.Boolean(), nullable=True),
        sa.Column("standard_kategori", sa.SmallInteger(), nullable=True),
        sa.Column("vinterdaekke_kategori", sa.SmallInteger(), nullable=True),
        sa.Column("udbytteenhed", sa.Text(), nullable=True),
        sa.Column("p_norm", sa.Float(), nullable=True),
        sa.Column("forfrugtsvaerdi", sa.Float(), nullable=True),
        sa.Column("indregn_ffv", sa.Boolean(), nullable=True),
        sa.CheckConstraint("afgroedekode > 0", name="ck_afgroede_positive_code"),
    )
    connection = op.get_bind()
    connection.execute(
        sa.text("""
        INSERT INTO afgroede (
            afgroedekode, navn, has_nuar, m, w, wc, mp, wp,
            m_ambig, w_ambig, wc_ambig, mp_ambig, wp_ambig
        )
        SELECT afgroedekode, navn, true, m, w, wc, mp, wp,
               m_ambig, w_ambig, wc_ambig, mp_ambig, wp_ambig
        FROM nuar_kode WHERE afgroedekode > 0
    """)
    )
    connection.execute(
        sa.text("""
        INSERT INTO afgroede (afgroedekode, standard_kategori, vinterdaekke_kategori)
        SELECT afgroedekode, standard_kategori, vinterdaekke_kategori
        FROM afstromningskategori WHERE afgroedekode > 0
        ON CONFLICT (afgroedekode) DO UPDATE SET
            standard_kategori = EXCLUDED.standard_kategori,
            vinterdaekke_kategori = EXCLUDED.vinterdaekke_kategori
    """)
    )

    # These columns are moved only because each has exactly one value per code.
    constants: dict[int, tuple] = {}
    rows = connection.execute(
        sa.text("""
        SELECT afgroedekode, afgroede, udbytteenhed, p_norm,
               forfrugtsvaerdi, indregn_ffv
        FROM afgroede_norm_lookup WHERE afgroedekode > 0 ORDER BY source_order, jb_nr
    """)
    )
    for row in rows:
        code = row.afgroedekode
        values = tuple(row[1:])
        if code in constants and constants[code] != values:
            raise ValueError(f"Nonconstant norm attributes for afgroedekode {code}")
        constants[code] = values
    for code, (name, unit, p_norm, predecessor, include_predecessor) in constants.items():
        connection.execute(
            sa.text("""
            INSERT INTO afgroede (
                afgroedekode, navn, norm_navn, udbytteenhed, p_norm,
                forfrugtsvaerdi, indregn_ffv
            ) VALUES (
                :code, :name, :name, :unit, :p_norm, :predecessor, :include_predecessor
            )
            ON CONFLICT (afgroedekode) DO UPDATE SET
                navn = COALESCE(afgroede.navn, EXCLUDED.navn),
                norm_navn = EXCLUDED.norm_navn,
                udbytteenhed = EXCLUDED.udbytteenhed,
                p_norm = EXCLUDED.p_norm,
                forfrugtsvaerdi = EXCLUDED.forfrugtsvaerdi,
                indregn_ffv = EXCLUDED.indregn_ffv
        """),
            {
                "code": code,
                "name": name,
                "unit": unit,
                "p_norm": p_norm,
                "predecessor": predecessor,
                "include_predecessor": include_predecessor,
            },
        )
    connection.execute(
        sa.text("""
        INSERT INTO afgroede (afgroedekode)
        SELECT DISTINCT afgroedekode FROM afgroede_nfix_lookup
        WHERE afgroedekode > 0
        ON CONFLICT (afgroedekode) DO NOTHING
    """)
    )
    connection.execute(
        sa.text("""
        INSERT INTO afgroede (afgroedekode)
        SELECT DISTINCT value::integer
        FROM registry_field, LATERAL json_each_text(crop_history) AS history(year, value)
        WHERE value ~ '^[0-9]+$' AND value::integer > 0
        ON CONFLICT (afgroedekode) DO NOTHING
    """)
    )

    connection.execute(
        sa.text("""
        INSERT INTO afgroede (afgroedekode, navn, permanent)
        SELECT afgroedekode, navn, true FROM permanent_afgrode WHERE afgroedekode > 0
        ON CONFLICT (afgroedekode) DO UPDATE SET
            navn = COALESCE(afgroede.navn, EXCLUDED.navn),
            permanent = true
    """)
    )

    op.drop_table("permanent_afgrode")
    op.drop_table("afstromningskategori")
    op.drop_table("nuar_kode")
    for column in _NORM_COLUMNS:
        op.drop_column("afgroede_norm_lookup", column)


def downgrade() -> None:
    for column, kind in (
        ("afgroede", sa.Text()),
        ("udbytteenhed", sa.Text()),
        ("p_norm", sa.Float()),
        ("forfrugtsvaerdi", sa.Float()),
        ("indregn_ffv", sa.Boolean()),
    ):
        op.add_column("afgroede_norm_lookup", sa.Column(column, kind, nullable=True))
    connection = op.get_bind()
    connection.execute(
        sa.text("""
        UPDATE afgroede_norm_lookup AS norm SET
            afgroede = COALESCE(crop.norm_navn, crop.navn, norm.afgroedekode::text),
            udbytteenhed = COALESCE(crop.udbytteenhed, ''),
            p_norm = crop.p_norm,
            forfrugtsvaerdi = COALESCE(crop.forfrugtsvaerdi, 0),
            indregn_ffv = COALESCE(crop.indregn_ffv, false)
        FROM afgroede AS crop WHERE crop.afgroedekode = norm.afgroedekode
    """)
    )
    for column in ("afgroede", "udbytteenhed", "forfrugtsvaerdi", "indregn_ffv"):
        op.alter_column("afgroede_norm_lookup", column, nullable=False)

    op.create_table(
        "nuar_kode",
        sa.Column("afgroedekode", sa.Integer(), primary_key=True, autoincrement=False),
        sa.Column("navn", sa.Text(), nullable=False),
        *(
            sa.Column(name, sa.SmallInteger(), nullable=True)
            for name in ("m", "w", "wc", "mp", "wp")
        ),
        *(
            sa.Column(name, sa.Boolean(), nullable=False)
            for name in (
                "m_ambig",
                "w_ambig",
                "wc_ambig",
                "mp_ambig",
                "wp_ambig",
            )
        ),
    )
    connection.execute(
        sa.text("""
        INSERT INTO nuar_kode (
            afgroedekode, navn, m, w, wc, mp, wp,
            m_ambig, w_ambig, wc_ambig, mp_ambig, wp_ambig
        )
        SELECT afgroedekode, COALESCE(navn, afgroedekode::text), m, w, wc, mp, wp,
               COALESCE(m_ambig, false), COALESCE(w_ambig, false),
               COALESCE(wc_ambig, false), COALESCE(mp_ambig, false),
               COALESCE(wp_ambig, false)
        FROM afgroede WHERE has_nuar
    """)
    )
    op.create_table(
        "afstromningskategori",
        sa.Column("afgroedekode", sa.Integer(), primary_key=True, autoincrement=False),
        sa.Column("standard_kategori", sa.SmallInteger(), nullable=False),
        sa.Column("vinterdaekke_kategori", sa.SmallInteger(), nullable=True),
    )
    connection.execute(
        sa.text("""
        INSERT INTO afstromningskategori (
            afgroedekode, standard_kategori, vinterdaekke_kategori
        )
        SELECT afgroedekode, standard_kategori, vinterdaekke_kategori
        FROM afgroede WHERE standard_kategori IS NOT NULL
    """)
    )
    op.create_table(
        "permanent_afgrode",
        sa.Column("afgroedekode", sa.Integer(), nullable=False, autoincrement=False),
        sa.Column("navn", sa.Text(), nullable=False),
        sa.PrimaryKeyConstraint("afgroedekode"),
    )
    connection.execute(
        sa.text("""
        INSERT INTO permanent_afgrode (afgroedekode, navn)
        SELECT afgroedekode, COALESCE(navn, norm_navn, afgroedekode::text)
        FROM afgroede WHERE permanent
    """)
    )
    op.drop_table("afgroede")
