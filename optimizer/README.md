# Optimizer worker

With `APP_ENV=production`, the API submits to SQS and the Lambda in `optimizer/`
executes the job. Otherwise, the API runs jobs in its local background thread
pool without SQS or AWS credentials. Both solvers, their internal models,
deadlines, solver orchestration, and job execution live in the installable
`plantperform-optimizer` package under `optimizer/src/plantperform_optimizer`.
The `dst2-backend` package retains API contracts, domain models, candidate
calculations, manual rotation editing, summaries, submission, and persistence.
Local runs and Lambda use the same optimizer implementation. Production API
startup and SQS submission do not import the optimizer or OR-Tools.
The backend wheel includes `app.domain/rotations.json`.

`simulation` stores ordered field inputs and explicit manual selections.
`simulation_field_candidates` retains one candidate-cache row per simulation
and field, with a unique index on that pair and cascading simulation deletion.
Candidate sets are inserted individually and never combined into one JSONB
document; single-field requests read only that field's cache. `simulation_result`
contains the current execution state and the latest successful output. An edit
increments the revision and invalidates an active run in the same transaction.
Solver output never changes setup documents or cached candidate rows.

Each cache row contains both full `data` and required, derived `optimizer_input`
JSONB, written in the same transaction. Compact inputs retain references,
overrides/shifts, crop sequences, average metrics, yearly DB/leaching rates,
soil index and real history. The worker reads compact inputs, retains cache
positions internally, and extracts full evaluations only for winning cached
candidates. Manual/fixed selections, previous selected evaluations and newly
calculated yearly shifts retain their full details throughout. Positions never
appear in public responses. Yearly summaries read chosen evaluations and keep
the existing per-year fodder calculation from their full DB details.

A submission supplies `expectedRevision` and a UUID `runId`. Repeating that exact
request returns its persisted state; changed parameters require a new token.
Both `/optimize` and `/optimize-yearly` return HTTP 202 after confirmed SQS
publication or local background-task registration, 409 on conflicts, or 503 if
dispatch fails. SQS messages contain
`jobType: "optimization"`, `farmId`, `simulationId` and `runId`.
Both average and yearly jobs use this type; the persisted run’s `kind` selects the solver.

`GET /farms/{farm_id}/simulations/{simulation_id}/result` returns execution state,
parameters, the latest successful response, its selected candidate evaluations
and the pre-run field snapshot. `?include_output=false` excludes the saved
output from the database read and response for inexpensive polling. The frontend
polls every five seconds during active runs and loads the full result on
completion. Comparisons use saved field/candidate snapshots. Failed or outdated
runs retain the previous successful output; edits require an explicit new POST.

The worker claims a matching queued run or a run with an expired execution lease
under a setup/result lock and commits `in_progress` before loading candidates.
Input preparation counts as processing,
so a slow load does not leave the job visibly queued. A separate snapshot
transaction locks setup before result and verifies the run, lease and revision;
edits or deletion between claim and loading skip that execution. It uses a
unique execution lease, and saves status plus the complete output atomically
only when the run token, lease, and revision still match. Duplicate and stale
messages for completed, deleted, outdated or replaced runs are acknowledged.
Messages for a run with an active lease are left unacknowledged and their
visibility is extended until after lease expiry, without running a second solver.
Unexpected transient failures return the run to queued and retry after 60 seconds,
up to three total
execution attempts (the initial attempt plus two retries) in both local and Lambda
execution. In Lambda, unexpected errors remain unacknowledged even on the final
attempt so SQS moves exhausted messages to the DLQ after its three-receive limit.
Handled final errors persist a failed result; local execution stops after its
third attempt. Exhausted runs cannot be claimed again. Infeasibility and solver
deadlines become acknowledged final failures rather than DLQ messages.

A hard Lambda termination leaves its run in progress. When the message becomes
visible again, the worker can reclaim its expired 960-second lease with a new
execution token and another attempt. The queue visibility timeout is 5400 seconds,
so hard-crash redelivery can wait about 90 minutes. Old workers cannot write after
their lease has been replaced. If a lease expires during execution and a write
is rejected, a still-active matching run is left unacknowledged for redelivery.

Lambda executes only when SQS delivers job messages; there is no scheduled
recovery or automatic DLQ consumer. Dead-letter messages remain available for
manual investigation within the DLQ's 14-day retention limit (measured from
original enqueue time for this standard queue). The CloudWatch DLQ alarm enters
ALARM when at least one message is visible, using Maximum over a five-minute
period. Alarm state changes produce events once per transition, without an
SNS notification or Lambda action. It can alarm again after returning to OK.
Manual incident handling includes repairing the matching database run when
needed: a final hard crash may leave it in progress, and a backend crash before
SQS publication may leave a queued run with no message or DLQ alarm. Preserve
the previous successful output and verify the current run token before repair.
There is no dispatch outbox or job-history table. Deployment order and manual
handling are described in the infrastructure repository's optimizer runbook.

