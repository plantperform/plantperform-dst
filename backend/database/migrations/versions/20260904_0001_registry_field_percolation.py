"""add registry_field percolation/org_n_topsoil/s_soil

Revision ID: 20260904_0001
Revises: 20260831_0001
Create Date: 2026-09-04

Real per-field replacements for services.soil.percolation_placeholder's flat,
shared P/S/NT constants (jf. dens docstring: "Rigtige per-mark P/S-værdier...
kommer på markniveau senere" — de er nu ankommet i den nye
V1_1_IMK2026_n604144_gpkg-kilde).

percolation_by_kategori: JSON-dict {"1".."8": perkolationsværdi}, én pr.
afstrømningskategori (Bilag 7 tabel 1) — samme 8-kategori-nøglerum som
services.rotations.afstromning.afstromningskategori() allerede bruger til at
vælge hvilken af de 8 P-værdier der gælder for en given afgrøde. Kildens 8
P_-kolonner (P_vaarbygudl, P_graes, P_vaarbyg, p_Vhvede, p_Vraps, P_majs,
P_kart, P_roer) er navngivet efter afstrømningskategoriernes referenceafgrøde,
IKKE efter kategorinummer — nøglen her er derfor deres KOLONNEREKKEFØLGE i
kildefilen (1-8), ikke deres navn.

org_n_topsoil/s_soil: fra kildens orgNtopsoil2024/S_soil2024 — erstatter
percolation_placeholder's flade NT=3.0/S=0.9919 (samme tal for alle marker i
hele landet).
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "20260904_0001"
down_revision: str | None = "20260831_0001"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("registry_field", sa.Column("percolation_by_kategori", sa.JSON(), nullable=True))
    op.add_column("registry_field", sa.Column("org_n_topsoil", sa.Float(), nullable=True))
    op.add_column("registry_field", sa.Column("s_soil", sa.Float(), nullable=True))


def downgrade() -> None:
    op.drop_column("registry_field", "s_soil")
    op.drop_column("registry_field", "org_n_topsoil")
    op.drop_column("registry_field", "percolation_by_kategori")
