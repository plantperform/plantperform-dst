"""Exercise the unapplied crop consolidation against a disposable PostgreSQL server."""

from __future__ import annotations

import importlib.util
import os
import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import sqlalchemy as sa
from alembic.migration import MigrationContext
from alembic.operations import Operations
from sqlalchemy.orm import sessionmaker

from app.services.economics import db_calculator
from app.services.rotations import afgroede_normer, afstromning

MIGRATIONS = Path(__file__).resolve().parents[1] / "database/migrations/versions"


def load_migration(filename: str):
    spec = importlib.util.spec_from_file_location(
        filename.removesuffix(".py"), MIGRATIONS / filename
    )
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(module)
    return module


class AfgroedeMigrationTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        if hasattr(os, "geteuid") and os.geteuid() == 0:
            raise unittest.SkipTest("initdb cannot run as root")
        binary_dir = Path(sys.executable).parent
        cls.initdb = shutil.which("initdb") or str(binary_dir / "initdb")
        cls.pg_ctl = shutil.which("pg_ctl") or str(binary_dir / "pg_ctl")
        if not Path(cls.initdb).is_file() or not Path(cls.pg_ctl).is_file():
            raise unittest.SkipTest("PostgreSQL test binaries are unavailable")
        cls.tempdir = tempfile.TemporaryDirectory(prefix="afgroede-migration-")
        cls.data = Path(cls.tempdir.name) / "data"
        try:
            subprocess.run(
                [
                    cls.initdb,
                    "-D",
                    str(cls.data),
                    "-A",
                    "trust",
                    "--no-instructions",
                    "--no-locale",
                    "--encoding=UTF8",
                ],
                check=True,
                capture_output=True,
                text=True,
            )
            subprocess.run(
                [
                    cls.pg_ctl,
                    "-D",
                    str(cls.data),
                    "-l",
                    str(Path(cls.tempdir.name) / "postgres.log"),
                    "-o",
                    f"-F -k {cls.tempdir.name} -p 55439 -c listen_addresses=''",
                    "-w",
                    "start",
                ],
                check=True,
                capture_output=True,
                text=True,
            )
            cls.engine = sa.create_engine(
                f"postgresql+psycopg:///{'postgres'}?host={cls.tempdir.name}&port=55439"
            )
        except Exception:
            cls.tempdir.cleanup()
            raise

    @classmethod
    def tearDownClass(cls) -> None:
        cls.engine.dispose()
        subprocess.run(
            [cls.pg_ctl, "-D", str(cls.data), "-m", "immediate", "-w", "stop"],
            check=True,
            capture_output=True,
            text=True,
        )
        cls.tempdir.cleanup()

    def test_upgrade_and_downgrade_preserve_legacy_data_and_lookups(self) -> None:
        previous = load_migration("20260911_0001_runtime_reference_lookups.py")
        permanent = load_migration("20260922_0001_permanent_afgrode.py")
        current = load_migration("20260925_0001_consolidate_afgroede.py")
        with self.engine.begin() as connection:
            op = Operations(MigrationContext.configure(connection))
            previous.op = permanent.op = current.op = op
            connection.execute(sa.text("CREATE TABLE registry_field (crop_history json NOT NULL)"))
            previous.upgrade()
            permanent.upgrade()
            connection.execute(
                sa.text("""
                INSERT INTO registry_field (crop_history)
                VALUES (CAST(:history_1 AS json)), (CAST(:history_2 AS json))
            """),
                {"history_1": '{"2025":905,"2026":0}', "history_2": '{"2025":1}'},
            )
            connection.execute(
                sa.text("""
                INSERT INTO nuar_kode (
                    afgroedekode, navn, m, w, wc, mp, wp,
                    m_ambig, w_ambig, wc_ambig, mp_ambig, wp_ambig
                ) VALUES (1, 'NUAR name', 2, 3, NULL, NULL, NULL,
                          false, false, false, false, false)
            """)
            )
            connection.execute(
                sa.text("""
                INSERT INTO afstromningskategori
                    (afgroedekode, standard_kategori, vinterdaekke_kategori)
                VALUES (1, 3, 1), (2, 4, NULL)
            """)
            )
            connection.execute(
                sa.text("""
                INSERT INTO afgroede_norm_lookup (
                    source_order, jb_nr, afgroedekode, afgroede, jb_gruppe, vanding,
                    udbytteenhed, udbyttenorm, udbyttenorm_alt, n_norm, p_norm,
                    forfrugtsvaerdi, indregn_ffv, driftsform
                ) VALUES
                    (2, 1, 1, 'Workbook name', 'JB 1', 'Uvandet', 'hkg', 50, NULL,
                     100, 20, 5, true, 'Konventionel'),
                    (2, 2, 1, 'Workbook name', 'JB 2', 'Vandet', 'hkg', 55, NULL,
                     101, 20, 5, true, 'Konventionel')
            """)
            )
            connection.execute(
                sa.text("""
                INSERT INTO afgroede_nfix_lookup
                    (source_order, jb_nr, afgroedekode, vanding, nfix_kgn_ha)
                VALUES (2, 1, 1, 'Uvandet', 7), (3, 1, 3, 'Uvandet', 8)
            """)
            )
            connection.execute(
                sa.text(
                    "INSERT INTO permanent_afgrode (afgroedekode, navn) "
                    "VALUES (1, 'Permanent name')"
                )
            )
            current.upgrade()

            crops = {
                row.afgroedekode: row
                for row in connection.execute(
                    sa.text("SELECT * FROM afgroede ORDER BY afgroedekode")
                ).mappings()
            }
            self.assertEqual(set(crops), {1, 2, 3, 905})
            with self.assertRaises(sa.exc.IntegrityError), connection.begin_nested():
                connection.execute(sa.text("INSERT INTO afgroede (afgroedekode) VALUES (0)"))
            self.assertEqual(crops[1]["navn"], "NUAR name")
            self.assertEqual(crops[1]["norm_navn"], "Workbook name")
            self.assertEqual(crops[1]["udbytteenhed"], "hkg")
            self.assertEqual(crops[1]["p_norm"], 20)
            self.assertEqual(crops[1]["forfrugtsvaerdi"], 5)
            self.assertTrue(crops[1]["indregn_ffv"])
            self.assertIsNone(crops[2]["navn"])
            self.assertIsNone(crops[2]["m"])
            self.assertFalse(crops[3]["has_nuar"])
            self.assertIsNone(crops[3]["navn"])
            self.assertFalse(crops[905]["has_nuar"])
            self.assertIsNone(crops[905]["navn"])
            self.assertTrue(crops[1]["permanent"])
            self.assertFalse(crops[2]["permanent"])
            self.assertNotIn("nuar_kode", sa.inspect(connection).get_table_names())
            self.assertNotIn("permanent_afgrode", sa.inspect(connection).get_table_names())
            self.assertNotIn(
                "afgroede",
                [col["name"] for col in sa.inspect(connection).get_columns("afgroede_norm_lookup")],
            )

            # Exercise public runtime/economics results against the migrated rows.
            factory = sessionmaker(bind=connection)
            with (
                patch.object(afgroede_normer, "SessionLocal", factory),
                patch.object(afstromning, "SessionLocal", factory),
                patch.object(db_calculator, "SessionLocal", factory),
            ):
                afgroede_normer.clear_lookup_cache()
                afstromning.clear_lookup_cache()
                db_calculator._load_udbyttenormer.cache_clear()
                self.assertEqual(
                    afgroede_normer.lookup_norm(1, 1),
                    {
                        "afgroede": "Workbook name",
                        "jb_gruppe": "JB 1",
                        "vanding": "Uvandet",
                        "udbytteenhed": "hkg",
                        "udbyttenorm": 50,
                        "udbyttenorm_alt": None,
                        "n_norm": 100,
                        "p_norm": 20,
                        "forfrugtsvaerdi": 5,
                        "indregn_ffv": True,
                    },
                )
                self.assertEqual(afgroede_normer.lookup_nfix(1, 1), 7)
                self.assertEqual(afgroede_normer.lookup_crop_params(1)["M"], 2)
                self.assertEqual(afgroede_normer.lookup_crop_params(905), {})
                self.assertTrue(afgroede_normer.is_permanent_afgrode(1))
                self.assertEqual(afstromning.afstromningskategori(1, eea_on=True), 1)
                self.assertEqual(afstromning.afstromningskategori(2), 4)
                self.assertEqual(
                    db_calculator._lookup_udbyttenorm(1, 1)[0],
                    {
                        "udbytteenhed": "hkg",
                        "udbyttenorm": 50,
                        "n_norm": 100,
                    },
                )
                afgroede_normer.clear_lookup_cache()
                afstromning.clear_lookup_cache()
                db_calculator._load_udbyttenormer.cache_clear()

            current.downgrade()
            self.assertEqual(
                connection.execute(
                    sa.text(
                        "SELECT afgroede, udbytteenhed, p_norm, forfrugtsvaerdi, indregn_ffv "
                        "FROM afgroede_norm_lookup WHERE jb_nr = 1"
                    )
                ).one(),
                ("Workbook name", "hkg", 20, 5, True),
            )
            self.assertEqual(
                connection.execute(
                    sa.text("SELECT navn, m, w FROM nuar_kode WHERE afgroedekode = 1")
                ).one(),
                ("NUAR name", 2, 3),
            )
            self.assertEqual(
                connection.execute(
                    sa.text(
                        "SELECT standard_kategori FROM afstromningskategori WHERE afgroedekode = 2"
                    )
                ).scalar_one(),
                4,
            )
            self.assertNotIn("afgroede", sa.inspect(connection).get_table_names())
            self.assertEqual(
                connection.execute(
                    sa.text("SELECT navn FROM permanent_afgrode WHERE afgroedekode = 1")
                ).scalar_one(),
                "NUAR name",
            )
