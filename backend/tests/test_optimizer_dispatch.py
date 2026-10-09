import asyncio
import os
import unittest
from unittest.mock import patch

from app import main


class StartupTests(unittest.TestCase):
    def startup(self):
        async def run():
            async with main.lifespan(main.app):
                pass

        asyncio.run(run())

    def test_non_production_startup_recovers_interrupted_jobs_without_aws(self):
        for mode in (None, "", "development", "test", "staging", "DEVELOPMENT"):
            with (
                self.subTest(mode=mode),
                patch.dict(os.environ),
                patch.object(main, "recover_local_runs") as recover,
                patch.object(main, "recover_local_jobs") as recover_creations,
                patch.object(main, "validate_aws_region") as validate,
                patch.object(main, "start_local_optimizer") as warmup,
            ):
                if mode is None:
                    os.environ.pop("APP_ENV", None)
                else:
                    os.environ["APP_ENV"] = mode
                self.startup()
                recover.assert_called_once_with()
                recover_creations.assert_called_once_with()
                validate.assert_not_called()
                warmup.assert_called_once_with()
                warmup.return_value.close.assert_called_once_with()

    def test_production_startup_preserves_aws_validation_and_queued_jobs(self):
        for mode in ("production", "PRODUCTION"):
            with (
                self.subTest(mode=mode),
                patch.dict(os.environ, {"APP_ENV": mode}),
                patch.object(main, "recover_local_runs") as recover,
                patch.object(main, "recover_local_jobs") as recover_creations,
                patch.object(main, "validate_aws_region") as validate,
                patch.object(main, "start_local_optimizer") as warmup,
            ):
                self.startup()
                validate.assert_called_once_with()
                recover.assert_not_called()
                recover_creations.assert_not_called()
                warmup.assert_not_called()
