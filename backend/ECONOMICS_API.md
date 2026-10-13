# Economics modules and simulation recalculation

All endpoints are authenticated and live under `/api/v0`. JSON property names
are camelCase. Modules are independent of farms and can be reused across farms.

## Modules

| Method | Path | Request / response |
| --- | --- | --- |
| GET | `/economics-modules` | Standard plus modules the current user belongs to |
| POST | `/economics-modules` | `{name, overrides?}`; returns module, HTTP 201 |
| GET | `/economics-modules/{id}` | Returns module |
| PATCH | `/economics-modules/{id}` | `{expectedRevision, name?, overrides?}`; returns module |
| DELETE | `/economics-modules/{id}` | HTTP 204; existing simulation snapshots survive |
| POST | `/economics-modules/{id}/duplicate` | Optional `{name}`; returns independent copy, HTTP 201 |
| GET | `/economics-modules/{id}/members` | `[{email}]` |
| POST | `/economics-modules/{id}/members` | `{email}`; verified existing user required, HTTP 201 |
| DELETE | `/economics-modules/{id}/members/{email}` | HTTP 204 |

A module has `id`, `name`, `revision`, `createdAt`, `updatedAt`, and `overrides`.
The overrides column stores only this structure, never a copy of reference data:

```json
{
  "prices": {"sale:[11,\"Konventionel\",\"\"]": 165},
  "quantities": {},
  "yieldPct": {"11": 10}
}
```

Module edits replace the supplied overrides document. Omitted `name` or
`overrides` retain their current values; explicit nulls are rejected. Delete a
key to restore the reference default. Prices and quantities must be finite,
nonnegative numbers; yield percentages must be finite and greater than -100.
Unknown identifiers are rejected when saving overrides. Names are trimmed,
nonempty, and need not be unique.

Every member has equal read, edit, share, duplicate, and delete rights. Email
addresses are normalized. The last member cannot be removed. Duplication gives
membership only to its requester and copies the current overrides. It does not
copy membership or simulation assignments.

`standard` is a virtual immutable module with empty overrides, named
`Standard (SEGES 2026)`. It can be read and duplicated but cannot be changed,
deleted, or shared. An omitted/null module selection means `standard`.

Inaccessible modules return 404. Stale revisions, duplicate members, and
last-member removal return 409. Invalid input and attempts to mutate standard
return 422.

## Reference assumptions and identifiers

`GET /economics/assumptions` returns the real imported reference data as
`prices`, `quantities`, `yields`, `strawYields`, and `crops` arrays. Price and
quantity entries include their `id`, default `value`, `unit`, and applicability
`context`; quantity entries also include `lineId`. Yield entries identify crop,
JB number, farming system, irrigation, expected yield, unit, and nitrogen norm.
Dynamic fertilizer quantities have `value: null` and `dynamic: true`, since
actual nitrogen allocations depend on the simulation and rotation position.

Use emitted IDs as opaque keys. They are stable natural identities, independent
of source-row ordering. They deliberately distinguish soil/farming-system/quality
variants; the frontend's example IDs are not API identifiers.

| Override key | Identity |
| --- | --- |
| `sale:[cropCode,farmingSystem,quality]` | Crop sale price |
| `straw:[cropCode,farmingSystem,quality]` | Straw price |
| `rate:[treatment,soilGroup,cropCodeOrNull,farmingSystem]` | Work/material rate |
| `cost:[cropCode,farmingSystem,category,treatment]` | Legacy flat cost per ha |
| `list:[post]` | General price-list item, including subsidies |
| `cropCode/work:[farmingSystem,soilGroup,quality,category,treatment]` | Work/material quantity |
| `cropCode/cost:[farmingSystem,category,treatment]` | Multiplier for legacy flat cost; default 1 |
| `cropCode/list:[post]` | Quantity/multiplier for a general price-list item; default 1 |
| `cropCode/fertiliser:[purpose]` | Economic fertilizer quantity; purpose is `mineralN`, `mineralSpreading`, or `manureSpreading` |

The text after `:` is a compact JSON array with Unicode preserved. A quantity
entry's ID equals `cropCode + '/' + lineId`, matching the existing frontend's
quantity-key convention. `yieldPct` keys are decimal crop-code strings, and
values are percentage changes, not absolute yields.

Existing lookup and fallback rules select a reference variant first; an override
then replaces that selected value. A shared work rate affects every line that
uses that rate. Crop aliases retain their existing budget-code mapping. Legacy
flat costs apply only where the existing calculator uses the legacy cost budget.
General price-list entries affect calculations only when their scheme or cost is
already included; setting a price does not enable an optional subsidy scheme.

