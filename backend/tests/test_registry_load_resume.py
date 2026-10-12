"""Recovery checks against an explicitly selected, disposable local PostGIS DB.

Set REGISTRY_LOAD_TEST_DSN to a localhost database named registry_resume_test.
Each test gets its own schema; DATABASE_URL is never used for these tests.
"""

from __future__ import annotations

import io
import os
import tempfile
import unittest
from contextlib import contextmanager, redirect_stderr, redirect_stdout
from pathlib import Path
from unittest.mock import Mock, patch
from uuid import uuid4

import geopandas as gpd
import psycopg
from psycopg import sql
from psycopg.conninfo import conninfo_to_dict, make_conninfo
from shapely.geometry import Polygon

from database.scripts import load_registry_data as pipeline
from database.scripts import load_registry_from_merged_gpkg as loader
from database.scripts import registry_load_checkpoint as checkpoint


class RegistryLoadCliTests(unittest.TestCase):
    def test_defaults_and_options_reach_loader(self) -> None:
        load = Mock()
        with patch("sys.argv", ["loader"]):
            checkpoint.run_cli(checkpoint.FULL_COMMAND, load)
        load.assert_called_once_with(restart=False, batch_size=10_000)
        load.reset_mock()
        with patch("sys.argv", ["loader", "--restart", "--batch-size", "250"]):
            checkpoint.run_cli(checkpoint.FULL_COMMAND, load)
        load.assert_called_once_with(restart=True, batch_size=250)

    def test_connection_failure_exits_with_recovery_instructions(self) -> None:
        output = io.StringIO()
        load = Mock(side_effect=psycopg.OperationalError("SSL unexpected eof"))
        with patch("sys.argv", ["loader"]), redirect_stderr(output):
            with self.assertRaises(SystemExit) as error:
                checkpoint.run_cli(checkpoint.FULL_COMMAND, load)
        self.assertEqual(error.exception.code, 1)
        self.assertIn("reopen", output.getvalue())
        self.assertIn("pixi run load-registry-data", output.getvalue())
        load.assert_called_once()

    def test_invalid_batch_size_never_calls_loader(self) -> None:
        load = Mock()
        for value in ("0", "-1", "abc"):
            with self.subTest(value=value):
                with patch("sys.argv", ["loader", "--batch-size", value]):
                    with redirect_stderr(io.StringIO()), self.assertRaises(SystemExit):
                        checkpoint.run_cli(checkpoint.FULL_COMMAND, load)
        load.assert_not_called()

    def test_pipeline_order_matches_existing_task_chain(self) -> None:
        self.assertEqual(
            [name for name, _ in pipeline.LOADERS],
            [
                "kystvandoplande",
                "goedningsregioner",
                "mars-projekter",
                "historisk-goedningsfordeling",
                "saedskifte-lookup",
                "afgroeder",
                "oekonomital-afgroedebundet",
                "oekonomital-generelle-satser",
                "kvotegivende-areal",
            ],
        )


class RegistryLoadRecoveryTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        dsn = os.getenv("REGISTRY_LOAD_TEST_DSN")
        if not dsn:
            raise unittest.SkipTest("Set REGISTRY_LOAD_TEST_DSN for disposable local PostGIS tests")
        config = conninfo_to_dict(dsn)
        if config.get("host") not in {"127.0.0.1", "localhost", "::1"} or (
            config.get("dbname") != "registry_resume_test"
        ):
            raise RuntimeError("Recovery tests require a local database named registry_resume_test")
        cls.base_dsn = make_conninfo(dsn, connect_timeout=5)
        with psycopg.connect(cls.base_dsn) as connection:
            connection.execute("SELECT postgis_version()")

    def setUp(self) -> None:
        self.schema = "registry_resume_" + uuid4().hex
        with psycopg.connect(self.base_dsn, autocommit=True) as connection:
            connection.execute(sql.SQL("CREATE SCHEMA {}").format(sql.Identifier(self.schema)))
        self.addCleanup(self.drop_schema)
        self.dsn = make_conninfo(self.base_dsn, options=f"-c search_path={self.schema},public")
        self.temp = tempfile.TemporaryDirectory(prefix="registry-resume-")
        self.addCleanup(self.temp.cleanup)
        self.gpkg = Path(self.temp.name) / "fields.gpkg"
        self.write_source([1, 2, 3, 4, 5])
        self.output = io.StringIO()
        output_context = redirect_stdout(self.output)
        output_context.__enter__()
        self.addCleanup(output_context.__exit__, None, None, None)
        for target, name, value in (
            (loader, "MERGED_GPKG", self.gpkg),
            (pipeline, "MERGED_GPKG", self.gpkg),
            (loader, "database_dsn", Mock(return_value=self.dsn)),
            (pipeline, "database_dsn", Mock(return_value=self.dsn)),
        ):
            patcher = patch.object(target, name, value)
            patcher.start()
            self.addCleanup(patcher.stop)
        with self.connect() as connection:
            connection.execute("""
                CREATE TABLE registry_field (
                    imk_id bigint PRIMARY KEY, cvr text, marknr text, markblok text, journalnr text,
                    area_ha double precision, crop_rotation text, crop_history json,
                    geom geometry(MULTIPOLYGON,4326), centroid geometry(POINT,4326),
                    sample_bucket smallint, in_takeout_plan text,
                    udledningsgraense_kgn_ha double precision,
                    udledningskvote_mark_kgn double precision, jbnr smallint,
                    kystvand_id integer, kystvand_navn text, retention double precision,
                    oeko boolean, oestoette boolean, hoejeste_hnv smallint, kvotegivende boolean,
                    omlaegningsplan_virkemiddel text, omlaegningsplan_status text,
                    percolation_by_kategori jsonb, org_n_topsoil double precision,
                    s_soil double precision, banned boolean, secondary_crop_history jsonb
                );
                CREATE TABLE afgroede (afgroedekode integer PRIMARY KEY);
                INSERT INTO registry_field (imk_id, marknr) VALUES (999, 'original');
            """)

    def connect(self, **kwargs) -> psycopg.Connection:
        return psycopg.connect(self.dsn, **kwargs)

    def drop_schema(self) -> None:
        with psycopg.connect(self.base_dsn, autocommit=True) as connection:
            connection.execute(
                sql.SQL("DROP SCHEMA {} CASCADE").format(sql.Identifier(self.schema))
            )

    def write_source(self, ids: list[int | None], *, geometries: list | None = None) -> None:
        polygon = Polygon([(10, 55), (10.01, 55), (10.01, 55.01), (10, 55)])
        rows = []
        for index, imk_id in enumerate(ids):
            rows.append(
                {
                    "IMK_ID": imk_id,
                    "Marknr": f"source-{index}",
                    "IMK_areal": 1.23456,
                    "CVR": 123,
                    "JB_Kode": 4,
                    "UdledgrKgNPerHa": 10.55555,
                    "RetTot": 0.4567,
                    "KystvandID": 1,
                    "markblok": "block",
                    "journalnr": "journal",
                    "oeko": "true",
                    "oestoette": "0",
                    "hoejeste_hnv": 3,
                    "kvotegivende": "1",
                    "omlaegningsplan_virkemiddel": None,
                    "omlaegningsplan_status": None,
                    "kystvand_navn": "water",
                    "orgNtopsoil2024": 3.12345,
                    "S_soil2024": 0.9999,
                    **{column: 0.12345 for column in loader.PERCOLATION_COLUMNS_BY_KATEGORI},
                    **{f"Afg{year}": 101 for year in loader.CROP_HISTORY_YEARS},
                    "geometry": polygon if geometries is None else geometries[index],
                }
            )
        if self.gpkg.exists():
            self.gpkg.unlink()
        gpd.GeoDataFrame(rows, crs=4326).to_file(self.gpkg, layer=loader.LAYER, driver="GPKG")

    @contextmanager
    def load_run(self, *, command=checkpoint.MERGED_COMMAND, restart=False, metadata=None):
        with checkpoint.open_load_run(self.dsn, command) as run:
            run.start([self.gpkg], metadata or loader.merged_source_metadata(), restart=restart)
            yield run

    def state(self) -> dict:
        with self.connect() as connection:
            return connection.execute(
                f"SELECT state FROM {checkpoint.CHECKPOINT_TABLE}"
            ).fetchone()[0]

    def ids(self, table="registry_field") -> list[int]:
        with self.connect() as connection:
            return [
                row[0]
                for row in connection.execute(
                    sql.SQL("SELECT imk_id FROM {} ORDER BY imk_id").format(sql.Identifier(table))
                )
            ]

    def test_disconnect_during_copy_preserves_only_committed_batches(self) -> None:
        original_values = loader.staging_values
        with self.assertRaises(psycopg.OperationalError), self.load_run() as run:

            def disconnect(row, imk_id):
                if imk_id == 4:
                    with self.connect(autocommit=True) as control:
                        control.execute(
                            "SELECT pg_terminate_backend(%s)", (run.connection.info.backend_pid,)
                        )
                return original_values(row, imk_id)

            with patch.object(loader, "staging_values", side_effect=disconnect):
                loader.load_merged_run(run, batch_size=2)
        self.assertEqual(self.state()["next_offset"], 2)
        self.assertEqual(self.ids(checkpoint.STAGING_TABLE), [1, 2])
        self.assertEqual(self.ids(), [999])
        original_read = loader.read_dataframe
        with patch.object(loader, "read_dataframe", wraps=original_read) as read:
            loader.load_registry_from_merged_gpkg(batch_size=2)
        self.assertEqual([call.kwargs["skip_features"] for call in read.call_args_list], [2, 4])
        self.assertEqual(self.ids(), [1, 2, 3, 4, 5])
        self.assertTrue(self.state()["complete"])
        self.assertEqual(self.state()["next_offset"], 5)

    def test_lost_batch_commit_ack_resumes_after_committed_batch(self) -> None:
        with self.assertRaisesRegex(psycopg.OperationalError, "ack"), self.load_run() as run:
            transaction = run.connection.transaction

            @contextmanager
            def lost_ack(*args, **kwargs):
                with transaction(*args, **kwargs) as tx:
                    yield tx
                if run.state["next_offset"] == 2:
                    raise psycopg.OperationalError("lost COMMIT ack")

            with patch.object(run.connection, "transaction", lost_ack):
                loader.load_merged_run(run, batch_size=2)
        self.assertEqual(self.state()["next_offset"], 2)
        self.assertEqual(self.ids(checkpoint.STAGING_TABLE), [1, 2])
        with patch.object(loader, "read_dataframe", wraps=loader.read_dataframe) as read:
            loader.load_registry_from_merged_gpkg(batch_size=2)
        self.assertEqual(read.call_args_list[0].kwargs["skip_features"], 2)
        self.assertEqual(self.ids(), [1, 2, 3, 4, 5])

    def test_duplicates_skipped_only_batch_and_partial_final_batch(self) -> None:
        polygon = Polygon([(10, 55), (10.01, 55), (10, 55.01), (10, 55)])
        self.write_source([1, 2, 1, None, 3, 4, 5], geometries=[polygon] * 5 + [None, polygon])
        original_read = loader.read_dataframe

        def stop_after_first_batch(*args, **kwargs):
            if kwargs["skip_features"] == 2:
                raise psycopg.OperationalError("stop")
            return original_read(*args, **kwargs)

        with patch.object(loader, "read_dataframe", side_effect=stop_after_first_batch):
            with self.assertRaises(psycopg.OperationalError):
                loader.load_registry_from_merged_gpkg(batch_size=2)
        loader.load_registry_from_merged_gpkg(batch_size=2)
        state = self.state()
        self.assertEqual(self.ids(), [1, 2, 3, 5])
        self.assertEqual(
            [
                state[key]
                for key in ("next_offset", "loaded", "skipped_no_geom", "skipped_dup_imk_id")
            ],
            [7, 4, 1, 2],
        )
        with self.connect() as connection:
            row = connection.execute("""
                SELECT marknr, cvr, retention, percolation_by_kategori, org_n_topsoil,
                    s_soil, banned, ST_SRID(geom), ST_GeometryType(geom), udledningskvote_mark_kgn
                FROM registry_field WHERE imk_id=1
            """).fetchone()
        self.assertEqual(row[:3], ("source-0", "00000123", 0.46))
        self.assertEqual(row[3], {str(k): 0.123 for k in range(1, 9)})
        self.assertEqual(row[4:], (3.123, 1.0, False, 4326, "ST_MultiPolygon", 13.032))

    def test_geometry_repair_rollback_and_resume_without_recopy(self) -> None:
        bowtie = Polygon([(10, 55), (10.01, 55.01), (10.01, 55), (10, 55.01), (10, 55)])
        self.write_source([1], geometries=[bowtie])
        with self.assertRaisesRegex(RuntimeError, "repair"), self.load_run() as run:
            save = run.save

            def fail_repair(**changes):
                if changes.get("phase") == "repaired":
                    raise RuntimeError("repair failed before COMMIT")
                save(**changes)

            with patch.object(run, "save", side_effect=fail_repair):
                loader.load_merged_run(run, batch_size=2)
        self.assertEqual(self.state()["phase"], "copying")
        with self.connect() as connection:
            self.assertFalse(
                connection.execute(
                    f"SELECT ST_IsValid(geom) FROM {checkpoint.STAGING_TABLE}"
                ).fetchone()[0]
            )
        with patch.object(loader, "read_dataframe", side_effect=AssertionError("must not recopy")):
            loader.load_registry_from_merged_gpkg(batch_size=2)
        with self.connect() as connection:
            self.assertTrue(
                connection.execute("SELECT ST_IsValid(geom) FROM registry_field").fetchone()[0]
            )

    def test_registry_replacement_rolls_back_with_its_marker(self) -> None:
        with self.connect() as connection:
            connection.execute("ALTER TABLE afgroede ADD CHECK (afgroedekode < 100)")
        with self.assertRaises(psycopg.errors.CheckViolation):
            loader.load_registry_from_merged_gpkg(batch_size=2)
        self.assertEqual(self.ids(), [999])
        self.assertEqual(self.state()["phase"], "repaired")
        with self.connect() as connection:
            connection.execute("ALTER TABLE afgroede DROP CONSTRAINT afgroede_afgroedekode_check")
        with patch.object(loader, "read_dataframe", side_effect=AssertionError("must not recopy")):
            loader.load_registry_from_merged_gpkg(batch_size=2)
        self.assertEqual(self.ids(), [1, 2, 3, 4, 5])

    def test_lost_finalization_ack_does_not_replace_registry_again(self) -> None:
        with self.assertRaisesRegex(psycopg.OperationalError, "ack"), self.load_run() as run:
            transaction = run.connection.transaction

            @contextmanager
            def lost_ack(*args, **kwargs):
                with transaction(*args, **kwargs) as tx:
                    yield tx
                if run.state["phase"] == "finalized":
                    raise psycopg.OperationalError("lost finalization COMMIT ack")

            with patch.object(run.connection, "transaction", lost_ack):
                loader.load_merged_run(run, batch_size=2)
        self.assertEqual(self.state()["phase"], "finalized")
        self.assertEqual(self.ids(), [1, 2, 3, 4, 5])
        with self.connect() as connection:
            connection.execute("UPDATE registry_field SET marknr='enriched'")
        with patch.object(
            loader, "finalize_registry_field", side_effect=AssertionError("published")
        ):
            loader.load_registry_from_merged_gpkg(batch_size=2)
        with self.connect() as connection:
            self.assertEqual(
                connection.execute("SELECT DISTINCT marknr FROM registry_field").fetchall(),
                [("enriched",)],
            )

    def test_interrupted_cleanup_rolls_back_drop_and_preserves_finalized_marker(self) -> None:
        with self.assertRaisesRegex(RuntimeError, "cleanup"), self.load_run() as run:
            save = run.save

            def fail_cleanup(**changes):
                if changes.get("phase") == "cleaned":
                    raise RuntimeError("cleanup failed")
                save(**changes)

            with patch.object(run, "save", side_effect=fail_cleanup):
                loader.load_merged_run(run, batch_size=2)
        self.assertEqual(self.state()["phase"], "finalized")
        self.assertEqual(self.ids(checkpoint.STAGING_TABLE), [1, 2, 3, 4, 5])
        with patch.object(
            loader, "finalize_registry_field", side_effect=AssertionError("published")
        ):
            loader.load_registry_from_merged_gpkg(batch_size=2)
        self.assertEqual(self.state()["phase"], "cleaned")

    def test_premature_eof_never_publishes_partial_registry(self) -> None:
        read = loader.read_dataframe

        def premature_eof(*args, **kwargs):
            frame = read(*args, **kwargs)
            return frame.iloc[:0] if kwargs["skip_features"] == 2 else frame

        with patch.object(loader, "read_dataframe", side_effect=premature_eof):
            with self.assertRaisesRegex(checkpoint.CheckpointError, "Premature end"):
                loader.load_registry_from_merged_gpkg(batch_size=2)
        self.assertEqual(self.ids(), [999])
        self.assertEqual(self.state()["next_offset"], 2)

    def test_missing_or_inconsistent_staging_requires_restart(self) -> None:
        for corruption in ("DROP TABLE registry_merged_load", "DELETE FROM registry_merged_load"):
            with self.subTest(corruption=corruption):
                with self.load_run(restart=True) as run:
                    loader.load_staging(run, batch_size=2)
                with self.connect() as connection:
                    connection.execute(corruption)
                with self.assertRaisesRegex(checkpoint.CheckpointError, "--restart"):
                    loader.load_registry_from_merged_gpkg(batch_size=2)
                self.assertEqual(self.ids(), [999])

    def test_changed_sources_and_checkpoint_versions_require_restart(self) -> None:
        with self.load_run():
            pass
        original_id = self.state()["run_id"]
        # Same layer and feature count: only the content fingerprint changes.
        self.write_source([8, 9, 10, 11, 12])
        with self.assertRaisesRegex(checkpoint.CheckpointError, "Source files"):
            loader.load_registry_from_merged_gpkg(batch_size=2)
        self.assertEqual(self.state()["run_id"], original_id)
        with self.load_run(restart=True) as run:
            self.assertNotEqual(run.state["run_id"], original_id)
            run.save(version=0)
        with self.assertRaisesRegex(checkpoint.CheckpointError, "Incompatible"):
            loader.load_registry_from_merged_gpkg(batch_size=2)
        loader.load_registry_from_merged_gpkg(restart=True, batch_size=2)
        self.assertEqual(self.ids(), [8, 9, 10, 11, 12])

    def test_source_change_during_batch_rolls_back_that_batch(self) -> None:
        original_values = loader.staging_values

        def change_source(row, imk_id):
            if imk_id == 3:
                self.gpkg.touch()
            return original_values(row, imk_id)

        with patch.object(loader, "staging_values", side_effect=change_source):
            with self.assertRaisesRegex(checkpoint.CheckpointError, "Source changed"):
                loader.load_registry_from_merged_gpkg(batch_size=2)
        self.assertEqual(self.state()["next_offset"], 2)
        self.assertEqual(self.ids(checkpoint.STAGING_TABLE), [1, 2])

    def test_command_ownership_and_concurrent_run_rejection(self) -> None:
        with self.load_run(command=checkpoint.FULL_COMMAND):
            with self.assertRaisesRegex(checkpoint.CheckpointError, "Another registry loader"):
                with checkpoint.open_load_run(self.dsn, checkpoint.MERGED_COMMAND):
                    self.fail("concurrent run acquired lock")
        with self.assertRaisesRegex(
            checkpoint.CheckpointError, "belongs to pixi run load-registry-data"
        ):
            loader.load_registry_from_merged_gpkg(batch_size=2)
        loader.load_registry_from_merged_gpkg(restart=True, batch_size=2)
        self.assertEqual(self.state()["command"], checkpoint.MERGED_COMMAND)

    def test_pipeline_resumes_remaining_steps_then_starts_fresh_after_success(self) -> None:
        order = []

        def enrich():
            order.append("enrich")
            with self.connect() as connection:
                connection.execute("UPDATE registry_field SET marknr='enriched'")

        second = Mock(side_effect=[RuntimeError("later loader failed"), None, None])
        steps = (("enrich", enrich), ("finish", second))
        with (
            patch.object(pipeline, "LOADERS", steps),
            patch.object(pipeline, "source_paths", return_value=[self.gpkg]),
            patch.object(pipeline, "migrate") as migrate,
        ):
            with self.assertRaisesRegex(RuntimeError, "later loader"):
                pipeline.load_registry_data(batch_size=2)
            initial_run_id = self.state()["run_id"]
            self.assertEqual(self.state()["completed_steps"], [checkpoint.MERGED_STEP, "enrich"])
            with patch.object(pipeline, "load_merged_run", side_effect=AssertionError("must skip")):
                pipeline.load_registry_data(batch_size=2)
            self.assertEqual(self.state()["run_id"], initial_run_id)
            self.assertTrue(self.state()["complete"])
            self.assertEqual(order, ["enrich"])
            with self.connect() as connection:
                self.assertEqual(
                    connection.execute("SELECT DISTINCT marknr FROM registry_field").fetchall(),
                    [("enriched",)],
                )
            pipeline.load_registry_data(batch_size=2)
        self.assertEqual(order, ["enrich", "enrich"])
        self.assertEqual(second.call_count, 3)
        self.assertEqual(migrate.call_count, 3)
        self.assertNotEqual(self.state()["run_id"], initial_run_id)

    def test_standalone_completed_run_starts_fresh_and_keeps_staging_option(self) -> None:
        loader.load_registry_from_merged_gpkg(batch_size=2, keep_staging=True)
        initial_id = self.state()["run_id"]
        self.assertEqual(self.ids(checkpoint.STAGING_TABLE), [1, 2, 3, 4, 5])
        loader.load_registry_from_merged_gpkg(batch_size=3)
        self.assertNotEqual(self.state()["run_id"], initial_id)
        self.assertTrue(self.state()["complete"])
        self.assertEqual(self.state()["phase"], "cleaned")


if __name__ == "__main__":
    unittest.main()
