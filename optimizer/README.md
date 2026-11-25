# Optimizer

Production publishes identifier-only optimization messages to SQS. Each environment
runs up to ten 10 GiB standard workers and one 30 GiB large worker. Both use
Linux ARM64 Fargate, 4 vCPUs and four solver threads. Local development runs the
same `optimizer` solver package through backend background tasks. Production backend dependencies do
not include this package or OR-Tools.

## Lifecycle

The backend commits the queued run, sends its message, records `published_at`
using PostgreSQL's clock, then scales the service on submission. Each published,
unfinished standard run counts once, including runs already being solved. For 1–2 jobs
the service requests one task, for 3–5 it requests two, and for 6–8 it requests
three. Ten jobs request four tasks and 27 or more request ten. Each submission
sends the calculated total to ECS. If the next submission brings the unfinished
total to five, it requests two tasks. Wakeup
failures are logged and leave the accepted message in SQS. A later submission
for another simulation or a manual service startup must wake the worker to
drain the queue. Resubmitting an already-published run returns its status without
waking the worker; the current UI offers retry only for failed runs. The queue
accepts only `optimization` envelopes with `farmId`, `simulationId` and `runId`.

The task enables ECS task protection and receives one message using a 20-second
long poll. Every optimization job runs in a fresh spawned process with a two-hour
total deadline. The database lease lasts 121 minutes. SQS visibility and ECS task
protection each last 125 minutes.
Successful results remain guarded by run ID, input revision, lease token and
lease expiry. After confirming a child has stopped, the parent can fail its
matching claim even if that lease expired; it cannot overwrite a replacement
run or lease.

The supervisor claims the run before spawning the solver. The child limits its
virtual address space to 9 GiB on standard workers and 29 GiB on large workers.
Every 200 ms the supervisor checks the cgroup's usage against that threshold and
the child's virtual size against a 256 MiB margin below the limit. A threshold
crossing, an allocation failure, or a cgroup-confirmed memory kill on a standard
worker moves the same run to `queued_large` and clears `published_at`. The worker
sends the original message to the large queue, records the new queue’s `published_at`,
and wakes the large service before acknowledging the standard delivery.
A large worker claims the job as `in_progress_large`. A terminal large-worker
failure stores `worker_tier=large` in the existing error JSON for DLQ routing.
A redelivery can resume an incomplete handoff. Each standard submission also
checks for published, unfinished large runs and wakes their service if its
desired count is zero. Queue visibility metrics are used only for monitoring.
A whole-task loss before promotion retries in the standard
tier when the original message is available to a worker again.

