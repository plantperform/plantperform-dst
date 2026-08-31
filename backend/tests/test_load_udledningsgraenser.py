import importlib.util
import sys
from pathlib import Path
from unittest import TestCase
from unittest.mock import patch

SCRIPT_PATH = (
    Path(__file__).resolve().parents[1] / "database" / "scripts" / "load_udledningsgraenser.py"
)
SPEC = importlib.util.spec_from_file_location("load_udledningsgraenser", SCRIPT_PATH)
assert SPEC is not None and SPEC.loader is not None
loader = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = loader
SPEC.loader.exec_module(loader)


class FakeCursor:
    def __init__(self) -> None:
        self.statements: list[str] = []
        self.rowcount = 0

    def __enter__(self) -> "FakeCursor":
        return self

    def __exit__(self, *_: object) -> None:
        return None

    def execute(self, statement: str) -> None:
        self.statements.append(statement)
        if "WITH parts AS" in statement:
            self.rowcount = 7
        elif "UPDATE field AS f" in statement:
            self.rowcount = 3
        elif "UPDATE registry_field" in statement:
            self.rowcount = 11

    def fetchone(self) -> tuple[int]:
        return (2,)


class FakeConnection:
    def __init__(self, cursor: FakeCursor) -> None:
        self._cursor = cursor
        self.committed = False

    def __enter__(self) -> "FakeConnection":
        return self

    def __exit__(self, *_: object) -> None:
        return None

    def cursor(self) -> FakeCursor:
        return self._cursor

    def commit(self) -> None:
        self.committed = True


class LoadUdledningsgraenserTests(TestCase):
    def test_overlay_resets_then_syncs_linked_farm_fields(self) -> None:
        cursor = FakeCursor()
        connection = FakeConnection(cursor)

        with patch.object(loader.psycopg, "connect", return_value=connection):
            result = loader.compute_overlay("postgresql://example")

        self.assertEqual(result.reset_registry_fields, 11)
        self.assertEqual(result.updated_registry_fields, 7)
        self.assertEqual(result.synchronized_farm_fields, 3)
        self.assertEqual(result.unmatched_farm_fields, 2)
        self.assertTrue(connection.committed)
        self.assertIn("SET\n                    udledningsgraense_kgn_ha = 0", cursor.statements[0])
        self.assertIn("WITH parts AS", cursor.statements[1])
        self.assertIn("UPDATE field AS f", cursor.statements[2])
        self.assertIn("udledningskvote_mark_kgn", cursor.statements[2])
        self.assertIn("SELECT count(*)", cursor.statements[3])
