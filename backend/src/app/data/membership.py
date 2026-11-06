"""Shared resources must retain an editor when memberships are removed."""

from sqlalchemy import select

from app.data.db import app_user_table


def has_remaining_editor(session, emails, removed_email):
    return session.execute(
        select(app_user_table.c.email).where(
            app_user_table.c.email.in_([email for email in emails if email != removed_email]),
            app_user_table.c.role == "editor",
        )
    ).first() is not None
