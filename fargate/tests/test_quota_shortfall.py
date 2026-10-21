import os
import unittest
from types import SimpleNamespace
from unittest.mock import patch

os.environ.setdefault(
    "DATABASE_URL",
    "postgresql+psycopg://dst2:dst2@localhost:5432/dst2",
)

from app.domain.optimization import NUM_YEARS
from plantperform_fargate import orchestrator
from plantperform_fargate.models import (
    FieldInput,
    FixedFieldContribution,
    RotationOption,
    YearlyFieldInput,
    YearlyRotationOption,
)

OPLANDE = [
    SimpleNamespace(kystvand_id=1, kystvand_navn="Haderslev Fjord"),
    SimpleNamespace(kystvand_id=2, kystvand_navn="Lillebælt"),
]


def option(n_load):
    return RotationOption(
        key=str(n_load), id=str(n_load), years=(), db2=0, n_load=n_load, leaching=0, fen=0
    )


def yearly_option(n_load_by_year):
    return YearlyRotationOption(
        key=str(n_load_by_year),
        id=str(n_load_by_year),
        candidate=None,
        years=(),
        db2_by_year=(),
        n_load_by_year=n_load_by_year,
        leaching_by_year=(),
        fen=0,
        fen_by_year=(),
    )


def shortfall_error(lowest, caps):
    with patch.object(
        orchestrator.repository, "get_farm_udledning_per_kystvandopland", return_value=OPLANDE
    ):
        return orchestrator._quota_shortfall_error("farm", "user@example.com", lowest, caps)


class QuotaShortfallTest(unittest.TestCase):
    def test_names_the_opland_that_even_the_least_leaching_rotations_exceed(self):
        lowest = orchestrator._lowest_n_load_by_kystvandopland(
            [
                FieldInput("a", 10, 1, (option(2500.2), option(2600))),
                FieldInput("b", 10, 1, (option(1700), option(1800))),
                FieldInput("c", 10, 1, (option(900),), kvotegivende=False),
            ],
            [FixedFieldContribution(1, db2=0, n_load=0.5, leaching=0, fen=0)],
        )

        error = shortfall_error(lowest, {(1, None): 3737.0})

        self.assertEqual(
            str(error),
            "Med de valgte sædskifter kan udledningen ikke komme under grænsen i "
            "Haderslev Fjord (mindst 4.201 kg N, grænse 3.737 kg N). Vælg flere "
            "sædskifter, eller hæv maks. udledning under Grænser.",
        )

    def test_keeps_the_general_message_when_every_cap_can_be_met(self):
        lowest = orchestrator._lowest_n_load_by_kystvandopland(
            [FieldInput("a", 10, 1, (option(30), option(50)))], []
        )

        self.assertIsNone(shortfall_error(lowest, {(1, None): 40.0}))
        self.assertIsNone(shortfall_error(lowest, {(1, None): None}))

    def test_names_each_year_and_opland_over_its_yearly_cap(self):
        wet_third_year = tuple(50 if year == 2 else 10 for year in range(NUM_YEARS))
        lowest = orchestrator._lowest_n_load_by_kystvandopland_and_year(
            [
                YearlyFieldInput(
                    "a", 10, 1, (yearly_option(wet_third_year), yearly_option((30,) * NUM_YEARS))
                ),
                YearlyFieldInput("b", 10, 2, (yearly_option((60,) * NUM_YEARS),)),
            ],
            [],
        )
        caps = {(1, year): 25.0 for year in range(NUM_YEARS)} | {
            (2, year): None if year else 55.0 for year in range(NUM_YEARS)
        }

        self.assertEqual(
            str(shortfall_error(lowest, caps)),
            "Med de valgte sædskifter kan udledningen ikke komme under grænsen i "
            "Haderslev Fjord i 2029 (mindst 30 kg N, grænse 25 kg N) og Lillebælt i 2027 "
            "(mindst 60 kg N, grænse 55 kg N). Vælg flere sædskifter, eller hæv maks. "
            "udledning under Grænser.",
        )


if __name__ == "__main__":
    unittest.main()
