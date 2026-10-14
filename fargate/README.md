# Fargate optimization worker

Production publishes identifier-only optimization messages to SQS. One Linux
ARM64 ECS Fargate task per environment uses 8 vCPUs, 16 GB memory and eight
solver threads. Local development runs the same `plantperform_fargate` solver
package through backend background tasks. Production backend dependencies do
not include this package or OR-Tools.

## Lifecycle

The backend commits the queued run, sends its message, records `published_at`
using PostgreSQL's clock, then wakes the service with `desiredCount=1`. Wakeup
failures leave the accepted message in SQS; a visible-message CloudWatch alarm
provides recovery. The queue accepts only `optimization` envelopes with
`farmId`, `simulationId` and `runId`.

The task enables ECS task protection and receives one message using a 20-second
long poll. Every job runs in a fresh spawned process, with a 60-minute total
deadline. The database lease lasts 61 minutes and SQS visibility lasts 65 minutes.
Results remain guarded by run ID, input revision, lease token and lease expiry.
Retries are limited to three attempts; exhausted worker failures and malformed
messages remain unacknowledged for dead-lettering. Domain failures such as
infeasibility and timeouts are persisted and acknowledged as terminal results.
A killed task's delivery becomes available when visibility expires.

After each job the task makes one more 20-second poll. On an empty response it
sets service desired count to zero while still protected. It checks for queued
publications recorded since that poll began and restores desired count to one
if a new submission raced with shutdown. Otherwise it releases protection and
exits. Later submissions wake a replacement. ECS/DB verification failures
restore desired count and retry. The fallback alarm considers visible messages
only; it does not keep starting tasks for invisible retries. Delayed messages
wake a task once visible. CloudWatch metrics are approximate and may briefly
cause an unnecessary replacement; each empty worker follows the same shutdown.

SIGTERM stops consumption and terminates any unfinished child without deleting
its message. Task protection guards normal scale-in and deployments, but cannot
prevent infrastructure failures or a forced task stop. Deployments allow one
task at most and wait for the protected worker to drain before replacement.

## API and computation

Simulation creation saves settings and an economics snapshot synchronously with
HTTP 201. It does not generate candidates. Both optimization endpoints return
HTTP 202, taking `expectedRevision` and UUID `runId`; saved optimization options
remain authoritative. Run duration is controlled by the worker: preparation,
solving and publication share the existing one-hour total execution deadline.
The solver uses the remaining execution time with a 30-second reserve for
completing and publishing results. Legacy client-supplied or saved durations
are ignored; neither optimization endpoint accepts a duration setting.

The first execution captures farm fields and registry/soil context. Subsequent
runs retain field IDs, constraints, manual choices and captured context.
Alternative candidates exist only in worker memory. Only winning reports,
field/year outputs, provenance and compact display projections are published,
in one transaction. Failed or stale work preserves previous successful output.

Economics recalculation and history/view preparation run in the backend during
the HTTP request, with a cooperative 45-second budget and one attempt. Successful
calculation/retry actions return 200 and field registration returns 201 with
refreshed values. Failures are persisted; the existing explicit retry routes
remain available. Busy calculations return 409 and calculation timeouts return
504. Economics recalculation preserves crop choices, leaching and nitrogen
loads; it changes valuation overlays without running a solver. Backend startup
recovers interrupted small calculations and preserves production Fargate runs.

## Configuration and validation

Backend production configuration needs `APP_ENV=production`, `AWS_DEFAULT_REGION`,
`OPTIMIZER_QUEUE_URL`, `FARGATE_CLUSTER_NAME` and `FARGATE_SERVICE_NAME`.
The backend launch template supplies ECS names through a systemd drop-in.
Fargate receives these names, `APP_CONFIG_BUCKET` and `APP_CONFIG_KEY` from its
task definition. The worker loads `DATABASE_URL` from the S3 dotenv object unless
it is already set. Secrets are never baked into the image.

From `backend`, run `pixi run test`, `pixi run test-fargate`, `pixi run lint`, and
`pixi run lint-fargate`. Set `OPTIMIZER_TEST_DATABASE_URL` to a disposable UTF-8
PostGIS database to enable integration cases; they create and remove isolated
schemas. Never point tests at production data. The `production` Pixi environment
omits local solver dependencies: `pixi install --locked -e production`.

From the repository root, build with:

```bash
docker buildx build --platform linux/arm64 --load --provenance=false \
  -f fargate/Dockerfile -t plantperform-fargate:test .
```

An ARM host or QEMU support is needed to execute the image. Deployment CI installs
QEMU, builds ARM64, checks compiled imports and solves a CP-SAT problem before
publishing. Inspect phase logs for `load_snapshot`, `prepare_candidates`, `solve`,
`hydrate_winners` and `persist_result`.

No new Alembic migration is needed for this compute change. Drain all legacy
creation/economics/preparation messages before replacing Lambda; the new worker
rejects them. Deploy dev first and verify the representative farm workflow,
sequential jobs, wakeup from zero, shutdown after one empty poll, and message
arrival during shutdown. Live requires at least eight available Fargate On-Demand
vCPUs. Infrastructure application, AWS deployment and quota changes are manual.
