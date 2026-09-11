import os
from collections.abc import Generator
from pathlib import Path

from dotenv import load_dotenv
from geoalchemy2 import Geometry
from sqlalchemy import (
    JSON,
    BigInteger,
    Boolean,
    CheckConstraint,
    Column,
    DateTime,
    Float,
    ForeignKey,
    Index,
    Integer,
    MetaData,
    PrimaryKeyConstraint,
    SmallInteger,
    Table,
    Text,
    create_engine,
    false,
    func,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Session, sessionmaker

ROOT = Path(__file__).resolve().parents[3]

load_dotenv(ROOT / ".env")
load_dotenv()

DATABASE_URL = os.getenv("DATABASE_URL")

metadata = MetaData()

registry_field_table = Table(
    "registry_field",
    metadata,
    Column("imk_id", BigInteger, primary_key=True),
    Column("cvr", Text, nullable=True, index=True),
    Column("marknr", Text, nullable=True),
    Column("markblok", Text, nullable=True),
    Column("journalnr", Text, nullable=True),
    Column("kystvand_id", Integer, nullable=True, index=True),
    Column("kystvand_navn", Text, nullable=True),
    Column("retention", Float, nullable=True),
    Column("jbnr", SmallInteger, nullable=True),
    Column("area_ha", Float, nullable=False),
    Column("crop_rotation", Text, nullable=False),
    Column(
        "in_takeout_plan",
        Text,
        nullable=False,
        server_default="nej",
    ),
    Column("udledningsgraense_kgn_ha", Float, nullable=False, server_default="0"),
    Column("udledningskvote_mark_kgn", Float, nullable=False, server_default="0"),
    Column("oeko", Boolean, nullable=False, server_default=false()),
    Column("oestoette", Boolean, nullable=False, server_default=false()),
    Column("hoejeste_hnv", SmallInteger, nullable=True),
    Column("omlaegningsplan_virkemiddel", Text, nullable=True),
    Column("omlaegningsplan_status", Text, nullable=True),
    Column("goedningsregion", Text, nullable=True),
    Column("kvotegivende", Boolean, nullable=False, server_default=false()),
    Column("crop_history", JSON, nullable=False),
    Column("percolation_by_kategori", JSON, nullable=True),
    Column("org_n_topsoil", Float, nullable=True),
    Column("s_soil", Float, nullable=True),
    Column("banned", Boolean, nullable=False, server_default=false()),
    Column("geom", Geometry(geometry_type="MULTIPOLYGON", srid=4326), nullable=False),
    Column("centroid", Geometry(geometry_type="POINT", srid=4326), nullable=True),
    Column("sample_bucket", SmallInteger, nullable=True, index=True),
)

mars_projekt_table = Table(
    "mars_projekt",
    metadata,
    Column("mars_id", Text, primary_key=True),
    Column("titel", Text, nullable=True),
    Column("sags_id", Text, nullable=True),
    Column("areal_ha", Float, nullable=True),
    Column("tilskudsordning", Text, nullable=True),
    Column("status", Text, nullable=True),
    Column("ansoeger", Text, nullable=True),
    Column("ansoegningsrunde_aar", Integer, nullable=True),
    Column("kvaelstofeffekt_t", Float, nullable=True),
    Column("udtagningseffekt_ha", Float, nullable=True),
    Column("skovrejsningseffekt_ha", Float, nullable=True),
    Column("virkemiddel", Text, nullable=True),
    Column("bemaerkning", Text, nullable=True),
    Column("geom", Geometry(geometry_type="MULTIPOLYGON", srid=4326), nullable=False),
)

saedskifte_rotation_table = Table(
    "saedskifte_rotation",
    metadata,
    Column("saedskiftevariant", SmallInteger, primary_key=True),
    Column("variant", SmallInteger, primary_key=True),
    Column("rotation", JSON, nullable=False),
    Column("driftsform", Text, nullable=True),
)

saedskifte_category_table = Table(
    "saedskifte_category",
    metadata,
    Column("saedskiftevariant", SmallInteger, primary_key=True),
    Column("kategori", Text, primary_key=True),
)

# Runtime reference data is imported from the authoritative ANGJ source files
# by the focused loaders under database/scripts/.  These tables deliberately
# contain the lookup-ready, expanded form of the sources so the API never has
# to open a source workbook or CSV at request time.
afgroede_norm_lookup_table = Table(
    "afgroede_norm_lookup",
    metadata,
    Column("source_order", Integer, primary_key=True, autoincrement=False),
    Column("jb_nr", SmallInteger, primary_key=True),
    Column("afgroedekode", Integer, nullable=False),
    Column("afgroede", Text, nullable=False),
    Column("jb_gruppe", Text, nullable=False),
    Column("vanding", Text, nullable=False),
    Column("udbytteenhed", Text, nullable=False),
    Column("udbyttenorm", Float, nullable=True),
    Column("udbyttenorm_alt", Float, nullable=True),
    Column("n_norm", Float, nullable=True),
    Column("p_norm", Float, nullable=True),
    Column("forfrugtsvaerdi", Float, nullable=False),
    Column("indregn_ffv", Boolean, nullable=False),
    Column("driftsform", Text, nullable=False),
    Index(
        "ix_afgroede_norm_lookup_runtime",
        "afgroedekode",
        "jb_nr",
        "vanding",
        "source_order",
    ),
)

afgroede_nfix_lookup_table = Table(
    "afgroede_nfix_lookup",
    metadata,
    Column("source_order", Integer, primary_key=True, autoincrement=False),
    Column("jb_nr", SmallInteger, primary_key=True),
    Column("afgroedekode", Integer, nullable=False),
    Column("vanding", Text, nullable=False),
    Column("nfix_kgn_ha", Float, nullable=False),
    Index(
        "ix_afgroede_nfix_lookup_runtime",
        "afgroedekode",
        "jb_nr",
        "vanding",
        "source_order",
    ),
)

nuar_kode_table = Table(
    "nuar_kode",
    metadata,
    Column("afgroedekode", Integer, primary_key=True, autoincrement=False),
    Column("navn", Text, nullable=False),
    Column("m", SmallInteger, nullable=True),
    Column("w", SmallInteger, nullable=True),
    Column("wc", SmallInteger, nullable=True),
    Column("mp", SmallInteger, nullable=True),
    Column("wp", SmallInteger, nullable=True),
    Column("m_ambig", Boolean, nullable=False),
    Column("w_ambig", Boolean, nullable=False),
    Column("wc_ambig", Boolean, nullable=False),
    Column("mp_ambig", Boolean, nullable=False),
    Column("wp_ambig", Boolean, nullable=False),
)

afstromningskategori_table = Table(
    "afstromningskategori",
    metadata,
    Column("afgroedekode", Integer, primary_key=True, autoincrement=False),
    Column("standard_kategori", SmallInteger, nullable=False),
    Column("vinterdaekke_kategori", SmallInteger, nullable=True),
)

salgspris_table = Table(
    "salgspris",
    metadata,
    Column("source_order", Integer, primary_key=True, autoincrement=False),
    Column("afgroedekode", Integer, nullable=False),
    Column("driftsform", Text, nullable=False),
    Column("kvalitet", Text, nullable=False),
    Column("salgspris", Float, nullable=False),
    Column("enhed", Text, nullable=False),
    Column("halm_pris_kr_kg", Float, nullable=False),
    Index("ix_salgspris_lookup", "afgroedekode", "driftsform", "kvalitet"),
)

halmudbytte_table = Table(
    "halmudbytte",
    metadata,
    Column("source_order", Integer, primary_key=True, autoincrement=False),
    Column("afgroedekode", Integer, nullable=False),
    Column("jordbonitet", Text, nullable=False),
    Column("halm_udbytte_kg_ha", Float, nullable=False),
    Index("ix_halmudbytte_lookup", "afgroedekode", "jordbonitet"),
)

arbejdssats_table = Table(
    "arbejdssats",
    metadata,
    Column("source_order", Integer, primary_key=True, autoincrement=False),
    Column("behandling", Text, nullable=False),
    Column("jordbonitet", Text, nullable=False),
    Column("afgroedekode", Integer, nullable=True),
    Column("driftsform", Text, nullable=False),
    Column("pris_kr_per_enhed", Float, nullable=False),
    Index("ix_arbejdssats_lookup", "behandling", "jordbonitet"),
)

arbejdsmaengde_table = Table(
    "arbejdsmaengde",
    metadata,
    Column("source_order", Integer, primary_key=True, autoincrement=False),
    Column("afgroedekode", Integer, nullable=False),
    Column("driftsform", Text, nullable=False),
    Column("jordbonitet", Text, nullable=False),
    Column("kvalitet", Text, nullable=False),
    Column("kategori", Text, nullable=False),
    Column("behandling", Text, nullable=False),
    Column("antal", Float, nullable=False),
    Index(
        "ix_arbejdsmaengde_lookup",
        "afgroedekode",
        "driftsform",
        "jordbonitet",
        "kvalitet",
    ),
)

dyrkningsomkostning_table = Table(
    "dyrkningsomkostning",
    metadata,
    Column("source_order", Integer, primary_key=True, autoincrement=False),
    Column("afgroedekode", Integer, nullable=False),
    Column("driftsform", Text, nullable=False),
    Column("kategori", Text, nullable=False),
    Column("behandling", Text, nullable=False),
    Column("udgift_kr_ha", Float, nullable=False),
    Index("ix_dyrkningsomkostning_lookup", "afgroedekode", "driftsform"),
)

prisliste_table = Table(
    "prisliste",
    metadata,
    Column("source_order", Integer, primary_key=True, autoincrement=False),
    Column("post", Text, nullable=False),
    Column("kategori", Text, nullable=False),
    Column("type", Text, nullable=False),
    Column("pris", Float, nullable=False),
    Column("enhed", Text, nullable=False),
    Index("ix_prisliste_lookup", "post"),
)

historisk_goedningsfordeling_table = Table(
    "historisk_goedningsfordeling",
    metadata,
    Column("id", Integer, primary_key=True, autoincrement=True),
    Column("region", Text, nullable=False),
    Column("driftsform", Text, nullable=False),
    Column("afgroedekode", Integer, nullable=False),
    Column("jb_nr", SmallInteger, nullable=False),
    Column("n_type", Text, nullable=False),
    Column("vaerdi", Float, nullable=False),
    Index(
        "ix_historisk_goedningsfordeling_lookup",
        "region",
        "driftsform",
        "afgroedekode",
        "jb_nr",
        "n_type",
        unique=True,
    ),
)

farm_table = Table(
    "farm",
    metadata,
    Column("id", Text, primary_key=True),
    Column("data", JSONB, nullable=False),
    Column("created_at", DateTime(timezone=True), nullable=False, server_default=func.now()),
    Column("updated_at", DateTime(timezone=True), nullable=False, server_default=func.now()),
)

field_table = Table(
    "field",
    metadata,
    Column("id", Text, primary_key=True),
    Column("farm_id", Text, ForeignKey("farm.id", ondelete="CASCADE"), nullable=False),
    Column("data", JSONB, nullable=False),
    Column("created_at", DateTime(timezone=True), nullable=False, server_default=func.now()),
    Column("updated_at", DateTime(timezone=True), nullable=False, server_default=func.now()),
    Index("ix_field_farm_id", "farm_id"),
)

simulation_table = Table(
    "simulation",
    metadata,
    Column("id", Text, primary_key=True),
    Column("farm_id", Text, ForeignKey("farm.id", ondelete="CASCADE"), nullable=False),
    Column("data", JSONB, nullable=False),
    Column("created_at", DateTime(timezone=True), nullable=False, server_default=func.now()),
    Column("updated_at", DateTime(timezone=True), nullable=False, server_default=func.now()),
    Index("ix_simulation_farm_id", "farm_id"),
)

simulation_field_table = Table(
    "simulation_field",
    metadata,
    Column("id", Text, primary_key=True),
    Column(
        "simulation_id",
        Text,
        ForeignKey("simulation.id", ondelete="CASCADE"),
        nullable=False,
    ),
    Column("data", JSONB, nullable=False),
    Column("created_at", DateTime(timezone=True), nullable=False, server_default=func.now()),
    Column("updated_at", DateTime(timezone=True), nullable=False, server_default=func.now()),
    Index("ix_simulation_field_simulation_id", "simulation_id"),
)

simulation_field_candidates_table = Table(
    "simulation_field_candidates",
    metadata,
    Column("id", Text, primary_key=True),
    Column(
        "simulation_id",
        Text,
        ForeignKey("simulation.id", ondelete="CASCADE"),
        nullable=False,
    ),
    Column("field_id", Text, nullable=False),
    Column("data", JSONB, nullable=False),
    Column("created_at", DateTime(timezone=True), nullable=False, server_default=func.now()),
    Column("updated_at", DateTime(timezone=True), nullable=False, server_default=func.now()),
    Index("ix_simulation_field_candidates_simulation_id", "simulation_id"),
    Index("ix_simulation_field_candidates_field_id", "field_id"),
)

app_user_table = Table(
    "app_user",
    metadata,
    Column("email", Text, primary_key=True),
    Column("password_hash", Text, nullable=False),
    Column("verified_at", DateTime(timezone=True), nullable=True),
    Column("created_at", DateTime(timezone=True), nullable=False, server_default=func.now()),
    Column("updated_at", DateTime(timezone=True), nullable=False, server_default=func.now()),
    CheckConstraint("email = lower(email)", name="ck_app_user_email_lowercase"),
)

farm_member_table = Table(
    "farm_member",
    metadata,
    Column("farm_id", Text, ForeignKey("farm.id", ondelete="CASCADE"), nullable=False),
    Column("email", Text, ForeignKey("app_user.email", ondelete="CASCADE"), nullable=False),
    Index("ix_farm_member_email", "email"),
    PrimaryKeyConstraint("farm_id", "email"),
)

email_verification_token_table = Table(
    "email_verification_token",
    metadata,
    Column("id", Text, primary_key=True),
    Column("email", Text, ForeignKey("app_user.email", ondelete="CASCADE"), nullable=False),
    Column("token_hash", Text, nullable=False, unique=True),
    Column("expires_at", DateTime(timezone=True), nullable=False),
    Column("used_at", DateTime(timezone=True), nullable=True),
    Column("created_at", DateTime(timezone=True), nullable=False, server_default=func.now()),
    Index("ix_email_verification_token_email", "email"),
)

refresh_session_table = Table(
    "auth_refresh_session",
    metadata,
    Column("id", Text, primary_key=True),
    Column("email", Text, ForeignKey("app_user.email", ondelete="CASCADE"), nullable=False),
    Column("family_id", Text, nullable=False),
    Column("token_hash", Text, nullable=False, unique=True),
    Column("expires_at", DateTime(timezone=True), nullable=False),
    Column("created_at", DateTime(timezone=True), nullable=False, server_default=func.now()),
    Column("used_at", DateTime(timezone=True), nullable=True),
    Column("revoked_at", DateTime(timezone=True), nullable=True),
    Index("ix_auth_refresh_session_email", "email"),
    Index("ix_auth_refresh_session_family_id", "family_id"),
)

engine = create_engine(DATABASE_URL, pool_pre_ping=True, pool_size=10, max_overflow=20)
SessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False)


def get_db() -> Generator[Session]:
    with SessionLocal() as session:
        yield session
