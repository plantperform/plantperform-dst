# Sharing farms, economics modules, and rotation groups

Under `/api/v0`, append `/memberships` to `/farms/{id}`,
`/economics-modules/{id}`, or `/saedskifte-rotations/{id}` for a custom rotation group.

| Method and suffix | Request | Result |
| --- | --- | --- |
| `GET /memberships` | | All members sorted by email, each with `email` and `role` |
| `POST /memberships` | `{"email":"user@example.com","role":"viewer"}` | Created membership, HTTP 201 |
| `PATCH /memberships/{email}` | `{"role":"editor"}` or `{"role":"viewer"}` | Updated membership, HTTP 200 |
| `DELETE /memberships/{email}` | | HTTP 204 |

## Roles and inherited access

Editors can change the resource and manage its members. Viewers can read it and
its member list, make private copies, and leave. A farm viewer can see saved
simulations and results. Preparing history, previewing changes, and starting
calculations require a farm editor.

Each live economics profile or custom sædskifte returns the caller's
`effectiveRole`. An explicit role takes precedence. Selecting a definition
in a simulation gives everyone with access to that farm viewer access to the
definition. They can read it and its explicit member list, copy it, and select
it on another farm they edit. Members of that farm then have viewer access too.
Both membership lists contain only explicitly shared users. An editor can add
an inherited viewer or promote them to an explicit editor. Removing an explicit
entry restores access from any remaining selections. When the last qualifying
selection or farm membership disappears, inherited access ends. Historical
snapshots retain the values used for the calculation.

## Email-only routes

The email-only `/members` routes remain available. Adding a verified user there
creates an editor. Duplicate additions return 409 and preserve the existing role.
Removing or demoting the last editor also returns 409.

## Private copies

To make a private farm copy, send `POST /api/v0/farms/{id}/duplicate` with
`{"requestId":"<uuid>"}`. Reuse the UUID when retrying. The response is the new
farm (201), named `Kopi af <source name>`, with the caller as its sole editor.
The copy includes fields, simulations, saved optimizations and completed quota
curves. The simulations keep their selected economics and sædskifte IDs, including
any difference between selected and applied economics. To edit a definition as a
viewer, duplicate that definition and select the private copy on a farm you edit.

The special creation flow (`POST /api/v0/farms/copy`) creates private copies
of the referenced custom definitions. The creator is the sole editor of each.
Simulations that used the same definition share its new copy. Built-ins keep
their library IDs. Saved results retain their captured values and revisions.
If a required custom definition cannot be recovered, the request returns 409
and the transaction rolls back.

## Rollout

Apply migration `20261119_0001` and deploy the updated backend to all API
instances before assigning viewer memberships. Existing memberships become editors.
