# Shared sædskifte groups

All endpoints require authentication and live under `/api/v0`. JSON model properties
use camelCase. Apply migration `20261104_0001` before deploying the API and worker.
It adds two tables without changing or reloading the standard lookup data.

## Definitions and membership

A group contains named, independently shareable rotation definitions. Standard group
IDs retain their numeric string identities; custom groups and variants have UUIDs.
The standard lookup loader never touches custom groups.

| Method | Path | Behavior |
| --- | --- | --- |
| GET | `/saedskifte-rotations` | Standards and groups the requester belongs to |
| POST | `/saedskifte-rotations` | Create a group; returns 201 |
| GET | `/saedskifte-rotations/{id}` | Read a standard or a group the requester belongs to |
| PATCH | `/saedskifte-rotations/{id}` | Update with `expectedRevision` |
| DELETE | `/saedskifte-rotations/{id}` | Delete for all members; returns 204 |
| POST | `/saedskifte-rotations/{id}/duplicate` | Create an independent editable copy; returns 201 |
| GET | `/saedskifte-rotations/{id}/members` | List member emails |
| POST | `/saedskifte-rotations/{id}/members` | Add `{email}`; returns 201 |
| DELETE | `/saedskifte-rotations/{id}/members/{email}` | Remove a member; returns 204 |
| GET | `/saedskifte-rotations/afgrode-koder` | Valid hovedafgrøde codes and names |
| GET | `/saedskifte-rotations/udlaeg-koder` | Existing udlæg/virkemiddel choices |

The udlæg endpoint accepts the same optional `hovedafgrode_kode`, `driftsform`, and
`naeste_afgrode_kode` query parameters as the existing farm endpoint.

Example create request:

```json
{
  "name": "Mit sædskifte",
  "driftsform": "Konventionel",
  "variants": [
    {
      "positions": [
        {"afgrodeKode": 11, "allowedUdlaegKoder": [9683]},
        {"afgrodeKode": 11, "allowedUdlaegKoder": [9682, 9683]}
      ]
    }
  ]
}
```

The response includes `id`, `name`, `driftsform`, `variants`, `revision`, timestamps,
`isStandard`, and `canCopy`. Variants receive UUIDs when omitted. Preserve their
returned IDs on edits to retain candidate identity. A supplied `variants` array
replaces the complete variants document; omitted fields are unchanged. Names are
trimmed and nonempty. Explicit null names/variants and duplicate IDs/codes are invalid.
`driftsform` is optional metadata (`Konventionel`, `Økologisk`, or null); actual
calculations use the simulation's farming system.

Each variant has 1–8 positions. A position always permits no udlæg, including when
its configured list is empty. Permitted codes come from the existing catalog and
must be eligible for that crop and the next crop in the cycle. With unspecified
farming-system metadata, organic-only choices may be configured; the simulation's
actual farming system narrows them during calculation. This feature does not add
new measure formulas or move fertilizer, N-norm or præcisionsjordbrug settings.

All members can read, edit, share, copy and delete. Adding a member requires an
existing verified user. Emails are normalized; the last member cannot be removed.
Standard definitions cannot be edited, deleted or given members.

## Copy authorization

Copying is allowed if the requester is a member of the source group **or** if the
source is currently selected in a simulation on any farm the requester belongs to.
This also applies to standards: public visibility alone does not authorize copying.
Historical outputs, old memberships and deselected references do not qualify.
`canCopy` reflects this rule in rotation and simulation catalog metadata.

The optional body is `{"name": "My copy"}`; otherwise the name is `Kopi af <source name>`.
Copies contain the latest definition and every variant, with fresh group/variant
UUIDs, revision zero and only the requester as a member. They copy neither farm
assignments nor results, field overrides or memberships. Copying can happen during
an optimization because it does not change the source.

Standard copies resolve forward-filled crops and remove unused trailing positions.
Each original udlæg becomes a permitted choice, alongside the implicit no-udlæg
alternative. Changing either source or copy never changes the other.

## Simulations and results

Existing `saedskiftevarianter` requests accept custom UUIDs as well as standard IDs.
Newly selecting a custom group requires group membership. Once selected, every farm
member can calculate and preview it through that simulation, without acquiring
edit/share rights to the source. The farm candidate endpoints also expose available
custom groups and validate access before stateless evaluation. `GET
/farms/{id}/rotation-candidates` accepts comma-separated `saedskiftevarianter` and
`nNormProcenter` to list only those candidates, and the custom-candidate limit then
applies to what is listed.

A new optimization submission captures the latest selected group definitions and
revisions. Reusing the same run ID or retrying a worker attempt preserves those
inputs. A new run ID captures the latest versions. `rotationGroups` in saved results
records the definitions actually calculated; editing a source marks older outputs
outdated without altering their figures or cancelling an active run.

Permitted combinations are expanded once per calculation, cycled across eight years,
filtered by farming-system eligibility and disabled measures, then deduplicated.
Candidate references retain the existing three-part representation; treat custom
variant tokens as opaque. Manual edits of a custom candidate must respect its
configured measure choices and current eligibility. Yearly optimization supports
shifting custom cycles and reconstructs winners from the captured definitions.

Expansion is limited to 4,096 custom candidates per request/run, including N-norm
levels, before deduplication and yearly shifts. Excess returns 422 rather than a
truncated set. If a later shared edit makes future options too large, the simulation
view still exposes saved outputs, with `rotationOptionsError` (`code` and `message`)
and empty future-option metadata; reduce the choices before the next run.

Deleting a group removes it from current simulation selections and marks results
outdated, preserving previous outputs and source snapshots. Fields locked to removed
variants must be unlocked or reassigned before another optimization. Deletion returns
409 while an affected simulation is creating, recalculating or optimizing.

## Errors

- 404: missing/inaccessible resource, unauthorized copy, or missing/unverified member.
- 409: stale revision, duplicate member, last-member removal, or deletion during calculation.
- 422: invalid definitions, immutable-standard mutations, disallowed measures or excessive expansion.

Rotation errors return `{"detail": {"code": ..., "message": ...}}`. The codes are
`TOO_MANY_CUSTOM_CANDIDATES`, `ROTATION_DELETED`, `ROTATION_VARIANT_UNAVAILABLE`,
`UDLAEG_NOT_PERMITTED` and `INVALID_ROTATION` for the rest, and a missing or
inaccessible group answers 404 with `ROTATION_NOT_FOUND`.

Frontend changes and infrastructure deployment are outside this change.
