# Compact farm and simulation views

The API serves stored display snapshots. Lambda prepares farm history, simulation
result projections, and successful optimization projections. The normal
frontend views do not fetch candidate details for every field. Full breakdowns
are loaded when the user opens a field's calculation panel.

## Deployment order

Use a coordinated write pause while changing the schema and application versions.
AWS changes require user approval. Terraform apply and destroy remain manual.

1. Drain legacy creation/optimization jobs, take the normal database backup,
   and apply Alembic revision `20261014_0001`. Earlier revisions create read-model
   identities and queued state; the final revision preserves selected legacy
   reports and drops the candidate table without calculating new alternatives.
2. Deploy the optimizer image containing `prepare_farm_history` and
   `prepare_simulation_view` handlers. Keep `APP_ENV=production` and the existing
   SQS transport on the deployed API.
3. Publish/deploy the API and frontend from the same application revision, then
   resume writes. Bump the infrastructure repository's `public-source.lock` to
   that committed revision before publishing its backend and optimizer artifacts.
4. Open an existing farm and simulation. Missing snapshots prepare automatically;
   check preparation state and worker logs. A bulk backfill or waiting for every
   farm to finish is not required before enabling the frontend.

The existing `plantperform` backend process must be replaced or restarted to load
the new source. Updating an S3 bundle does not replace the code in a running
instance. Updating an ECR tag does not replace the deployed Lambda image.

## View and preparation behavior

- `GET /farms/{farm_id}/view` includes the farm, preparation state, view version,
  and ready field/year/summary data.
- `GET /farms/{farm_id}/simulations/{simulation_id}/view` also includes stored
  crop-area ranges, rotation choices, and the latest successful comparison
  snapshot. Its status and display data are read together from one SQL snapshot.
- Full view GET requests verify access, then queue preparation if the current
  snapshot is missing. Migration-created queued rows prepare on first use.
  Ready snapshots, including empty farms, and active jobs are reused. Simulation
  view preparation waits until legacy recovery or economics recalculation finishes.
- `include_data=false` selects metadata only and never publishes jobs. Missing
  or unfinished projections have `data: null`. Calculations run on workers.
- Failed preparation retries with a new generation when the user reopens the
  view. Cached failed views reload once on opening; status polls never restart
  them. Automatic dispatch failures appear as failed view state.
- Active jobs are polled every two seconds while the page is visible and online.
- Field registration returns 202. A batch changes the farm revision once and
  submits one history job. The UI waits for ready history rather than displaying
  uncalculated zero figures. Saving simulation settings does not require history preparation; the first run requires ready farm history.
- Retry endpoints are `POST /farms/{farm_id}/history/retry` and
  `POST /farms/{farm_id}/simulations/{simulation_id}/view/retry`.
  The history endpoint also recalculates ready history, advancing the farm
  revision. Choose **Genberegn historik** in the history-row menu. Active
  preparations are reused; existing simulation inputs and saved results remain.
- Edits update the small current projection in the same transaction as the setup
  revision. Last successful comparison snapshots remain immutable during edits,
  failed runs, or new optimization runs. Detail selection retains fixed → economics valuation → saved
  optimization → manual precedence.
- New successful outputs retain their run token for subsequent view preparation.
  Older records whose token was replaced by a later submission retain their numerical
  comparison data with a legacy snapshot identity when no original token exists.
- Preparation messages contain identifiers, input revision, and generation,
  rather than fields or calculation reports. Advisory locks prevent duplicate
  executions. Revision/generation checks reject stale writes, and deletion
  cascades to projections and stored historical details.

## Simulation metadata without candidate storage

New publications use `prepared` version 3: per-field aggregate crop-area bounds
and selected result values only. Alternative candidates, compact solver inputs,
and candidate reference/code arrays are never persisted. Rotation choices come
from the library and saved parameters; worker preparation keeps numerical
alternatives in memory and publishes only the chosen result.

Field edits rebuild aggregate summaries from cheap sequences and preserve the
last successful comparison. Migration `20261014_0001` preserves selected legacy
reports in setup/result JSONB and drops the candidate table. Legacy display
snapshots remain readable; their next publication drops candidate metadata.
DB2 recalculation uses physical calculation inputs from chosen reports and
updates current valuation overlays without solving or altering nitrogen results.

Use the coordinated worker/API/frontend rollout after draining old jobs. No
candidate calculation or solver backfill is required. Apply `20261014_0001`
with simulation writes paused; it copies only selected reports before dropping
`simulation_field_candidates`. Downgrade recreates the empty table and retains
those selected reports; discarded alternatives require a backup to restore.
See the optimizer README for current workflow, checks and the representative storage benchmark.

## Registry and reference-data imports

Deploying changed code or importing reference data leaves existing snapshots in
place. Missing views use the current calculation logic when first prepared.
Users can choose **Genberegn historik** to update a farm's history when needed.
Adding or removing fields still automatically prepares updated history.

## Local verification

Run the backend and optimizer suites against disposable PostgreSQL, the frontend
suite, Python/TypeScript lint, and the frontend production build. Alembic has a
single `20261014_0001` head; selected-report promotion, table removal, rollback,
and downgrade are tested in isolated schemas.

The representative projection has 500 fields and 90,500 candidate choices.
Size regressions require prepared JSON to be at least 90% smaller than the legacy
format for both shared and differing candidate sets. A simulation display read
executes one SQL query and does not access
candidate-cache tables; status reads omit snapshot documents. Tests also cover
yearly totals/FEN/quota eligibility, permanent crops, area bounds, manual edits,
rollback, stale revisions/generations/tokens, retries, deletion, and preservation
of saved results. Frontend tests verify shared requests, metadata polling,
version-triggered snapshot fetching, two-second polling, cached-failure reopening,
hidden/offline pauses, and cleanup after the last consumer closes. Backend tests
cover preparation on first load, read-only metadata requests, concurrent loads,
dispatch failures, and manual history recalculation without altering simulations.

## Acceptance in eusc-dev

Repeat the 244-field creation/optimization workflow and record the backend's
idle CPU and network baseline beforehand. Confirm one compact display request
per loaded view, status-only polls while jobs are active, and field-detail reads
only after opening a calculation panel. Check maps, year selection, fertilizer
figures, winter covers, locks, rules, and saved comparisons.

`api_request` logs record the route template, status, response bytes, and elapsed
time without recording request bodies or credentials. Worker logs distinguish
preparation from creation and optimization. After requests and jobs finish, CPU
should return near the idle baseline. If it remains elevated, obtain a process
sample through approved instance access and correlate it with these timings.

This live acceptance check requires deploying the new application and manually
applying the schema. Local tests do not establish deployed CPU or latency.
