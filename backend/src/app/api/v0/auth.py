from typing import Annotated

from fastapi import APIRouter, Cookie, Depends, HTTPException, Response, status
from pydantic import Field, field_validator

from app.auth import (
    PASSWORD_MIN_LENGTH,
    REFRESH_COOKIE_NAME,
    AuthenticatedUser,
    InvalidCredentialsError,
    InvalidRefreshTokenError,
    InvalidVerificationTokenError,
    UnverifiedAccountError,
    current_user,
    login_user,
    logout_user,
    normalize_email,
    refresh_cookie_options,
    refresh_user,
    register_user,
    require_same_origin,
    resend_verification,
    verify_email,
)
from app.domain.base import CamelModel

router = APIRouter(prefix="/auth", tags=["auth"])
CurrentUser = Annotated[AuthenticatedUser, Depends(current_user)]


class EmailPasswordRequest(CamelModel):
    email: str = Field(min_length=3, max_length=320)
    password: str = Field(min_length=PASSWORD_MIN_LENGTH, max_length=1024)

    @field_validator("email")
    @classmethod
    def validate_email(cls, value: str) -> str:
        value = normalize_email(value)
        if value.count("@") != 1 or value.startswith("@") or value.endswith("@"):
            raise ValueError("Enter a valid email address")
        local, domain = value.split("@")
        if not local or "." not in domain or " " in value:
            raise ValueError("Enter a valid email address")
        return value


class EmailRequest(CamelModel):
    email: str = Field(min_length=3, max_length=320)

    @field_validator("email")
    @classmethod
    def validate_email(cls, value: str) -> str:
        return EmailPasswordRequest.validate_email(value)


class VerificationRequest(CamelModel):
    token: str = Field(min_length=20, max_length=256)


class AuthMessage(CamelModel):
    message: str


class TokenResponse(CamelModel):
    access_token: str
    token_type: str = "bearer"
    expires_in: int


class UserResponse(CamelModel):
    email: str


def _set_refresh_cookie(response: Response, raw_token: str) -> None:
    response.set_cookie(value=raw_token, **refresh_cookie_options())


def _clear_refresh_cookie(response: Response) -> None:
    options = refresh_cookie_options()
    response.delete_cookie(
        key=options["key"],
        path=options["path"],
        secure=options["secure"],
        httponly=options["httponly"],
        samesite=options["samesite"],
    )


@router.post("/register", response_model=AuthMessage, status_code=status.HTTP_202_ACCEPTED)
async def register(request: EmailPasswordRequest) -> AuthMessage:
    try:
        registered = register_user(request.email, request.password)
    except RuntimeError as error:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Verification email could not be sent",
        ) from error
    if not registered:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Account already exists",
        )
    return AuthMessage(message="If the address can be registered, a verification email was sent.")


@router.post(
    "/verification/resend",
    response_model=AuthMessage,
    status_code=status.HTTP_202_ACCEPTED,
)
async def resend(request: EmailRequest) -> AuthMessage:
    try:
        resend_verification(request.email)
    except RuntimeError as error:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Verification email could not be sent",
        ) from error
    return AuthMessage(message="If the address needs verification, a new email was sent.")


@router.post("/verify", response_model=AuthMessage)
async def verify(request: VerificationRequest) -> AuthMessage:
    try:
        verify_email(request.token)
    except InvalidVerificationTokenError as error:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid or expired verification token",
        ) from error
    return AuthMessage(message="Email verified. You can now log in.")


@router.post("/login", response_model=TokenResponse)
async def login(
    request: EmailPasswordRequest,
    response: Response,
    _: None = Depends(require_same_origin),
) -> TokenResponse:
    try:
        pair = login_user(request.email, request.password)
    except UnverifiedAccountError as error:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Email verification required",
        ) from error
    except InvalidCredentialsError as error:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid email or password",
        ) from error
    _set_refresh_cookie(response, pair.refresh_token)
    return TokenResponse(access_token=pair.access_token, expires_in=pair.expires_in)


RefreshToken = Annotated[str | None, Cookie(alias=REFRESH_COOKIE_NAME)]


@router.post("/refresh", response_model=TokenResponse)
async def refresh(
    response: Response,
    refresh_token: RefreshToken = None,
    _: None = Depends(require_same_origin),
) -> TokenResponse:
    if refresh_token is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Authentication required",
        )
    try:
        pair = refresh_user(refresh_token)
    except InvalidRefreshTokenError as error:
        _clear_refresh_cookie(response)
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Authentication required",
        ) from error
    _set_refresh_cookie(response, pair.refresh_token)
    return TokenResponse(access_token=pair.access_token, expires_in=pair.expires_in)


@router.post("/logout", status_code=status.HTTP_204_NO_CONTENT)
async def logout(
    response: Response,
    refresh_token: RefreshToken = None,
    _: None = Depends(require_same_origin),
) -> None:
    logout_user(refresh_token)
    _clear_refresh_cookie(response)


@router.get("/me", response_model=UserResponse)
async def me(user: CurrentUser) -> UserResponse:
    return UserResponse(email=user.email)
