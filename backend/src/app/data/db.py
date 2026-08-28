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
    Column("kystvand_id", Integer, nullable=True, index=True),
    Column("retention", Float, nullable=True),
    Column("soil_id", Integer, nullable=True),
    Column("jbnr", SmallInteger, nullable=True),
    Column("area_ha", Float, nullable=False),
    Column("crop_rotation", Text, nullable=False),
    Column(
        "in_takeout_plan",
        Boolean,
        nullable=False,
        server_default=false(),
    ),
    Column("udledningsgraense_kgn_ha", Float, nullable=False, server_default="0"),
    Column("udledningskvote_mark_kgn", Float, nullable=False, server_default="0"),
    Column("crop_history", JSON, nullable=False),
    Column("geom", Geometry(geometry_type="MULTIPOLYGON", srid=4326), nullable=False),
    Column("centroid", Geometry(geometry_type="POINT", srid=4326), nullable=True),
    Column("sample_bucket", SmallInteger, nullable=True, index=True),
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

engine = create_engine(DATABASE_URL, pool_pre_ping=True)
SessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False)


def get_db() -> Generator[Session]:
    with SessionLocal() as session:
        yield session
