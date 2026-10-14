"""Compatibility for queued creation messages: recover settings, never generate candidates."""

from app.data.simulation_settings_store import recover_creation
from app.domain.creation_job import CreationJob, optimization_run_id
from app.domain.optimization import OptimizeSimulationRequest
from app.services.optimization import jobs


def execute(job, context, *, sqs_delivery=False, receive_count=1):
    job = CreationJob.model_validate(job)
    simulation = recover_creation(
        job.farm_id, job.simulation_id, job.requested_by, expected_revision=job.expected_revision
    )
    if simulation is not None and job.parameters.optimize_on_create:
        tasks = None
        if not sqs_delivery:
            from fastapi import BackgroundTasks

            tasks = BackgroundTasks()
        jobs.submit(
            job.farm_id,
            job.simulation_id,
            job.requested_by,
            "optimize",
            OptimizeSimulationRequest(
                expected_revision=simulation.revision,
                run_id=optimization_run_id(simulation.id, simulation.revision),
            ),
            background_tasks=tasks,
            transport="sqs" if sqs_delivery else "local",
        )
        if tasks is not None:
            return tasks


def execute_local(job):
    import asyncio

    tasks = execute(job, None)
    if tasks is not None:
        asyncio.run(tasks())
