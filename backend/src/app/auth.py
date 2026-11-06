import hashlib
import hmac
import logging
import os
import secrets
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from email.utils import formataddr
from typing import Annotated, Literal
from uuid import uuid4

import boto3
import jwt
from argon2 import PasswordHasher
from argon2.exceptions import InvalidHashError, VerificationError, VerifyMismatchError
from botocore.exceptions import ClientError
from fastapi import Depends, HTTPException, Request, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy import delete, select, update
from sqlalchemy.orm import Session

from app.data.db import (
    SessionLocal,
    app_user_table,
    email_verification_token_table,
    embed_key_table,
    password_reset_token_table,
    refresh_session_table,
)

PASSWORD_MIN_LENGTH = 6
ACCESS_TOKEN_TTL = timedelta(minutes=15)
REFRESH_TOKEN_TTL = timedelta(days=30)
VERIFICATION_TOKEN_TTL = timedelta(hours=24)
PASSWORD_RESET_TOKEN_TTL = timedelta(hours=1)
PASSWORD_RESET_RESEND_COOLDOWN = timedelta(minutes=1)
REFRESH_COOKIE_NAME = "dst_refresh_token"
EMBED_KEY_PREFIX = "pp_embed_"
PASSWORD_HASHER = PasswordHasher(
    time_cost=3,
    memory_cost=65536,
    parallelism=1,
    hash_len=32,
    salt_len=16,
)
DUMMY_PASSWORD_HASH = PASSWORD_HASHER.hash("dst-invalid-login-password")
LOGGER = logging.getLogger(__name__)
BEARER = HTTPBearer(auto_error=False)
BearerCredentials = Annotated[HTTPAuthorizationCredentials | None, Depends(BEARER)]


class InvalidCredentialsError(Exception):
    pass


class UnverifiedAccountError(Exception):
    pass


class InvalidVerificationTokenError(Exception):
    pass


class InvalidPasswordResetTokenError(Exception):
    pass


class InvalidRefreshTokenError(Exception):
    pass


@dataclass(frozen=True)
class AuthConfig:
    jwt_secret: str
    refresh_pepper: str
    public_app_url: str
    app_env: str
    ses_from_email: str
    cookie_secure: bool


@dataclass(frozen=True)
class AuthenticatedUser:
    email: str
    role: Literal["editor", "viewer"] = "editor"
    is_embed: bool = False


def viewer_read(endpoint):
    """Opt a reviewed GET endpoint into viewer access; other endpoints deny by default."""
    endpoint.viewer_read = True
    return endpoint


def embed_key_hash(key: str) -> str:
    return hashlib.sha256(key.encode()).hexdigest()


def get_embed_user(key: str) -> AuthenticatedUser | None:
    if len(key) != len(EMBED_KEY_PREFIX) + 43:
        return None
    with SessionLocal() as session:
        row = session.execute(
            select(app_user_table.c.email)
            .join(embed_key_table)
            .where(
                embed_key_table.c.token_hash == embed_key_hash(key),
                embed_key_table.c.revoked_at.is_(None),
                app_user_table.c.role == "viewer",
                app_user_table.c.verified_at.is_not(None),
            )
        ).first()
    return AuthenticatedUser(row.email, "viewer", True) if row is not None else None


@dataclass(frozen=True)
class TokenPair:
    access_token: str
    expires_in: int
    refresh_token: str
    email: str


def normalize_email(email: str) -> str:
    return email.strip().lower()


def configured_origins() -> list[str]:
    """Return the configured browser origins, defaulting to the public app URL."""
    configured = os.getenv("CORS_ORIGINS")
    if configured:
        origins = [origin.strip().rstrip("/") for origin in configured.split(",") if origin.strip()]
        if origins:
            return origins

    public_app_url = os.getenv("PUBLIC_APP_URL", "http://localhost:5173")
    return [origin.strip().rstrip("/") for origin in public_app_url.split(",") if origin.strip()]