## Simulation creation

`POST /farms/{farm_id}/simulations` authorizes access, saves the submitted
simulation settings and an empty simulation, publishes creation, and returns
HTTP 202. It performs no field or registry reads and generates no candidates.
Supply a UUID `requestId` to recover a lost response: the simulation ID is a
UUIDv5 derived from the farm ID and request ID. Repeated IDs return the existing
simulation without comparing settings or publishing another job. A missing
request ID produces a new simulation each time. `optimizeOnCreate` defaults to
false and travels with the creation message.

The sole persisted creation state is non-null `simulation.creation_status` TEXT,
constrained to `queued`, `running`, `done`, or `failed`. Existing simulations
receive `done`. API summaries expose this as the string `creationStatus`.
Creation progress, errors, leases, requester information and dispatch metadata
are not stored on the simulation. Ordinary settings stay in `simulation.data`;
creation status comes only from its dedicated column. Failure details go to logs.

Every message requires an explicit type. Creation messages contain the validated
POST parameters (excluding `requestId`), requester and expected simulation
revision, in addition to their identifiers. For example:

```json
{
  "jobType": "create_simulation",
  "farmId": "...",
  "simulationId": "...",
  "jobId": "...",
  "requestedBy": "member@example.com",
  "expectedRevision": 0,
  "parameters": {
    "name": "Example",
    "optimizeOnCreate": false,
    "saedskiftevarianter": ["1"],
    "nNormProcenter": ["100"]
  }
}
```

The publisher includes all validated defaults as well. Fields, geometries,
registry inputs and candidates never appear in the message, so farm field count
does not change its size. Local background execution receives the same inputs.
Creation job IDs are UUIDv5 values derived from simulation ID and revision.
Optimization envelopes remain
`{"jobType":"optimization","farmId":"...","simulationId":"...","runId":"..."}`.
Missing or invalid creation parameters fail the batch item before configuration
or executor initialization. Creation bootstraps independently of solver imports.

The worker acquires a nonblocking PostgreSQL session advisory lock keyed by
simulation ID, retains its physical connection through the attempt, and binds
its short transactions to that connection. It commits `running` before loading
current ordered farm fields and registry inputs once. Each attempt clears
previous partial candidates and replaces simulation fields. Inputs remain fixed
for that attempt; subsequent retries observe farm and registry edits. Rotation
combinations are prepared once, and fields are generated individually. Each
field's full and compact candidate payloads and permanent-crop selection commit
atomically; empty candidate sets also allow creation to finish.

Every write checks simulation existence and expected revision. The session lock
survives transaction commits and rollbacks, and is released before returning its
connection to the pool. Connection loss aborts the attempt without reconnecting
or saving through an unlocked replacement connection. Duplicate deliveries while
the lock is held are deferred for 60 seconds; deleted and superseded jobs are
acknowledged. Failed jobs are acknowledged unless the delivery count is exhausted,
in which case they remain unacknowledged for dead-lettering. A `running` job whose
former connection has ended can be reclaimed on redelivery. Completed creation
skips candidate generation.

Creation uses SQS `ApproximateReceiveCount` for the existing three-receive limit.
Transient failures and approaching deadlines return status to `queued` and leave
the message unacknowledged. The final handled transient failure sets `failed`
and stays unacknowledged for the existing DLQ policy. Invalid inputs set `failed`
and are acknowledged. Local execution retries up to three times with the same
60-second delay. Local restart marks interrupted creation failed, while skipping
workers that still hold their advisory lock.

Status reads and deletion remain available throughout creation. Field reads,
edits, and optimization return 409 until `done`. The frontend polls every five
seconds, restores status on reload, and excludes unfinished simulations from
comparisons. It shows “Opretter simulering…” without field counts, or a generic
failure with Retry and Delete. The retry panel offers an unchecked
“Optimér, når simuleringen er klar” checkbox.

`POST /farms/{farm_id}/simulations/{simulation_id}/creation/retry` accepts
`{"optimizeOnCreate": false}`; an empty or omitted body defaults to false. It
requires membership and failed creation, increments the existing simulation
revision, reconstructs the parameters from saved settings, and publishes a new
creation message. Old messages cannot write after that revision change.
Non-failed creation returns 409. The original optimization checkbox choice is
not persisted; the user makes a new choice on Retry.

