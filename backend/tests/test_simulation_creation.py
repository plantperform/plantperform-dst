"""Creation lifecycle tests use the same disposable schemas as optimizer tests."""

import json
import unittest
from unittest.mock import patch

from test_optimizer_lifecycle import candidate

from app.data.optimizer_inputs import optimizer_input, optimizer_input_json
from app.domain.simulation import CreateSimulationRequest
from app.services.scenario import candidate_evaluator


class CreationUnitTests(unittest.TestCase):
    def test_direct_json_preserves_full_and_compact_payloads(self):
        from app.domain.rotation_candidate import SimulationFieldCandidates

        full = candidate()
        full.years[0].year.afgrode_navn = "Vårbyg"
        full.years[0].db_detail = {"linjer": [{"beløb": 12.125, "værdi": None}]}
        data = SimulationFieldCandidates(field_id="f", jbnr=4, candidates=[full])
        self.assertEqual(json.loads(data.model_dump_json()), data.model_dump(mode="json"))
        self.assertEqual(json.loads(optimizer_input_json(data)), optimizer_input(data))

    def test_preparation_deduplicates_in_order_and_reuses_rotation_inputs(self):
        rotation = [(1, None, None)] * 8
        with (
            patch.object(
                candidate_evaluator.saedskifte_library, "list_variants", return_value=["1", "2"]
            ),
            patch.object(
                candidate_evaluator.saedskifte_library, "generate_rotation", return_value=rotation
            ) as generate,
            patch.object(
                candidate_evaluator, "evaluate_sequence_for_mark", return_value=candidate()
            ) as evaluate,
        ):
            prepared = candidate_evaluator.prepare_candidates(["1", "2"], ["100", "80"])
            self.assertEqual([item.ref.to_id() for item in prepared], ["1:1:100", "1:1:80"])
            for _ in range(3):
                candidate_evaluator.generate_candidates_for_field(
                    ["1", "2"],
                    ["100", "80"],
                    4,
                    CreateSimulationRequest(name="test").godning,
                    prepared=prepared,
                )
            self.assertEqual(generate.call_count, 4)
            self.assertEqual(evaluate.call_count, 6)

    def test_prepared_evaluations_match_individual_evaluations_with_soil_and_history(self):
        from app.domain.rotation_candidate import RotationCandidateRef, SimulationFieldCandidates

        rotation = [(11, 9683, "Tidlig såning"), (1, 9682, "Mellemafgrøde")] * 4
        godning = CreateSimulationRequest(name="parity").godning
        history = {
            "2025": {"code": 1, "mncs": 90, "mnca": 0, "g0": 12},
            "2026": {"code": 11, "mncs": 120, "mnca": 0, "g0": 15},
        }
        soil = {"percolation_by_kategori": (0.3,) * 8, "org_n_topsoil": 3.25, "s_soil": 0.91}
        candidate_evaluator.compute_n_inputs.cache_clear()
        self.addCleanup(candidate_evaluator.compute_n_inputs.cache_clear)
        with (
            patch.object(
                candidate_evaluator.saedskifte_library, "list_variants", return_value=["1"]
            ),
            patch.object(
                candidate_evaluator.saedskifte_library, "generate_rotation", return_value=rotation
            ),
            patch.object(
                candidate_evaluator.afgroede_normer,
                "lookup_norm",
                return_value={
                    "n_norm": 175,
                    "forfrugtsvaerdi": 18,
                },
            ),
            patch.object(candidate_evaluator.afgroede_normer, "lookup_nfix", return_value=2.5),
            patch.object(
                candidate_evaluator.afgroede_normer,
                "lookup_crop_params",
                return_value={"navn": "Vårbyg"},
            ),
            patch.object(
                candidate_evaluator.bridge_v2,
                "evaluate_leaching_position",
                side_effect=lambda **values: {
                    "L_nuar": values["mncs"] * values["percolation_by_kategori"][0],
                    "inputs": values,
                },
            ),
            patch.object(
                candidate_evaluator,
                "calculate_db",
                side_effect=lambda code, form, jb, **values: {
                    "db": values["mncs"] * 11,
                    "udbytte": 125,
                    "udbytteenhed": "FE/ha",
                    "inputs": values,
                },
            ),
        ):
            for early, intermediate in ((True, True), (False, True), (True, False), (False, False)):
                with self.subTest(early=early, intermediate=intermediate):
                    prepared = candidate_evaluator.prepare_candidates(
                        ["1"], ["100", "80"], early, intermediate
                    )
                    generated = candidate_evaluator.generate_candidates_for_field(
                        ["1"],
                        ["100", "80"],
                        4,
                        godning,
                        prepared=prepared,
                        real_history=history,
                        tidlig_saaning=early,
                        mellemafgrode=intermediate,
                        **soil,
                    )
                    expected = [
                        candidate_evaluator.evaluate_candidate_for_mark(
                            RotationCandidateRef(
                                saedskiftevariant="1", variant="1", n_norm_pct=pct
                            ),
                            4,
                            godning.driftsform,
                            godning.org_mineral_n,
                            godning.mineralsk_andel_pct,
                            godning.only_organic,
                            real_history=history,
                            tidlig_saaning=early,
                            mellemafgrode=intermediate,
                            **soil,
                        )
                        for pct in ("100", "80")
                    ]
                    actual_data = SimulationFieldCandidates(
                        field_id="f", jbnr=4, candidates=generated, real_history=history
                    )
                    expected_data = SimulationFieldCandidates(
                        field_id="f", jbnr=4, candidates=expected, real_history=history
                    )
                    self.assertEqual(
                        json.loads(actual_data.model_dump_json()),
                        expected_data.model_dump(mode="json"),
                    )
                    self.assertEqual(
                        json.loads(optimizer_input_json(actual_data)),
                        optimizer_input(expected_data),
                    )
