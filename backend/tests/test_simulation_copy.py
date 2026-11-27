"""A "Kopier som ny" copy is its source again: settings, fields, choices and result."""

import json
from unittest.mock import patch
from uuid import uuid4

from sqlalchemy import insert, select, update
from test_optimizer_lifecycle import CONTEXT, EMAIL, DatabaseTests, candidate, field
from test_read_models import rich_candidate
from test_simulation_field_set import new_field, registry_row

from app.data import quota_value_store, read_model_store, repository, simulation_store
from app.data import simulation_settings_store as settings
from app.data.db import farm_member_table, farm_table, field_table
from app.data.db import simulation_quota_value_table as quota_values
from app.data.db import simulation_result_table as results
from app.data.db import simulation_table as setups
from app.domain.creation import CreationConflictError
from app.domain.economics import EconomicsSnapshot
from app.domain.field import CreateFieldRequest, UpdateFieldRequest
from app.domain.optimization import OptimizeSimulationRequest
from app.domain.rotation_candidate import RotationCandidateRef, SimulationFieldCandidates
from app.domain.simulation import CreateSimulationRequest
from app.services.optimization import jobs
from app.services.scenario.rotations import apply_manual_rotation
from optimizer import preparation, worker
from optimizer.orchestrator import OptimizationInfeasibleError

# What a result is, apart from how the run that made it was carried out.
RESULT_COLUMNS = (
    "status",
    "kind",
    "parameters",
    "input_revision",
    "result_revision",
    "queued_at",
    "started_at",
    "finished_at",
    "error",
    "output",
)


def evaluation(variant="1"):
    value = candidate(200 if variant == "2" else 100, variant)
    value.active_len = 8
    for year in value.years:
        year.db_detail = {"udbytteenhed": "FE/ha", "udbytte": 2}
    return value


def generate(copied_field, registry, request, **kwargs):
    return simulation_store.split_field(
        copied_field.model_dump(mode="json")
    ), SimulationFieldCandidates(
        field_id=copied_field.id, jbnr=4, candidates=[evaluation("1"), evaluation("2")]
    )


def evaluate(ref, overrides, start_year=1, **kwargs):
    value = evaluation(ref.variant)
    value.start_year = start_year
    value.overrides = overrides
    return value


