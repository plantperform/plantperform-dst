"""Manual provisioning: python -m app.embed_keys {create,issue,rotate,revoke} EMAIL."""

import argparse
import secrets
from datetime import UTC, datetime
from uuid import uuid4

from sqlalchemy import insert, select, update

from app.auth import EMBED_KEY_PREFIX, embed_key_hash, hash_password, normalize_email
from app.data.db import SessionLocal, app_user_table, embed_key_table


def manage_key(action: str, email: str) -> str | None:
    email = normalize_email(email)
    if email.count("@") != 1 or " " in email or not all(email.split("@")):
        raise ValueError("A valid email address is required")
    if action not in {"create", "issue", "rotate", "revoke"}:
        raise ValueError("Unknown operation")
    with SessionLocal.begin() as session:
        user = session.execute(
            select(app_user_table).where(app_user_table.c.email == email).with_for_update()
        ).first()
        if action == "create":
            if user is not None:
                raise ValueError("Account already exists; create a dedicated viewer account")
            session.execute(
                insert(app_user_table).values(
                    email=email,
                    password_hash=hash_password(secrets.token_urlsafe(32)),
                    role="viewer",
                    verified_at=datetime.now(UTC),
                )
            )
        elif user is None or user.role != "viewer" or user.verified_at is None:
            raise ValueError("A verified viewer account is required")

        active = embed_key_table.c.email == email, embed_key_table.c.revoked_at.is_(None)
        if action in {"rotate", "revoke"}:
            session.execute(
                update(embed_key_table).where(*active).values(revoked_at=datetime.now(UTC))
            )
        elif session.execute(select(embed_key_table.c.id).where(*active)).first() is not None:
            raise ValueError("An active key already exists; use rotate to replace it")
        if action == "revoke":
            return None
        key = EMBED_KEY_PREFIX + secrets.token_urlsafe(32)
        session.execute(
            insert(embed_key_table).values(
                id=str(uuid4()), email=email, token_hash=embed_key_hash(key)
            )
        )
    return key


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("action", choices=("create", "issue", "rotate", "revoke"))
    parser.add_argument("email")
    args = parser.parse_args()
    try:
        key = manage_key(args.action, args.email)
    except ValueError as error:
        parser.error(str(error))
    if key is not None:
        print(key)
    else:
        print("Embed access revoked.")


if __name__ == "__main__":
    main()
