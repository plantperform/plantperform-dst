# Fargate optimization worker

Production publishes identifier-only optimization messages to SQS. One Linux
ARM64 ECS Fargate task per environment uses 4 vCPUs, 16 GiB memory and four
solver threads. Local development runs the same `plantperform_fargate` solver
package through backend background tasks. Production backend dependencies do
not include this package or OR-Tools.

## Lifecycle

The backend commits the queued run, sends its message, records `published_at`
using PostgreSQL's clock, then wakes the service with `desiredCount=1`. Wakeup
failures are logged and leave the accepted message in SQS. A later submission
for another simulation or a manual service startup must wake the worker to
drain the queue. Resubmitting an already-published run returns its status without
waking the worker; the current UI offers retry only for failed runs. The queue
accepts only `optimization` envelopes with `farmId`, `simulationId` and `runId`.

The task enables ECS task protection and receives one message using a 20-second
long poll. Every job runs in a fresh spawned process, with a 60-minute total
deadline. The database lease lasts 61 minutes and SQS visibility lasts 65 minutes.
Successful results remain guarded by run ID, input revision, lease token and
lease expiry. After confirming a child has stopped, the parent can fail its
matching claim even if that lease expired; it cannot overwrite a replacement
run or lease. OOM counters distinguish memory kills from unexplained exits.
Both clear the active lease and expose a failed result immediately.

Only identified transient infrastructure errors retry, with at most three
execution attempts. Memory exhaustion, process crashes, application errors,
invalid messages/input, infeasibility, timeouts and exhausted attempts go directly
to the DLQ. The existing `simulation_result` row stores the failed status and
error; no separate database table or schema migration is needed. The consumer
sends the original body and message attributes directly to the DLQ, then deletes
the source delivery only after a confirmed send. Send or deletion failures retain
the source request for retry. A redelivered failed run retries only the transfer,
without recomputing or incrementing execution attempts. Completed, replaced,
deleted or outdated requests are acknowledged and discarded. Replacing a failed
run before transfer finishes can therefore discard its old request without a
DLQ copy. Standard SQS may produce duplicate DLQ copies after an ambiguous send
or deletion failure; correlate them by run ID and `PlantPerformSourceMessageId`
(when the original message has room within SQS's ten-attribute limit), or by the
source message ID in worker logs.

After each job the task makes another 20-second poll. Pending retries, DLQ
transfers, or visible/in-flight/delayed queue counts keep it polling with task
protection refreshed. Local retry deadlines also guard against stale queue
counters. Once these are clear, an empty response sets service desired count
to zero while still protected. It checks for queued
publications recorded since that poll began and restores desired count to one
if a new submission raced with shutdown. Otherwise it releases protection and
exits. Later submissions wake a replacement. ECS/DB verification failures
restore desired count and retry. Queue metrics do not wake workers. A completely
killed task still needs a later backend wakeup or manual startup; its unfinished
delivery becomes available when visibility expires. Queue-age, DLQ and worker-error
alarms remain available for monitoring.

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
Fargate receives these names, `OPTIMIZER_DLQ_URL`, `APP_CONFIG_BUCKET` and
`APP_CONFIG_KEY` from its task definition. Its role can send only to that DLQ. The worker loads `DATABASE_URL` from the S3 dotenv object unless
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

Before deploying this worker, manually apply the reviewed infrastructure changes
for 16384 MiB memory, the DLQ URL and DLQ send permission. Deploy dev first,
verify terminal failure/DLQ handoffs and delayed
retries, then repeat the representative economics workload while recording peak
memory. Sixteen GiB is additional capacity, not a proven bound. Use the same
source revision for the backend and worker. At least four Fargate On-Demand
vCPUs must be available. Infrastructure application and deployment are manual.

## Manual recovery of the confirmed development OOM

After deploying the configuration and worker, confirm the old task has
stopped and that no replacement is processing this run. With `DATABASE_URL`
pointing through the development database tunnel, run from `backend`:

```bash
PYTHONPATH=src pixi run python database/scripts/recover_optimization_oom.py \
  --simulation-id c3f79beb-505e-4bbc-97ab-4e1ccc166f0a \
  --run-id 6f8155f6-b722-4aaf-986d-37cb1db450ce
```

This is a dry run. Repeat with `--execute --confirm-worker-stopped`,
`--expected-revision` and `--expected-lease-token` from that output. The command
marks only that matching active claim failed, preserving previous results. It
refuses replaced runs, changed inputs, stale tokens or completed runs, and makes
no AWS calls. Then manually start the updated service to transfer the original
queued message (`9d8b0c45-6619-47f6-aee5-292fe1b60472`) to the DLQ when it becomes
visible, without optimization. This requires the original request to remain in
SQS. Verify failed status in the frontend and the correlated DLQ message before
starting a new run; replacing or deleting this run earlier discards its old
request on redelivery.