When automatic optimization is requested, creation completion atomically sets
`done` and reserves an optimization result with a run ID derived from simulation
ID and revision. The matching result's queued, unpublished state identifies an
unfinished handoff. Redelivery can publish it without regenerating fields or
starting another optimization run. The handoff selects SQS explicitly because
Lambda configuration does not establish `APP_ENV`; local execution releases the
creation connection before running local optimizer tasks. Impossible copied
crop-area rules or ordinary optimization publication failures leave creation
ready and expose the failure through the optimization result.

Creation publication failure returns 503 with `detail.simulationId` and marks a
still-queued simulation failed. If an ambiguous publication already reached the
worker, its running or done status is preserved. Use the explicit Retry endpoint
to republish; repeating the original POST only returns the existing simulation.
An API interruption between commit and publication can leave a queued simulation
without a message, and a final hard worker termination can leave status running.
No outbox, scheduler, or automatic DLQ consumer is added. Confirm that a job is
stranded using queue and worker logs and its advisory-lock state before marking
its matching revision failed and using Retry.

The unapplied migration `20261009_0001` (after `20261007_0001`) adds the status
column and constraint directly. Pause submissions and drain old queued/in-flight
jobs and active workers before coordinated deployment: the creation message and
response formats changed. Old creation messages require the complete parameters
before redrive. Deploy migration → worker → backend → frontend, then resume
submissions. Terraform application and destruction remain manual.

Logs retain submission, publication, loading, generation, serialization,
persistence, completion and handoff timings. Isolated PostgreSQL tests cover
constant-size messages, a 250-field POST with no field reads or generation,
request-ID reuse, authorization, full/compact parity, rollback, current-input
retries, advisory locks, connection loss, stale revisions, deletion, local
restart, and optimization handoff recovery. Local tests do not establish deployed
performance; measure representative jobs against the existing memory and
execution limits before promotion.

## Local checks

Use the backend Pixi environment and Node 22. Pixi installs both source packages
in editable mode using their sibling directories. Worker runtime dependencies in
`requirements.lock` are pinned to the matching backend Pixi environment. When
updating that environment, update the worker lock and rebuild both artifacts.
The Docker build installs those runtime dependencies, then installs the backend
and worker wheels without dependency resolution.

From the repository root:

```bash
cd backend
pixi install --locked
pixi run test
pixi run test-optimizer
pixi run lint
pixi run lint-optimizer
```

The PostgreSQL integration suite is opt-in. Point it at a disposable UTF-8
PostgreSQL database where the test role can create schemas. Every case uses a
unique schema and removes it afterward; never point it at production.

```bash
cd backend
OPTIMIZER_TEST_DATABASE_URL=postgresql+psycopg://user:password@localhost:5432/optimizer_test pixi run test
```

The backend suite covers API access, shared calculations, migration up/down,
JSONB edit serialization, revision/token
conflicts, duplicate delivery, failed and ambiguous publication, stale worker
completion, deletion, leases, retries, manual locks/unlocks, genuine average and
yearly solves, shifted candidates, and candidate storage isolation/rollback.
It verifies readiness and HTTP 202 with blocked warm-up, initialization failures,
lifespan cleanup, compact/full numerical and rich-detail parity, and selective
yearly summary reads. The compact-column migration covers backfill, empty
caches, older optional defaults, required inputs and downgrade preservation.
Migration and creation regression cases store more than 256 MiB of candidate
JSON across individual field rows, while selected outputs stay small. A separate
31.6 MB case exercises loading, solving and persistence. Solver and local-runner
unit tests live in `optimizer/tests`; run both suites after a cross-package change.

Build and smoke-test the image from the repository root:

```bash
docker build --platform linux/amd64 --provenance=false -f optimizer/Dockerfile -t plantperform-optimizer:local .
docker run --rm --network none --entrypoint python -e DATABASE_URL=postgresql+psycopg://test@localhost/test plantperform-optimizer:local -c 'from plantperform_optimizer.handler import initialize; initialize()'
```

For normal local testing, copy `backend/.env.default` to `backend/.env`, configure
the local database and authentication secrets, then run `pixi run dev` from
`backend/`. `APP_ENV=development` is the default; a missing, empty, or other
non-production value also selects local execution, even if queue settings exist.
Startup immediately warms the optimizer on a dedicated background thread while
the backend becomes ready. POST handlers register a lightweight callback without
importing the optimizer or waiting for warm-up. Execution waits for initialization
after the response. Initialization failures fail only matching queued runs and
retain previous successful output. The application lifespan joins the
initialization thread on shutdown; production startup never starts it.
Submit through the API or frontend as usual. Both solvers run after the HTTP 202
response and persist their results for polling. Each local attempt has a
900-second total deadline in addition to the requested solver time limit.
Use one backend process. Restarting or reloading it marks any queued or running
jobs failed with `WORKER_LOST`, retaining previous output so a new run can be
submitted.

For an existing local database, stop the backend before updating its schema:

