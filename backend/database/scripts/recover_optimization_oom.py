"""Record a confirmed stopped run's OOM failure in its existing result.

Dry-run by default. This command never calls AWS or reruns the optimizer.
Use DATABASE_URL for the intended environment (through its private DB tunnel).
"""

import argparse
import json

from sqlalchemy import select

from app.data import optimization_store
from app.data.db import SessionLocal
from app.data.db import simulation_result_table as results
from app.data.db import simulation_table as setups


def recover(args):
    with SessionLocal() as session:
        row = session.execute(
            select(
                setups.c.farm_id,
                setups.c.revision,
                results.c.run_id,
                results.c.input_revision,
                results.c.status,
                results.c.lease_token,
                results.c.lease_expires_at,
            )
            .join(results)
            .where(setups.c.id == args.simulation_id)
        ).one()
    if row.run_id != args.run_id or row.input_revision != row.revision:
        raise ValueError("Run was replaced or its simulation inputs changed; refusing recovery")
    print(json.dumps(dict(row._mapping), default=str, indent=2))
    if not args.execute:
        print("Dry run. Confirm the task has stopped and OOM is documented before executing.")
        return
    if not args.confirm_worker_stopped or not args.expected_lease_token:
        raise ValueError("Execution requires --confirm-worker-stopped and --expected-lease-token")
    if args.expected_revision is None:
        raise ValueError("Execution requires --expected-revision from the dry run")
    if not optimization_store.finish(
        args.simulation_id,
        args.run_id,
        args.expected_lease_token,
        args.expected_revision,
        stopped=True,
        error={"code": "OUT_OF_MEMORY", "message": "Optimeringen løb tør for hukommelse."},
    ):
        raise ValueError("Run, revision, status or lease changed; no recovery was performed")
    print(
        "Run marked failed. Start the updated worker manually to transfer its original "
        "queued message to the DLQ when visible. Do not replace this run before handoff."
    )


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    for name in ("simulation-id", "run-id"):
        parser.add_argument(f"--{name}", required=True)
    parser.add_argument("--expected-revision", type=int)
    parser.add_argument("--expected-lease-token")
    parser.add_argument("--confirm-worker-stopped", action="store_true")
    parser.add_argument("--execute", action="store_true")
    recover(parser.parse_args())


if __name__ == "__main__":
    main()