The current importers do not retain work-rate or work-quantity units. These
entries therefore explicitly use generic `kr/enhed` and `enheder/ha`; their
numeric defaults are still the real database values. Existing manure-spreading
costs retain the calculator's flat application-rate placeholder. Recalculation
does not introduce a new manure purchase or transport model.

## Simulation selection and applied snapshots

Creation accepts `economicsModuleId` alongside the existing simulation inputs.
The server checks module membership and captures a snapshot before submitting
the existing creation job. Initial generation and creation retries use that
captured snapshot, even if the module subsequently changes or disappears.

Simulation responses add:

```json
{
  "economicsModuleId": "module-uuid",
  "economicsSnapshot": {
    "sourceId": "module-uuid",
    "name": "Mine forudsætninger",
    "revision": 2,
    "overrides": {"prices": {}, "quantities": {}, "yieldPct": {}}
  }
}
```

The selected ID expresses the user's requested module. The snapshot describes
**the overrides actually applied to the displayed calculations**. These can
intentionally differ until the user recalculates. Snapshots belong to their
simulation: every farm member can inspect and use them without original-module
membership. Renaming, editing, deleting, or revoking access to a module does not
change snapshots or dispatch any simulation jobs.

`PATCH /farms/{farmId}/simulations/{simulationId}/economics` accepts:

```json
{"expectedRevision": 5, "economicsModuleId": "module-uuid"}
```

This checks membership, changes the selected ID, advances the simulation revision,
and marks optimization results outdated. It retains the last calculated values
and display data. It submits no job, including on subsequent view reads. Saving
an unchanged selection is a no-op.

## Explicit manual recalculation

`POST /farms/{farmId}/simulations/{simulationId}/economics/recalculate` accepts:

```json
{
  "expectedRevision": 6,
  "requestId": "5dc671fe-71da-4473-b910-71d2e2b3768a",
  "refreshFromModule": true
}
```

The response is HTTP 202 with the simulation. Keep the same `requestId` and
request body when retrying an ambiguous HTTP response: this reserves one job,
including concurrent retries before queue publication. Reusing an ID with a
different body returns 409. A genuinely new request needs a new UUID and the
current simulation revision.

`refreshFromModule` defaults to true. It captures the latest selected module's
overrides at submission, requiring membership in that module. False instead
uses the already-applied snapshot, including after source deletion or access
loss, and does not change the selected ID. Underlying reference defaults are
not frozen and are reloaded when calculation starts.

Recalculation preserves field IDs, rotations, locks, manual edits, constraints,
and agronomic outputs. It updates economic details, candidate averages,
optimizer inputs, field values, and display projections. Expected-yield edits
scale crop and straw income, yield-dependent drying costs, and FEN. Cost-quantity
edits change expenses without changing physical fertilizer allocations, nitrogen
norms, or leaching. Missing historical crop positions remain empty.

The existing `creationStatus` lifecycle (`queued`, `running`, `done`, `failed`)
also represents explicit economics recalculation. Poll the simulation or `/view`.
Calculated view data is hidden during queued/running/failed work; the applied
snapshot and refreshed view are published together. While recalculation is not
done, field edits and optimization are rejected with 409. Failed economics work
can be replaced by a fresh explicit recalculation, optionally after selecting a
different module; partial data stays hidden until successful publication.
Active optimization also
prevents submission of a new recalculation.

`POST .../economics/recalculate/retry`, with no body, retries failed work using
its captured snapshot. It does not reread the original module. Ordinary creation
retry cannot restart failed economics work. Queue publication failures return
503 with `code: QUEUE_UNAVAILABLE` and `simulationId`.

Recalculation does not optimize or pick new rotations. Existing optimizer output
remains a historical result marked `outdated`; result responses and saved-result
views include their own `economicsSnapshot`. Current field values and candidate
details use the newly applied snapshot. Run either existing optimization endpoint
explicitly to calculate a new optimum. Farm history uses standard economics.

## Frontend integration and rollout

The frontend branch is unchanged. Replace browser profile storage with the
module APIs and read actual assumptions from the catalogue. Adapt profile IDs,
quantity line IDs, and context-variant selection to the emitted identifiers.
Pass `economicsModuleId` during creation, save selection separately, and offer
an explicit recalculation action. Remove assumptions that profiles belong to one
farm, automatically propagate edits, or revert simulations to standard on deletion.
Label pending selection versus applied snapshot, and distinguish current values
from the previous optimization's saved snapshot.

Apply migration `20261013_0001` using the normal database migration process and
release backend and optimizer worker code together. Existing simulations read
as standard without a bulk recalculation or migration of browser-only profiles.
The queue and infrastructure configuration stay the same.