```bash
cd backend
pixi run db-migrate
pixi run dev
```

Revision `20261007_0001` follows `20261005_0001`, derives compact inputs inside
PostgreSQL one field row at a time, then enforces non-nullability. Allow time for
this one-time backfill on large caches. The migration retains full candidate
data and timestamps; its downgrade removes only the derived column. Restarting
after migration starts background warm-up. Production migration and deployment
remain deferred.

Local INFO logs correlate `optimizer_dispatched`, `optimizer_started`,
`optimizer_phase` (`claim`, `load_snapshot`, `setup`, `fields`,
`compact_candidate_reads`, `candidate_validation`, `solve`, `hydrate_winners`)
and `optimizer_finished` by `run_id`. Snapshot subphases include field and
candidate counts; hydration reports the selected candidate count. Dispatch time
includes submission checks and background-task registration. Startup logs
`optimizer_initialized` with initialization duration/outcome and failures;
`optimizer_initialization_wait` correlates any remaining initialization wait
with the run ID. Dispatch wait measures time from queuing to worker entry. Phase times
use a monotonic clock, and total execution includes claim, loading, solving and
result persistence, including failed attempts. Five-second polling can add up
to five seconds plus request time before a worker state change is displayed.
The `solve` phase includes solver input assembly and result assembly.

An idle local PostgreSQL benchmark on 2026-10-07 used a disposable copy of the
reported scenario: 16 field caches, 11,590 candidates after overlays, and
109.05 MB of full stored candidate data. The source connection was read-only;
the copy was backfilled and optimized in an isolated schema, then removed.
Full and compact runs produced identical objective values and complete winning
evaluations. Compact storage occupied 2.10 MB alongside the unchanged full data.

| Phase | Measured seconds |
| --- | ---: |
| Full snapshot before compact reads | 31.78 |
| Compact snapshot, direct comparison | 4.13 |
| Complete local submission call | 0.10 |
| Worker snapshot with previous output | 4.17 |
| Worker solver with previous output | 3.17 |
| Winner hydration with previous output | 0.008 |
| Complete worker with previous output | 7.75 |
| Worker snapshot without previous output | 4.02 |
| Worker solver without previous output | 3.20 |
| Cached winner hydration without previous output | 1.20 |
| Complete worker without previous output | 8.79 |
| Chosen-evaluation yearly summary | 0.12 |
| One-time compact-column backfill | 11.73 |

The worker snapshot subphases with previous output were setup 0.007 s, fields
0.040 s, compact reads 2.048 s and validation 2.070 s. Comparison snapshots were
released before measuring complete worker runs. These are local measurements,
with warm imports and no competing heavy database requests during the timed
phases; they do not guarantee timings on a busy database or in Lambda. Warm-up
can still delay execution of an early submission, and five-second polling adds
display latency. The snapshot target was below five seconds on an idle local
database; both complete worker runs met it.

For later SQS testing, `optimizer_published` records the confirmed message ID,
publication and dispatch times, while `optimizer_received` records the run ID,
message ID, receive count and time since SQS's sent timestamp. That elapsed time
includes any cold-start delay before handler entry and retry visibility delay.
`optimizer_initialized` measures configuration loading and worker import.
Submission explicitly sets `DelaySeconds=0`.

To test the SQS/Lambda path locally, set `APP_ENV=production`, `OPTIMIZER_QUEUE_URL`,
AWS credentials/region, and `OPTIMIZER_SQS_ENDPOINT_URL` for SQS-compatible tooling
or LocalStack. Provide a database URL for your development database and use the
backend Pixi Python after `pixi install --locked`. Call
`plantperform_optimizer.handler.handler` with a normal SQS event and a context
exposing `get_remaining_time_in_millis`. Production queue failures return HTTP 503.

## Deployment

Deployment is deferred while local testing continues. Read-only checks on
2026-10-07 found the eusc-live queue configured with zero delivery delay, but
the optimizer Lambda still used `lambda-dummy:latest` and had no SQS mapping.
Verify deployment of the actual worker and an enabled SQS mapping before
accepting production jobs; these findings are a snapshot, not live status.

Deployment and the controlled migration runbook live in the private
infrastructure repository's `docs/optimizer-rollout.md`. Publish the completed
public source commit and pin it there. Separate backend and optimizer workflows
build from that same pin. The optimizer workflow pushes `:latest` to ECR and
updates Lambda automatically, recording its resolved digest. Both wheels are
built from the same source revision. The backend ZIP keeps sibling `backend/`
and `optimizer/` directories so the same Pixi path dependencies install in the
deployed artifact. Runtime and bootstrap install/run from `/plantperform/backend`;
environment configuration remains `/plantperform/.env`. Coordinate the bundle,
service/bootstrap scripts, and worker rollout when adopting this layout.
