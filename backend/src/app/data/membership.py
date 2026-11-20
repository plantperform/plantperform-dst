"""Resource membership checks and serialized changes to shared access."""

from dataclasses import dataclass

from sqlalchemy import (
    Column,
    ColumnElement,
    Table,
    and_,
    delete,
    func,
    insert,
    literal,
    or_,
    select,
    update,
)
from sqlalchemy.dialects.postgresql import JSONB

from app.data import db
from app.domain.membership import Membership, MembershipForbidden, MembershipRole


@dataclass(frozen=True)
class ResourceMemberships:
    resource: Table
    members: Table
    resource_key: Column
    selection: ColumnElement | None = None

    def selected_ids(self, email):
        """IDs selected in simulations the caller can read, before any proposed change."""
        return (
            select(self.selection)
            .select_from(db.simulation_table)
            .join(
                db.farm_member_table,
                db.farm_member_table.c.farm_id == db.simulation_table.c.farm_id,
            )
            .where(db.farm_member_table.c.email == email)
        )

    def visible(self, email):
        """Live definitions with the caller's effective role, one row per resource."""
        direct = self.members.c.role
        allowed = direct.is_not(None)
        if self.selection is not None:
            allowed = or_(allowed, self.resource.c.id.in_(self.selected_ids(email)))
        return (
            select(self.resource, func.coalesce(direct, "viewer").label("effective_role"))
            .outerjoin(
                self.members,
                and_(self.resource_key == self.resource.c.id, self.members.c.email == email),
            )
            .where(allowed)
        )

    def definition(self, session, resource_id, email, *, for_edit=False):
        if for_edit:
            self.lock_resource(session, resource_id)
        row = session.execute(self.visible(email).where(self.resource.c.id == resource_id)).first()
        if for_edit and row is not None and row.effective_role != "editor":
            raise MembershipForbidden
        return row

    def effective_role(self, session, resource_id, email):
        if self.selection is None:
            return self.role(session, resource_id, email)
        query = self.visible(email)
        return session.scalar(
            query.with_only_columns(query.selected_columns.effective_role).where(
                self.resource.c.id == resource_id
            )
        )

    def role(self, session, resource_id, email):
        return session.scalar(
            select(self.members.c.role).where(
                self.resource_key == resource_id, self.members.c.email == email
            )
        )

    def lock_resource(self, session, resource_id):
        session.execute(
            select(self.resource.c.id).where(self.resource.c.id == resource_id).with_for_update()
        ).first()

    def is_editor(self, session, resource_id, email) -> bool:
        """Return False for nonmembers and deny a known member with insufficient access."""
        role = self.effective_role(session, resource_id, email)
        if role is not None and role != "editor":
            raise MembershipForbidden
        return role == "editor"

    def list(self, session, resource_id, actor):
        if self.effective_role(session, resource_id, actor) is None:
            return None
        rows = session.execute(
            select(self.members.c.email, self.members.c.role)
            .where(self.resource_key == resource_id)
            .order_by(self.members.c.email)
        )
        return [Membership(email=row.email, role=row.role) for row in rows]

    def add(self, session, resource_id, actor, email, role: MembershipRole = "editor"):
        self.lock_resource(session, resource_id)
        if not self.is_editor(session, resource_id, actor):
            return "not_found"
        return self._insert_member(session, resource_id, email, role)

    def _insert_member(self, session, resource_id, email, role):
        verified_at = session.scalar(
            select(db.app_user_table.c.verified_at).where(db.app_user_table.c.email == email)
        )
        if verified_at is None:
            return "user_not_found"
        if self.role(session, resource_id, email) is not None:
            return "already_member"
        session.execute(
            insert(self.members).values(
                {self.resource_key: resource_id, "email": email, "role": role}
            )
        )
        return "added"

    def change(self, session, resource_id, actor, email, role: MembershipRole | None):
        """Set the role, or remove the member when role is None."""
        self.lock_resource(session, resource_id)
        actor_role = self.effective_role(session, resource_id, actor)
        if actor_role is None:
            return "not_found"
        if actor_role != "editor" and (actor != email or role is not None):
            raise MembershipForbidden
        previous = self.role(session, resource_id, email)
        if previous is None:
            if role is not None and self.effective_role(session, resource_id, email) == "viewer":
                return self._insert_member(session, resource_id, email, role)
            return "member_not_found"
        if previous == "editor" and role != "editor":
            other_editor = session.scalar(
                select(self.members.c.email)
                .where(
                    self.resource_key == resource_id,
                    self.members.c.role == "editor",
                    self.members.c.email != email,
                )
                .limit(1)
            )
            if other_editor is None:
                return "last_member"
        target = (self.resource_key == resource_id, self.members.c.email == email)
        if role is None:
            session.execute(delete(self.members).where(*target))
            return "removed"
        session.execute(update(self.members).where(*target).values(role=role))
        return "updated"


farms = ResourceMemberships(db.farm_table, db.farm_member_table, db.farm_member_table.c.farm_id)
modules = ResourceMemberships(
    db.economics_module_table,
    db.economics_module_member_table,
    db.economics_module_member_table.c.module_id,
    db.simulation_table.c.data["economics_module_id"].astext,
)
rotations = ResourceMemberships(
    db.saedskifte_rotation_group_table,
    db.saedskifte_rotation_group_member_table,
    db.saedskifte_rotation_group_member_table.c.group_id,
    func.jsonb_array_elements_text(
        func.nullif(
            db.simulation_table.c.data["rotation_saedskiftevarianter"],
            literal(JSONB.NULL, type_=JSONB),
        )
    ),
)
