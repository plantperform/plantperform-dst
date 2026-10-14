# Optimizer worker

The production API publishes identifier-only SQS messages. The worker package
`plantperform-optimizer` executes the same average/yearly solvers in Lambda and
local background tasks. API startup and production submission do not import
OR-Tools. Existing queue, memory, lease and timeout configuration remain in use.

## Simulation settings and runs

`POST /farms/{farm_id}/simulations` returns HTTP 201 after saving the name,
parameters, constraints, optimization settings, and economics snapshot. It
neither reads farm fields nor generates candidates or publishes a job.
`requestId` retains its UUIDv5 idempotency behavior.

`PATCH /farms/{farm_id}/simulations/{simulation_id}` accepts `expectedRevision`
and changed settings. Renaming does not change the calculation revision or
invalidate output. Calculation edits advance the revision and retain the last
successful result as outdated. Calculation/field edits are rejected while a run
is queued or in progress; renaming remains available. The frontend uses one
settings dialog with Save and Run optimization actions. Run saves before
submitting, and submission failure retains the saved simulation identity.

`optimizationSettings` remembers the mode, time limit, exclusions, yearly caps,
and DB2 swing limit. Both optimization endpoints return HTTP 202. Requests
supply `expectedRevision` and a UUID `runId`; saved options are authoritative.
Legacy simulations without saved options still accept the former per-run options.
Defaults are average optimization and 90 solver seconds. The overall execution
limit remains 900 seconds.

Run parameters capture immutable simulation/economic inputs. The first execution
copies the farm's current fields once and captures small registry/soil context.
An explicit `fieldsInitialized` flag distinguishes a draft from an empty field
snapshot. Retries and reruns retain field IDs, rules, manual edits, and context.
Farm-field membership is not silently refreshed on subsequent runs.

## Candidates exist only in memory

Preparation calculates one field at a time. Only compact numeric alternatives
remain in worker memory for the solver; full nonwinning reports are discarded.
Yearly shifted options follow the same rule. Winning reports are reconstructed
from the same captured inputs. Locked/manual choices are recalculated before
solving, and incompatible locks fail with the affected field names. Permanent
crop locks remain supported.

The application schema no longer contains `simulation_field_candidates`.
Migration `20261014_0001` preserves selected legacy reports in existing JSONB and
then drops the table. Runtime readers use only those selected reports.
Results save chosen evaluations,
field/year outputs and calculation provenance. Display projections store selected
year values and aggregate crop-area bounds, with `prepared.version = 3`; they do
not store candidate arrays or reference indexes. Rotation choices are derived
from the library and saved parameters without agronomic candidate calculation.

The worker publishes output, recalculated field inputs and display projections
in one transaction guarded by run ID, revision and an unexpired execution lease.
Failures preserve the previous successful result and comparisons. Status polls
use `include_output=false`, omitting rich output. Duplicate/stale deliveries,
retries, deletion and recovery retain the existing guards.

The compatibility creation handler recovers old creation messages as saved
settings and optionally submits a normal optimization. It never generates or
persists candidates. Failed legacy creation can be recovered through the old
retry route without a creation job. `creation_status` still gates explicit
economics recalculation and legacy recovery; new simulations start at `done`.

## DB2 recalculation without solving

The existing economics selection/recalculation endpoints and worker remain.
Each chosen year retains the typed inputs represented by
`EconomicsCalculationInputs` in `db_detail.calculation_inputs`: actual crop,
soil class, nitrogen allocation, irrigation and the remaining physical arguments
to `calculate_db`. Legacy chosen reports also supply these inputs.

Recalculation reprices only chosen/manual/baseline results. It performs no
candidate generation, nitrogen evaluation or solver call. Current DB2, fodder
units, totals and economic details change; crop plans, leaching and nitrogen
loads remain fixed. Current values are saved as valuation overlays while the
original successful optimization output, economics snapshot and run identity
remain unchanged. Publication is atomic and retries do not compound adjustments.

## Local validation

From `backend`, use the Pixi Python environment and set
`OPTIMIZER_TEST_DATABASE_URL` to a disposable PostgreSQL database. Integration
cases create isolated schemas and remove them afterward. Also set `DATABASE_URL`
to that disposable database for test subprocesses; never point tests at live data.

- `pixi run test`
- `pixi run test-optimizer`
- `pixi run lint` and `pixi run lint-optimizer`
- From `frontend`: `npm test`, `npm run lint`, `npm run build` (Node 22).

Coverage includes metadata-only/idempotent creation, settings and renaming,
active-run guards, both solvers, preserved inputs/locks, candidate-free writes,
independent repricing, atomic rollback, stale leases, duplicate delivery,
deleted simulations and legacy reports.

A synthetic 244-field benchmark evaluates 181 alternatives per field (44,164
transient alternatives). On the local test environment it saved a 1,600,916-byte
result with the candidate table absent, peaked at 475,277,296 traced Python bytes,
and completed in 23.54 seconds with allocation tracing enabled. This exercises
storage and orchestration with deterministic evaluations, rather than measuring
the live farm's agronomic calculation speed. Lambda and real reference-data
performance require a deployed acceptance run.

## Rollout

Pause submissions and drain existing creation/optimization jobs before the
coordinated release. With simulation writes paused, apply Alembic revision
`20261014_0001`, which preserves only current/saved selected reports and drops
`simulation_field_candidates`. Deploy the worker, API and frontend together,
then resume submissions. Downgrade recreates an empty table; discarded
alternatives require a backup to restore. No infrastructure changes are included.
AWS deployment requires user approval; Terraform apply/destroy and Git push remain manual/excluded.

Repeat the representative farm workflow in eusc-dev after deployment, recording
result/storage bytes, candidate row count, generation/solve/publication times,
and worker memory. Verify maps, yearly values, field edits, locks, outdated
comparisons and DB2-only repricing. Log phases include `load_snapshot`,
`prepare_candidates`, `solve`, `hydrate_winners`, and `persist_result`.
