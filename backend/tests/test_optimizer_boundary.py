import os
import subprocess
import sys
import textwrap
import unittest


class ProductionBoundaryTests(unittest.TestCase):
    def test_api_starts_and_submits_without_importing_optimizer_or_ortools(self):
        script = textwrap.dedent("""
            import importlib.abc
            import json
            import sys
            from types import SimpleNamespace
            from unittest.mock import Mock, patch
            from uuid import uuid4

            class BlockSolverImports(importlib.abc.MetaPathFinder):
                def find_spec(self, fullname, path=None, target=None):
                    if fullname.split('.')[0] in {'plantperform_optimizer', 'ortools'}:
                        raise AssertionError('Production imported solver code: ' + fullname)

            sys.meta_path.insert(0, BlockSolverImports())
            from fastapi.testclient import TestClient
            from app import main
            from app.auth import AuthenticatedUser, current_user
            from app.domain.optimization import OptimizeSimulationRequest, SimulationResult
            from app.services.optimization import jobs

            request = OptimizeSimulationRequest(expected_revision=0, run_id=uuid4())
            queued = SimulationResult(status='queued', run_id=str(request.run_id))
            queue = Mock()
            main.app.dependency_overrides[current_user] = lambda: AuthenticatedUser(
                email='member@example.com'
            )
            with (
                patch.object(main, 'validate_aws_region') as validate,
                patch.object(main, 'recover_local_runs') as recover,
                patch.object(jobs, 'SessionLocal') as sessions,
                patch.object(jobs, '_row', return_value=SimpleNamespace(revision=0)),
                patch.object(jobs, 'get_result', return_value=queued),
                patch.object(jobs, 'sqs_client', return_value=queue),
            ):
                session = sessions.begin.return_value.__enter__.return_value
                session.execute.return_value.one.return_value = SimpleNamespace(
                    run_id=None, status='not_started'
                )
                with TestClient(main.app) as client:
                    response = client.post(
                        '/api/v0/farms/farm/simulations/sim/optimize',
                        json=request.model_dump(mode='json'),
                    )
                assert response.status_code == 202, response.text
                assert response.json()['runId'] == str(request.run_id)
                validate.assert_called_once_with()
                recover.assert_not_called()
                queue.send_message.assert_called_once()
                assert queue.send_message.call_args.kwargs['DelaySeconds'] == 0
                assert json.loads(queue.send_message.call_args.kwargs['MessageBody']) == {
                    'simulationId': 'sim', 'runId': str(request.run_id),
                }
            assert not any(
                name.split('.')[0] in {'plantperform_optimizer', 'ortools'}
                for name in sys.modules
            )
        """)
        environment = {
            **os.environ,
            "APP_ENV": "production",
            "DATABASE_URL": "postgresql+psycopg://test@localhost/test",
            "OPTIMIZER_QUEUE_URL": "test-queue",
        }
        result = subprocess.run(
            [sys.executable, "-c", script],
            env=environment,
            capture_output=True,
            text=True,
            timeout=60,
        )
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
