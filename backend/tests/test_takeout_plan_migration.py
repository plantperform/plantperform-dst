import importlib.util
import unittest
from pathlib import Path
from unittest.mock import patch

MIGRATION_PATH = (
    Path(__file__).resolve().parents[1]
    / "database"
    / "migrations"
    / "versions"
    / "20260910_0002_repair_takeout_plan_json.py"
)


def load_migration_module():
    spec = importlib.util.spec_from_file_location("repair_takeout_plan", MIGRATION_PATH)
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class TakeoutPlanMigrationTests(unittest.TestCase):
    def test_upgrade_repairs_only_boolean_values_in_every_legacy_location(self) -> None:
        migration = load_migration_module()
        statements: list[str] = []

        with patch.object(migration.op, "execute", side_effect=statements.append):
            migration.upgrade()

        self.assertEqual(len(statements), 4)
        for table in ("field", "simulation_field"):
            for key in ("in_takeout_plan", "inTakeoutPlan"):
                statement = next(
                    sql for sql in statements if f"UPDATE {table}" in sql and f"'{{{key}}}'" in sql
                )
                self.assertIn(f"jsonb_typeof(data->'{key}') = 'boolean'", statement)
                self.assertIn("THEN 'ja' ELSE 'nej'", statement)

    def test_downgrade_leaves_mars_text_untouched(self) -> None:
        migration = load_migration_module()
        with patch.object(migration.op, "execute") as execute:
            migration.downgrade()
        execute.assert_not_called()


if __name__ == "__main__":
    unittest.main()