Only identified transient infrastructure errors retry, with at most three
execution attempts plus one additional attempt for a run promoted to large.
A proven infeasible optimization is saved as `infeasible` with a Danish reason
and acknowledged after the transaction commits. A duplicate
delivery is acknowledged even if an older worker saved it as `failed` with code
`INFEASIBLE`. The frontend shows the reason alongside the last successful figures.
If search ends at its time limit before finding a plan, the run is also saved
as `infeasible`, with reason `NO_SOLUTION_WITHIN_TIME_LIMIT`. The message describes
the search deadline, and both the first delivery and redeliveries are acknowledged.
Large-worker memory exhaustion, unexplained process crashes, application errors,
invalid messages/input, execution deadline failures and exhausted attempts go directly
to the processing tier's DLQ. The `simulation_result` row stores the failed
status and error. The consumer sends the original body and message attributes
directly to the DLQ, then deletes
the source delivery only after a confirmed send. Send or deletion failures retain
the source request for retry. A redelivered failed run retries only the transfer,
without recomputing or incrementing execution attempts. Completed, replaced,
deleted or outdated requests are acknowledged and discarded. Replacing a failed
run before transfer finishes can therefore discard its old request without a
DLQ copy. Standard SQS may produce duplicate DLQ copies after an ambiguous send
or deletion failure; correlate them by run ID and `PlantPerformSourceMessageId`
(when the original message has room within SQS's ten-attribute limit), or by the
source message ID in worker logs.

After each job the task makes another 20-second poll. On an empty poll it requests
desired count zero, releases protection and exits. If a run was published since
the poll started, it polls again. A per-service PostgreSQL advisory lock orders
these decisions and is released during the SQS wait. Large workers listen for
service-specific PostgreSQL wake notifications during the poll. A concurrent
wake or lost listener triggers a fresh poll. Siblings remain protected through
execution and acknowledgement. A task waiting for its own deferred retry or
dead-letter handoff keeps polling under protection at desired count zero.
If every task is lost at zero, the next submission or a manual service start
wakes the queue within its four-day retention. Queue-age, DLQ and worker-error alarms provide monitoring.

SIGTERM stops consumption and terminates any unfinished child without deleting
its message. Task protection guards normal scale-in and deployments, but cannot
prevent infrastructure failures or a forced task stop. Rolling deployments
allow up to 100% of the service's desired count and wait for protected tasks to drain.

## API and computation

Simulation creation saves settings and an economics snapshot synchronously with
HTTP 201. It does not generate candidates. Both optimization endpoints return
HTTP 202, taking `expectedRevision` and UUID `runId`; saved optimization options
remain authoritative. Run duration is controlled by the worker: preparation,
solving and publication share the two-hour execution deadline. After model
construction, CP-SAT searches for up to one hour, shortened if necessary to
reserve 30 seconds for publication. It can finish earlier at the 0.3% gap
target. A feasible plan at the time limit is published as a completed result.
Successful responses include `optimalityGapPct` when a finite bound is available,
measured against the solver objective including yearly quota payments. Earlier
results can omit this field. Legacy client-supplied or saved durations
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
`OPTIMIZER_QUEUE_URL`, `FARGATE_CLUSTER_NAME`, `FARGATE_SERVICE_NAME` and
`FARGATE_LARGE_SERVICE_NAME`.
The backend launch template supplies ECS names through a systemd drop-in.
Each task definition supplies its service name, worker tier, source queue, DLQ,
`APP_CONFIG_BUCKET` and `APP_CONFIG_KEY`. The standard worker also receives
`OPTIMIZER_LARGE_QUEUE_URL` and the large service name for handoffs. The worker
loads `DATABASE_URL` from the S3 dotenv object unless it is already set. Secrets
are never baked into the image.

From `backend`, run `pixi run test`, `pixi run test-optimizer`, `pixi run lint`, and
`pixi run lint-optimizer`. Set `OPTIMIZER_TEST_DATABASE_URL` to a disposable UTF-8
PostGIS database to enable integration cases; they create and remove isolated
schemas. Never point tests at production data. The `production` Pixi environment
omits local solver dependencies: `pixi install --locked -e production`.

From the repository root, build with:

```bash
docker buildx build --platform linux/arm64 --load --provenance=false \
  -f optimizer/Dockerfile -t optimizer:test .
```

The image runs `python -m optimizer`. Running it locally requires an ARM64 host
or ARM64 emulation. Deployment CI builds on a native ARM64 runner.
Inspect phase logs for `load_snapshot`, `prepare_candidates`, `solve`,
`hydrate_winners` and `persist_result`.

In dev first, pause submissions and drain the old workers to zero. Pin the
application revision in the infrastructure repository's `public-source.lock`.
Apply the status-constraint migration, deploy the matching frontend, backend
and worker image, and manually apply the Terraform changes. Refresh the backend from the
updated launch template so its service receives `FARGATE_LARGE_SERVICE_NAME`
before resuming submissions. Drain active large runs before downgrading the
status constraint.
Verify a standard memory cutoff completes the same run on the large worker and
a large-worker cutoff reaches the large DLQ. Peak capacity is 44 Fargate On-Demand
vCPUs per environment. Submit ten concurrent runs and verify a target of four.
Check that an idle task can request zero while protected siblings finish and publish results.
Exercise delayed retries and dead-letter handoffs at zero before repeating in live.

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
