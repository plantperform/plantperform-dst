from pydantic import field_validator

from app.domain.base import CamelModel


class UpdateFieldAliasRequest(CamelModel):
    alias: str | None

    @field_validator("alias")
    @classmethod
    def normalize_alias(cls, value: str | None) -> str | None:
        return (value.strip() or None) if value is not None else None


class FieldAlias(CamelModel):
    field_key: str
    alias: str | None