def _config(require_mail: bool = False) -> AuthConfig:
    app_env = os.getenv("APP_ENV", "development").lower()
    jwt_secret = os.getenv("AUTH_JWT_SECRET", "")
    refresh_pepper = os.getenv("AUTH_REFRESH_PEPPER", "")
    if (
        len(jwt_secret) < 32
        or len(refresh_pepper) < 32
        or jwt_secret.startswith("replace-with-")
        or refresh_pepper.startswith("replace-with-")
    ):
        raise RuntimeError("AUTH_JWT_SECRET and AUTH_REFRESH_PEPPER must be at least 32 characters")

    ses_from_email = os.getenv("SES_FROM_EMAIL", "")
    if require_mail and app_env not in {"development", "test"} and not ses_from_email:
        raise RuntimeError("SES_FROM_EMAIL must be configured for authentication emails")

    return AuthConfig(
        jwt_secret=jwt_secret,
        refresh_pepper=refresh_pepper,
        public_app_url=os.getenv("PUBLIC_APP_URL", "http://localhost:5173").rstrip("/"),
        app_env=app_env,
        ses_from_email=ses_from_email,
        cookie_secure=app_env not in {"development", "test"},
    )


def hash_password(password: str) -> str:
    return PASSWORD_HASHER.hash(password)


def verify_password(password_hash: str, password: str) -> bool:
    try:
        return PASSWORD_HASHER.verify(password_hash, password)
    except (InvalidHashError, VerificationError, VerifyMismatchError):
        return False


def _token_hash(token: str, pepper: str) -> str:
    return hmac.new(pepper.encode(), token.encode(), hashlib.sha256).hexdigest()


