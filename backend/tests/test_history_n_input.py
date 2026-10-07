import os
import unittest
from unittest.mock import patch

os.environ.setdefault(
    "DATABASE_URL",
    "postgresql+psycopg://dst2:dst2@localhost:5432/dst2",
)

from app.services.scenario import field_history_evaluator

VAARBYG = 1
AERTER = 30
BRAK = 310

NORMS = {
    VAARBYG: {"n_norm": 136.0, "forfrugtsvaerdi": 0.0},
    AERTER: {"n_norm": 0.0, "forfrugtsvaerdi": 18.0},
}

HISTORICAL = {
    VAARBYG: {"mncs": 120.0, "g0": 30.0},
    AERTER: {"mncs": 40.0, "g0": 60.0},
    BRAK: {"mncs": 20.0, "g0": 70.0},
}


def fake_lookup_norm(crop_code, jb_nr, irrigated=False, only_organic=False):
    return NORMS.get(crop_code)


def fake_lookup_historisk(afgrode_kode, jbnr, goedningsregion, oeko):
    return dict(HISTORICAL.get(afgrode_kode, {"mncs": 0.0, "g0": 0.0}))


class HistoryNInputTests(unittest.TestCase):
    def setUp(self) -> None:
        patchers = [
            patch.object(
                field_history_evaluator.afgroede_normer, "lookup_norm", fake_lookup_norm,
            ),
            patch.object(
                field_history_evaluator, "lookup_historisk_n_input", fake_lookup_historisk,
            ),
        ]
        for patcher in patchers:
            patcher.start()
            self.addCleanup(patcher.stop)

    def history_n_input(self, code):
        return field_history_evaluator._history_n_input(code, 4, "Fyn", False, False)

    def test_crop_with_n_norm_keeps_historical_allocation(self) -> None:
        self.assertEqual(
            self.history_n_input(VAARBYG), {"mncs": 120.0, "mnca": 0.0, "g0": 30.0},
        )

    def test_zero_n_norm_gets_no_allocation(self) -> None:
        self.assertEqual(
            self.history_n_input(AERTER), {"mncs": 0.0, "mnca": 0.0, "g0": 0.0},
        )

    def test_missing_norm_row_gets_no_allocation(self) -> None:
        self.assertEqual(
            self.history_n_input(BRAK), {"mncs": 0.0, "mnca": 0.0, "g0": 0.0},
        )

    def test_missing_year_gets_no_allocation(self) -> None:
        self.assertEqual(
            self.history_n_input(None), {"mncs": 0.0, "mnca": 0.0, "g0": 0.0},
        )

    def test_simulation_lookup_keeps_historical_allocation(self) -> None:
        # _n_input feeds generate_permanent_crop_candidate, which must not apply the rule.
        self.assertEqual(
            field_history_evaluator._n_input(BRAK, 4, "Fyn", False),
            {"mncs": 20.0, "mnca": 0.0, "g0": 70.0},
        )


if __name__ == "__main__":
    unittest.main()