class SimulationCopyTests(DatabaseTests):
    def setUp(self):
        super().setUp()
        self.registry_contexts = {}
        for target, name, replacement in (
            (worker, "prepare", {"wraps": preparation.prepare}),
            (worker, "hydrate", {"wraps": preparation.hydrate}),
            (preparation.candidate_evaluator, "prepare_candidates", {"return_value": []}),
            (preparation.candidate_evaluator, "evaluate_with_overrides", {"side_effect": evaluate}),
            (repository, "prepare_simulation_field", {"side_effect": generate}),
            (repository, "_soil_data_for_context", {"return_value": ((), 3, 1)}),
            (
                repository,
                "_historical_years_for_context",
                {"return_value": rich_candidate().years},
            ),
            (
                repository,
                "_registry_contexts_for_imk_ids",
                {"side_effect": lambda _, imk_ids: self.registry_contexts},
            ),
        ):
            self.enterContext(patch.object(target, name, **replacement))
        with self.sessions.begin() as session:
            for field_id in ("farm-a", "farm-b", "farm-c"):
                value = field(field_id)
                session.execute(
                    insert(field_table).values(
                        id=value.id, farm_id="farm", data=value.model_dump(mode="json")
                    )
                )

    def create(self, farm_id="farm", **values):
        request = CreateSimulationRequest(
            **{
                "name": "New",
                "saedskiftevarianter": ["1"],
                "n_norm_procenter": ["100"],
                **values,
            }
        )
        return settings.create(farm_id, request, EMAIL)

    def copy(self, source, **values):
        return self.create(copy_from=source.id, **values)

    def submit(self, simulation):
        request = OptimizeSimulationRequest(expected_revision=simulation.revision, run_id=uuid4())
        return jobs.submit("farm", simulation.id, EMAIL, "optimize", request)

    def optimize(self, simulation):
        worker.execute(simulation.id, self.submit(simulation).run_id, CONTEXT)
        result = simulation_store.get_result("farm", simulation.id, EMAIL)
        self.assertEqual(result.status, "completed", result.error)
        return result

    def current(self, simulation):
        return repository.get_simulation("farm", simulation.id, EMAIL)

    def fields_of(self, simulation):
        return repository.list_simulation_fields("farm", simulation.id, EMAIL)

    def stored(self, simulation):
        with self.sessions() as session:
            return session.execute(
                select(
                    setups.c.data, setups.c.fields, setups.c.field_order, setups.c.revision
                ).where(setups.c.id == simulation.id)
            ).one()

    def stored_result(self, simulation):
        with self.sessions() as session:
            row = session.execute(
                select(results).where(results.c.simulation_id == simulation.id)
            ).one()
        return dict(row._mapping)

    def view_data(self, simulation):
        with self.sessions() as session:
            data, _ = read_model_store.build_simulation(session, simulation.id)
        return data

    def own_ids(self, simulation):
        """The ids that are the simulation's own, each with what it stands for."""
        result = self.stored_result(simulation)
        names = {simulation.id: "the simulation"}
        for run_id, name in (
            ((result["output"] or {}).get("run_id"), "the run behind the result"),
            (result["run_id"], "the latest run"),
        ):
            if run_id:
                names.setdefault(run_id, name)
        order = self.stored(simulation).field_order
        return names | {field_id: f"field {i}" for i, field_id in enumerate(order)}

    def by_role(self, simulation, value):
        """The value as plain JSON, with the simulation's own ids named by role."""
        text = json.dumps(value, default=str)
        for own, name in self.own_ids(simulation).items():
            text = text.replace(own, name)
        return json.loads(text)

    def contents(self, simulation):
        """All a simulation holds apart from its name."""
        row, result = self.stored(simulation), self.stored_result(simulation)
        return self.by_role(
            simulation,
            {
                "revision": row.revision,
                "fields": [row.fields[field_id] for field_id in row.field_order],
                "result": {key: result[key] for key in RESULT_COLUMNS},
                "view": self.view_data(simulation),
            },
        )

    def lock_by_hand(self, simulation, field_id, variant="2"):
        ref = RotationCandidateRef(saedskiftevariant="1", variant=variant, n_norm_pct="100")
        return apply_manual_rotation("farm", simulation.id, field_id, ref, [], EMAIL, 3)

    def add_registry_field(self, simulation, imk_id):
        self.registry_contexts = {imk_id: registry_row(imk_id)}
        request = CreateFieldRequest.model_validate(new_field(imk_id))
        repository.add_simulation_fields("farm", simulation.id, [request], EMAIL)
        self.registry_contexts = {}

    def calculated_source(self):
        source = self.create()
        self.optimize(source)
        return self.current(source)

    def edited_source(self):
        """Calculated, then one field removed, one added and one rotation set by hand."""
        source = self.calculated_source()
        _, second, third = self.fields_of(source)
        repository.remove_simulation_fields("farm", source.id, [third.id], EMAIL)
        self.add_registry_field(source, 7)
        self.lock_by_hand(source, second.id)
        self.optimize(self.current(source))
        return self.current(source)

    def test_copy_holds_what_the_source_holds_under_its_own_ids(self):
        source = self.edited_source()
        before = self.stored(source), self.stored_result(source)

        copy = self.copy(source, name="New (kopi)")

        self.assertEqual((self.stored(source), self.stored_result(source)), before)
        self.assertEqual(self.contents(copy), self.contents(source))
        self.assertEqual([f.imk_id for f in self.fields_of(copy)], [None, None, 7])
        self.assertEqual([len(f.allowed_rotation_ids) for f in self.fields_of(copy)], [0, 1, 0])
        held = json.dumps(
            [self.stored(copy).fields, self.stored_result(copy), self.view_data(copy)],
            default=str,
        )
        self.assertEqual([own for own in self.own_ids(source) if own in held], [])
        self.assertEqual(copy.result.status, "completed")
        self.assertEqual(copy.comparison_availability, source.comparison_availability)
        self.assertEqual(copy.comparison_availability["kind"], "ready")
        view = read_model_store.get_simulation_view("farm", copy.id, EMAIL)
        self.assertEqual(view["status"], "done")
        saved = view["data"]["saved_result"]
        self.assertEqual(
            [f["id"] for f in saved["response"]["fields"]], self.stored(copy).field_order
        )
        for original, copied in zip(self.fields_of(source), self.fields_of(copy), strict=True):
            self.assertEqual(
                self.by_role(
                    copy,
                    simulation_store.get_simulation_field_candidate_detail(
                        "farm", copy.id, copied.id, EMAIL
                    ).model_dump(mode="json"),
                ),
                self.by_role(
                    source,
                    simulation_store.get_simulation_field_candidate_detail(
                        "farm", source.id, original.id, EMAIL
                    ).model_dump(mode="json"),
                ),
            )

    def test_optimizing_the_copy_gives_what_optimizing_the_source_gives(self):
        source = self.edited_source()
        copy = self.copy(source)

        def chosen(result):
            return [
                (f.name, f.rotation_id, f.allowed_rotation_ids, f.db2, f.leaching)
                for f in result.response.fields
            ]

        self.assertEqual(chosen(self.optimize(copy)), chosen(self.optimize(source)))

    def test_edits_in_the_copy_show_over_the_copied_result(self):
        source = self.edited_source()
        copy = self.copy(source)
        before = self.contents(source)
        first, second, _ = self.fields_of(copy)

        repository.update_simulation_field(
            "farm", copy.id, first.id, UpdateFieldRequest(area_ha=first.area_ha * 2), EMAIL
        )
        repository.update_simulation_field(
            "farm", copy.id, second.id, UpdateFieldRequest(allowed_rotation_ids=[]), EMAIL
        )
        self.lock_by_hand(copy, second.id, variant="1")

        edited, relocked, _ = self.fields_of(copy)
        self.assertEqual((edited.area_ha, edited.db2), (first.area_ha * 2, first.db2 * 2))
        self.assertNotEqual(relocked.rotation_id, second.rotation_id)
        self.assertEqual(self.current(copy).result.status, "outdated")
        self.assertEqual(self.contents(source), before)

    def test_a_rotation_shown_in_the_copy_can_be_locked_there(self):
        copy = self.copy(self.edited_source())
        target = self.fields_of(copy)[0]
        self.assertEqual(target.allowed_rotation_ids, [])

        repository.update_simulation_field(
            "farm",
            copy.id,
            target.id,
            UpdateFieldRequest(allowed_rotation_ids=[target.rotation_id]),
            EMAIL,
        )

        kept = self.stored(copy).fields[target.id]["fixed_candidate"]
        self.assertEqual(
            RotationCandidateRef.model_validate(kept["ref"]).to_id(), target.rotation_id
        )

    def test_a_source_changed_since_its_run_gives_a_copy_that_is_outdated_too(self):
        source = self.calculated_source()
        self.add_registry_field(source, 7)
        source = self.current(source)
        self.assertEqual(source.result.status, "outdated")

        copy = self.copy(source)

        self.assertEqual(copy.result.status, "outdated")
        self.assertEqual(self.contents(copy), self.contents(source))
        calculated = [f.rotation_id is not None for f in self.fields_of(copy)]
        self.assertEqual(calculated, [True, True, True, False])

    def test_an_unfinished_latest_run_leaves_the_copy_the_earlier_result_as_outdated(self):
        for status in ("queued", "in_progress"):
            with self.subTest(status):
                source = self.calculated_source()
                response = self.stored_result(source)["output"]["response"]
                self.submit(source)
                if status == "in_progress":
                    with self.sessions.begin() as session:
                        session.execute(
                            update(results)
                            .where(results.c.simulation_id == source.id)
                            .values(status=status, lease_token="lease")
                        )
                source = self.current(source)
                self.assertEqual(source.result.status, status)

                copy = self.copy(source)

                result = self.stored_result(copy)
                self.assertEqual(
                    (result["status"], result["error"], result["lease_token"]),
                    ("outdated", None, None),
                )
                self.assertEqual(result["run_id"], result["output"]["run_id"])
                self.assertEqual(
                    self.by_role(copy, result["output"]["response"]),
                    self.by_role(source, response),
                )
                self.assertEqual(self.current(source).result.status, status)

    def test_a_failed_latest_run_leaves_the_copy_the_earlier_result_as_outdated(self):
        for status, error in (
            ("failed", ValueError("Fejlede.")),
            ("infeasible", OptimizationInfeasibleError("Ingen løsning.")),
        ):
            with self.subTest(status):
                source = self.calculated_source()
                response = self.stored_result(source)["output"]["response"]
                run = self.submit(source)
                with patch.object(worker, "run_optimization", side_effect=error):
                    worker.execute(source.id, run.run_id, CONTEXT)
                source = self.current(source)
                self.assertEqual(source.result.status, status)

                copy = self.copy(source)

                result = self.stored_result(copy)
                self.assertEqual((result["status"], result["error"]), ("outdated", None))
                self.assertEqual(
                    self.by_role(copy, result["output"]["response"]),
                    self.by_role(source, response),
                )
                self.assertEqual(len(self.fields_of(copy)), 3)
                self.optimize(copy)

    def test_settings_the_result_was_not_calculated_with_leave_it_outdated(self):
        source = self.edited_source()

        copy = self.copy(source, praecisionsjordbrug=True)

        self.assertEqual(copy.result.status, "outdated")
        self.assertEqual(
            self.contents(copy)["result"]["output"], self.contents(source)["result"]["output"]
        )

    def test_the_order_of_the_n_norm_levels_leaves_the_result_current(self):
        # The form keeps the levels in the order they were picked; a copy sends them sorted.
        source = self.create(n_norm_procenter=["100", "75", "85"])
        self.optimize(source)

        copy = self.copy(self.current(source), n_norm_procenter=["100", "85", "75"])

        self.assertEqual(copy.result.status, "completed")

    def test_completed_quota_value_curves_follow_the_result(self):
        source = self.edited_source()
        field_id = self.stored(source).field_order[0]
        output = {
            "base_db2": 1,
            "base_feed_units_by_year": {"2027": 1},
            "curve": {
                "kystvand_id": 1,
                "kvote_kg": 1,
                "unconstrained_trade_kg": 0,
                "points": [
                    {
                        "trade_kg": 0,
                        "status": "OPTIMAL",
                        "rotations": [
                            {
                                "field_id": field_id,
                                "base_ref": {
                                    "saedskiftevariant": "1",
                                    "variant": "1",
                                    "n_norm_pct": "100",
                                },
                            }
                        ],
                    }
                ],
            },
        }
        with self.sessions.begin() as session:
            for kystvand_id, status in ((1, "completed"), (2, "failed")):
                session.execute(
                    insert(quota_values).values(
                        simulation_id=source.id,
                        kystvand_id=kystvand_id,
                        status=status,
                        run_id=str(uuid4()),
                        base_run_id=self.stored_result(source)["run_id"],
                        requested_by=EMAIL,
                        parameters={"price_kr_per_kg": 10, "trade_range": None},
                        input_revision=source.revision,
                        output=output if status == "completed" else None,
                    )
                )

        copy = self.copy(source)

        [curve] = quota_value_store.get_quota_values("farm", copy.id, EMAIL)
        originals = quota_value_store.get_quota_values("farm", source.id, EMAIL)
        self.assertFalse(originals[0].outdated)
        self.assertFalse(curve.outdated)
        self.assertEqual(str(curve.base_run_id), self.stored_result(copy)["run_id"])
        self.assertNotIn(curve.run_id, [value.run_id for value in originals])
        [rotation] = curve.output.curve.points[0].rotations
        self.assertEqual(rotation.field_id, self.stored(copy).field_order[0])
        self.assertEqual(originals[0].output.curve.points[0].rotations[0].field_id, field_id)

    def test_the_copy_keeps_the_economics_its_figures_were_priced_with(self):
        source = self.calculated_source()
        # Priced with another profile than the one now selected, as before a recalculation.
        snapshot = EconomicsSnapshot(source_id="earlier", revision=4, name="Priced with")
        data = {**self.stored(source).data, "economics_snapshot": snapshot.model_dump(mode="json")}
        with self.sessions.begin() as session:
            session.execute(update(setups).where(setups.c.id == source.id).values(data=data))

        copy = self.copy(self.current(source))

        self.assertEqual(copy.economics_snapshot, snapshot)
        self.assertEqual(copy.economics_module_id, "standard")
        self.assertEqual(copy.result.status, "completed")

    def test_a_copy_of_a_copy_holds_the_same_again(self):
        first = self.copy(self.edited_source())

        second = self.copy(first)

        self.assertEqual(self.contents(second), self.contents(first))

    def test_a_source_without_fields_of_its_own_gives_a_copy_that_follows_the_farm(self):
        copy = self.copy(self.create())

        self.assertFalse(copy.fields_initialized)
        self.assertEqual(copy.result.status, "not_started")
        self.assertEqual(self.stored(copy).field_order, [])

    def test_repeating_the_request_does_not_copy_again(self):
        source = self.edited_source()
        request_id = uuid4()

        first = self.copy(source, request_id=request_id)
        held = self.stored(first), self.stored_result(first)
        second = self.copy(source, request_id=request_id)

        self.assertEqual(second.id, first.id)
        self.assertEqual((self.stored(second), self.stored_result(second)), held)

    def test_only_a_simulation_of_the_same_farm_can_be_copied(self):
        source = self.calculated_source()
        with self.sessions.begin() as session:
            session.execute(
                insert(farm_table).values(
                    id="other", data={"id": "other", "name": "O", "owner_name": "O"}
                )
            )
            session.execute(insert(farm_member_table).values(farm_id="other", email=EMAIL))
            before = set(session.execute(select(results.c.simulation_id)).scalars())

        for farm_id, source_id in (("farm", "missing"), ("other", source.id)):
            with self.assertRaises(CreationConflictError):
                self.create(farm_id, copy_from=source_id)

        with self.sessions() as session:
            after = set(session.execute(select(results.c.simulation_id)).scalars())
        self.assertEqual(after, before)