def _email_token_hash(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


def _aws_region() -> str:
    region = boto3.Session().region_name
    if not region:
        raise RuntimeError("AWS region must be configured through AWS_DEFAULT_REGION")
    return region


def validate_aws_region() -> None:
    """Fail fast when production SES cannot be configured with a region."""
    _aws_region()


def _issue_access_token(email: str, config: AuthConfig) -> str:
    now = datetime.now(UTC)
    return jwt.encode(
        {
            "sub": email,
            "typ": "access",
            "iat": now,
            "exp": now + ACCESS_TOKEN_TTL,
            "jti": str(uuid4()),
        },
        config.jwt_secret,
        algorithm="HS256",
    )


def _new_refresh_token(session: Session, email: str, family_id: str, config: AuthConfig) -> str:
    raw_token = secrets.token_urlsafe(32)
    session.execute(
        refresh_session_table.insert().values(
            id=str(uuid4()),
            email=email,
            family_id=family_id,
            token_hash=_token_hash(raw_token, config.refresh_pepper),
            expires_at=datetime.now(UTC) + REFRESH_TOKEN_TTL,
        )
    )
    return raw_token


def _issue_token_pair(email: str) -> TokenPair:
    config = _config()
    with SessionLocal.begin() as session:
        raw_refresh = _new_refresh_token(session, email, str(uuid4()), config)
    return TokenPair(
        access_token=_issue_access_token(email, config),
        expires_in=int(ACCESS_TOKEN_TTL.total_seconds()),
        refresh_token=raw_refresh,
        email=email,
    )


def _send_auth_email(email: str, subject: str, body: str, purpose: str) -> None:
    config = _config(require_mail=True)
    if config.app_env in {"development", "test"}:
        LOGGER.warning("%s email for %s:\n%s", purpose, email, body)
        return

    try:
        boto3.client("sesv2", region_name=_aws_region()).send_email(
            FromEmailAddress=formataddr(("PlantPerform", config.ses_from_email)),
            Destination={"ToAddresses": [email]},
            Content={
                "Simple": {
                    "Subject": {"Data": subject, "Charset": "UTF-8"},
                    "Body": {"Text": {"Data": body, "Charset": "UTF-8"}},
                }
            },
        )
    except ClientError as error:
        error_code = error.response.get("Error", {}).get("Code", "unknown")
        LOGGER.error("SES %s email delivery failed (code=%s)", purpose.lower(), error_code)
        raise RuntimeError(f"{purpose} email delivery failed") from error
    except Exception as error:
        LOGGER.error(
            "SES %s email delivery failed (error_type=%s)", purpose.lower(), type(error).__name__
        )
        raise RuntimeError(f"{purpose} email delivery failed") from error


def _send_verification_email(email: str, token: str) -> None:
    verification_link = f"{_config().public_app_url}/verify-email?token={token}"
    _send_auth_email(
        email,
        "Verify your PlantPerform account",
        "Verify your PlantPerform account by opening this link:\n\n"
        f"{verification_link}\n\n"
        "This link expires in 24 hours and can only be used once.",
        "Verification",
    )


def _send_password_reset_email(email: str, token: str) -> None:
    # A fragment keeps the secret out of HTTP request logs and Referer headers.
    reset_link = f"{_config().public_app_url}/reset-password#token={token}"
    _send_auth_email(
        email,
        "Nulstil din adgangskode til PlantPerform",
        "Vælg en ny adgangskode til PlantPerform ved at åbne dette link:\n\n"
        f"{reset_link}\n\n"
        "Linket udløber om 1 time og kan kun bruges én gang.\n"
        "Hvis du ikke har bedt om en ny adgangskode, kan du se bort fra denne mail.",
        "Password reset",
    )


def _create_verification_token(session: Session, email: str) -> str:
    session.execute(
        delete(email_verification_token_table).where(
            email_verification_token_table.c.email == email,
            email_verification_token_table.c.used_at.is_(None),
        )
    )
    raw_token = secrets.token_urlsafe(32)
    session.execute(
        email_verification_token_table.insert().values(
            id=str(uuid4()),
            email=email,
            token_hash=_email_token_hash(raw_token),
            expires_at=datetime.now(UTC) + VERIFICATION_TOKEN_TTL,
        )
    )
    return raw_token


def register_user(email: str, password: str) -> bool:
    _config(require_mail=True)
    email = normalize_email(email)
    password_hash = hash_password(password)
    verification_token: str | None = None
    with SessionLocal.begin() as session:
        existing = session.execute(
            select(app_user_table.c.verified_at).where(app_user_table.c.email == email)
        ).first()
        if existing is None:
            session.execute(
                app_user_table.insert().values(email=email, password_hash=password_hash)
            )
            verification_token = _create_verification_token(session, email)
        elif existing.verified_at is None:
            session.execute(
                update(app_user_table)
                .where(app_user_table.c.email == email)
                .values(password_hash=password_hash, updated_at=datetime.now(UTC))
            )
            verification_token = _create_verification_token(session, email)

    if verification_token is not None:
        _send_verification_email(email, verification_token)
        return True
    return False


def resend_verification(email: str) -> None:
    _config(require_mail=True)
    email = normalize_email(email)
    verification_token: str | None = None
    with SessionLocal.begin() as session:
        user = session.execute(
            select(app_user_table.c.verified_at).where(app_user_table.c.email == email)
        ).first()
        if user is not None and user.verified_at is None:
            verification_token = _create_verification_token(session, email)
    if verification_token is not None:
        _send_verification_email(email, verification_token)


def verify_email(token: str) -> None:
    now = datetime.now(UTC)
    with SessionLocal.begin() as session:
        row = session.execute(
            select(
                email_verification_token_table.c.id,
                email_verification_token_table.c.email,
                email_verification_token_table.c.expires_at,
                email_verification_token_table.c.used_at,
            )
            .where(email_verification_token_table.c.token_hash == _email_token_hash(token))
            .with_for_update()
        ).first()
        if row is None or row.used_at is not None or row.expires_at <= now:
            raise InvalidVerificationTokenError
        session.execute(
            update(email_verification_token_table)
            .where(email_verification_token_table.c.id == row.id)
            .values(used_at=now)
        )
        session.execute(
            update(app_user_table)
            .where(app_user_table.c.email == row.email)
            .values(verified_at=now, updated_at=now)
        )


def request_password_reset(email: str) -> None:
    _config(require_mail=True)
    email = normalize_email(email)
    now = datetime.now(UTC)
    with SessionLocal.begin() as session:
        # Serialize issuance and consumption for this account.
        user = session.execute(
            select(app_user_table.c.email).where(app_user_table.c.email == email).with_for_update()
        ).first()
        if user is None:
            return
        recent_token = session.execute(
            select(password_reset_token_table.c.id).where(
                password_reset_token_table.c.email == email,
                password_reset_token_table.c.created_at > now - PASSWORD_RESET_RESEND_COOLDOWN,
            )
        ).first()
        if recent_token is not None:
            return
        session.execute(
            delete(password_reset_token_table).where(password_reset_token_table.c.email == email)
        )
        raw_token = secrets.token_urlsafe(32)
        session.execute(
            password_reset_token_table.insert().values(
                id=str(uuid4()),
                email=email,
                token_hash=_email_token_hash(raw_token),
                expires_at=now + PASSWORD_RESET_TOKEN_TTL,
                created_at=now,
            )
        )
        # Roll back if delivery fails, preserving any previous working link.
        _send_password_reset_email(email, raw_token)


def reset_password(token: str, password: str) -> None:
    token_hash = _email_token_hash(token)
    now = datetime.now(UTC)
    with SessionLocal.begin() as session:
        email = session.execute(
            select(password_reset_token_table.c.email).where(
                password_reset_token_table.c.token_hash == token_hash,
                password_reset_token_table.c.used_at.is_(None),
                password_reset_token_table.c.expires_at > now,
            )
        ).scalar_one_or_none()
        if email is None:
            raise InvalidPasswordResetTokenError
        session.execute(
            select(app_user_table.c.email).where(app_user_table.c.email == email).with_for_update()
        ).first()
        # Recheck after taking the account lock; concurrent submissions cannot both succeed.
        consumed = session.execute(
            update(password_reset_token_table)
            .where(
                password_reset_token_table.c.token_hash == token_hash,
                password_reset_token_table.c.used_at.is_(None),
                password_reset_token_table.c.expires_at > datetime.now(UTC),
            )
            .values(used_at=now)
            .returning(password_reset_token_table.c.id)
        ).scalar_one_or_none()
        if consumed is None:
            raise InvalidPasswordResetTokenError
        session.execute(
            update(app_user_table)
            .where(app_user_table.c.email == email)
            .values(password_hash=hash_password(password), updated_at=now)
        )
        session.execute(
            update(password_reset_token_table)
            .where(
                password_reset_token_table.c.email == email,
                password_reset_token_table.c.used_at.is_(None),
            )
            .values(used_at=now)
        )
        session.execute(
            update(refresh_session_table)
            .where(
                refresh_session_table.c.email == email,
                refresh_session_table.c.revoked_at.is_(None),
            )
            .values(revoked_at=now)
        )


def login_user(email: str, password: str) -> TokenPair:
    email = normalize_email(email)
    with SessionLocal() as session:
        row = session.execute(
            select(app_user_table.c.password_hash, app_user_table.c.verified_at).where(
                app_user_table.c.email == email
            )
        ).first()
    password_hash = row.password_hash if row is not None else DUMMY_PASSWORD_HASH
    if not verify_password(password_hash, password):
        raise InvalidCredentialsError
    if row is None:
        raise InvalidCredentialsError
    if row.verified_at is None:
        raise UnverifiedAccountError
    return _issue_token_pair(email)


def refresh_user(raw_refresh_token: str) -> TokenPair:
    config = _config()
    token_hash = _token_hash(raw_refresh_token, config.refresh_pepper)
    now = datetime.now(UTC)
    with SessionLocal.begin() as session:
        row = session.execute(
            select(
                refresh_session_table.c.id,
                refresh_session_table.c.email,
                refresh_session_table.c.family_id,
                refresh_session_table.c.expires_at,
                refresh_session_table.c.used_at,
                refresh_session_table.c.revoked_at,
            )
            .where(refresh_session_table.c.token_hash == token_hash)
            .with_for_update()
        ).first()
        if row is None:
            raise InvalidRefreshTokenError
        if row.used_at is not None or row.revoked_at is not None or row.expires_at <= now:
            session.execute(
                update(refresh_session_table)
                .where(refresh_session_table.c.family_id == row.family_id)
                .values(revoked_at=now)
            )
            raise InvalidRefreshTokenError

        user = session.execute(
            select(app_user_table.c.verified_at).where(app_user_table.c.email == row.email)
        ).first()
        if user is None or user.verified_at is None:
            raise InvalidRefreshTokenError

        session.execute(
            update(refresh_session_table)
            .where(refresh_session_table.c.id == row.id)
            .values(used_at=now)
        )
        new_raw_token = _new_refresh_token(session, row.email, row.family_id, config)

    return TokenPair(
        access_token=_issue_access_token(row.email, config),
        expires_in=int(ACCESS_TOKEN_TTL.total_seconds()),
        refresh_token=new_raw_token,
        email=row.email,
    )


def logout_user(raw_refresh_token: str | None) -> None:
    if not raw_refresh_token:
        return
    config = _config()
    with SessionLocal.begin() as session:
        session.execute(
            update(refresh_session_table)
            .where(
                refresh_session_table.c.token_hash
                == _token_hash(raw_refresh_token, config.refresh_pepper)
            )
            .values(revoked_at=datetime.now(UTC))
        )


def get_user(email: str) -> AuthenticatedUser | None:
    with SessionLocal() as session:
        row = session.execute(
            select(app_user_table.c.email, app_user_table.c.role).where(
                app_user_table.c.email == normalize_email(email),
                app_user_table.c.verified_at.is_not(None),
            )
        ).first()
    return AuthenticatedUser(email=row.email, role=row.role) if row is not None else None


def current_user(
    credentials: BearerCredentials,
    request: Request = None,
) -> AuthenticatedUser:
    unauthorized = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Authentication required",
        headers={"WWW-Authenticate": "Bearer"},
    )
    if credentials is None or credentials.scheme.lower() != "bearer":
        raise unauthorized
    if credentials.credentials.startswith(EMBED_KEY_PREFIX):
        user = get_embed_user(credentials.credentials)
    else:
        try:
            config = _config()
            payload = jwt.decode(credentials.credentials, config.jwt_secret, algorithms=["HS256"])
            if payload.get("typ") != "access" or not isinstance(payload.get("sub"), str):
                raise unauthorized
        except (jwt.InvalidTokenError, RuntimeError) as error:
            raise unauthorized from error
        user = get_user(payload["sub"])
    if user is None:
        raise unauthorized
    if user.role == "viewer":
        if request is not None:
            request.state.viewer_request = True
        endpoint = request.scope.get("endpoint") if request is not None else None
        if (
            request is None
            or request.method not in {"GET", "HEAD"}
            or not getattr(endpoint, "viewer_read", False)
        ):
            raise HTTPException(status_code=403, detail="Read-only access")
    return user


def require_same_origin(request: Request) -> None:
    origin = request.headers.get("origin")
    if origin is None:
        return
    if origin.rstrip("/") not in set(configured_origins()):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Invalid request origin")


def refresh_cookie_options() -> dict[str, object]:
    config = _config()
    return {
        "key": REFRESH_COOKIE_NAME,
        "httponly": True,
        "secure": config.cookie_secure,
        "samesite": "lax",
        "path": "/api/v0/auth",
        "max_age": int(REFRESH_TOKEN_TTL.total_seconds()),
    }
