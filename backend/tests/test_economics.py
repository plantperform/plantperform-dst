"""Economics calculations, access and explicit job lifecycle in disposable schemas."""

import importlib.util
import unittest
from datetime import UTC, datetime
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch
from uuid import uuid4

from alembic.migration import MigrationContext
from alembic.operations import Operations
from fastapi import FastAPI
from fastapi.testclient import TestClient
from legacy_candidates import caches
from pydantic import ValidationError
from sqlalchemy import insert, select, update
from test_optimizer_lifecycle import CONTEXT, EMAIL, DatabaseTests

from app import main
from app.api.v0 import economics as api
from app.auth import AuthenticatedUser, current_user
from app.data import economics_recalculation_store as recalc_store
from app.data import economics_store, read_model_store, repository
from app.data.db import (
    afgroede_norm_lookup_table,
    afgroede_table,
    app_user_table,
    arbejdsmaengde_table,
    arbejdssats_table,
    dyrkningsomkostning_table,
    economics_module_member_table,
    economics_module_table,
    farm_member_table,
    halmudbytte_table,
    metadata,
    prisliste_table,
    salgspris_table,
)
from app.data.db import (
    simulation_table as setups,
)
from app.domain.economics import (
    CreateEconomicsModuleRequest,
    EconomicsConflictError,
    EconomicsModuleNotFoundError,
    EconomicsOverrides,
    RecalculateEconomicsRequest,
    SelectEconomicsRequest,
    UpdateEconomicsModuleRequest,
)
from app.domain.simulation import CreateSimulationRequest
from app.services.calculation import CalculationFailedError
from app.services.economics import budget, jobs, overrides
from app.services.economics import db_calculator as calculator
from app.services.economics import runner as economics_worker
from plantperform_fargate import worker as optimizer_worker

OTHER = "other@example.com"
SALE = overrides.identifier("sale", 1, "Konventionel", "")
STRAW = overrides.identifier("straw", 1, "Konventionel", "")
RATE = overrides.identifier("rate", "Pløjning", "JB5-6", None, "")
WORK = overrides.quantity_id(1, "work", "Konventionel", "JB5-6", "", "Markarbejde", "Pløjning")


class EconomicsValidationTests(unittest.TestCase):
    def test_numeric_constraints(self):
        for value in (-1, float("nan"), float("inf"), "10", True):
            with self.subTest(value=value), self.assertRaises(ValidationError):
                EconomicsOverrides(prices={SALE: value})
            with self.subTest(value=value), self.assertRaises(ValidationError):
                EconomicsOverrides(quantities={WORK: value})
        for value in (-100, -101, float("inf"), float("nan"), True):
            with self.subTest(value=value), self.assertRaises(ValidationError):
                EconomicsOverrides(yieldPct={"1": value})
        self.assertEqual(EconomicsOverrides(prices={SALE: 0}).prices[SALE], 0)
        self.assertEqual(EconomicsOverrides(yieldPct={"1": -99}).yield_pct["1"], -99)

    def test_empty_and_order_independent_cache_keys(self):
        self.assertEqual(EconomicsOverrides().cache_key(), "")
        left = EconomicsOverrides(prices={"b": 2, "a": 1})
        right = EconomicsOverrides(prices={"a": 1, "b": 2})
        self.assertEqual(left.cache_key(), right.cache_key())
        self.assertNotEqual(left.cache_key(), EconomicsOverrides(prices={"a": 2}).cache_key())

    def test_blank_and_null_names(self):
        for name in ("", " ", None):
            with self.assertRaises(ValidationError):
                CreateEconomicsModuleRequest(name=name)
            with self.assertRaises(ValidationError):
                UpdateEconomicsModuleRequest(expectedRevision=0, name=name)
        self.assertEqual(CreateEconomicsModuleRequest(name=" Mine ").name, "Mine")


class EconomicsDatabaseTests(DatabaseTests):
    def setUp(self):
        super().setUp()
        tables = [
            economics_module_table,
            economics_module_member_table,
            afgroede_table,
            afgroede_norm_lookup_table,
            salgspris_table,
            halmudbytte_table,
            arbejdssats_table,
            arbejdsmaengde_table,
            dyrkningsomkostning_table,
            prisliste_table,
        ]
        metadata.create_all(self.engine, tables=tables)
        self.enterContext(patch.object(calculator, "SessionLocal", self.sessions))
        self.enterContext(patch.object(overrides, "SessionLocal", self.sessions))
        self.enterContext(patch.object(budget, "SessionLocal", self.sessions))
        calculator.clear_lookup_cache()
        self.addCleanup(calculator.clear_lookup_cache)
        with self.sessions.begin() as session:
            session.execute(update(app_user_table).values(verified_at=datetime.now(UTC)))
            session.execute(
                insert(app_user_table).values(
                    email=OTHER, password_hash="test", verified_at=datetime.now(UTC)
                )
            )
            for index, (code, unit) in enumerate(((1, "hkg"), (11, "hkg"), (216, "FE/ha")), 1):
                session.execute(
                    insert(afgroede_table).values(
                        afgroedekode=code, navn=str(code), udbytteenhed=unit
                    )
                )
                session.execute(
                    insert(afgroede_norm_lookup_table).values(
                        source_order=index,
                        jb_nr=5,
                        afgroedekode=code,
                        jb_gruppe="JB5-6",
                        vanding="Uvandet",
                        udbyttenorm=60,
                        n_norm=175,
                        driftsform="Konventionel",
                    )
                )
                session.execute(
                    insert(salgspris_table).values(
                        source_order=index,
                        afgroedekode=code,
                        driftsform="Konventionel",
                        kvalitet="",
                        salgspris=100,
                        enhed="kr/hkg",
                        halm_pris_kr_kg=0.5,
                    )
                )
                session.execute(
                    insert(halmudbytte_table).values(
                        source_order=index,
                        afgroedekode=code,
                        jordbonitet="JB5-6",
                        halm_udbytte_kg_ha=1000,
                    )
                )
                session.execute(
                    insert(arbejdsmaengde_table).values(
                        source_order=index,
                        afgroedekode=code,
                        driftsform="Konventionel",
                        jordbonitet="JB5-6",
                        kvalitet="",
                        kategori="Markarbejde",
                        behandling="Pløjning",
                        antal=2,
                    )
                )
            session.execute(
                insert(salgspris_table).values(
                    source_order=4,
                    afgroedekode=1,
                    driftsform="Økologisk",
                    kvalitet="",
                    salgspris=200,
                    enhed="kr/hkg",
                    halm_pris_kr_kg=0.5,
                )
            )
            session.execute(
                insert(arbejdssats_table).values(
                    source_order=1,
                    behandling="Pløjning",
                    jordbonitet="JB5-6",
                    afgroedekode=None,
                    driftsform="",
                    pris_kr_per_enhed=100,
                    enhed="kr/gang",
                    kilde="SEGES",
                )
            )
            session.execute(
                insert(dyrkningsomkostning_table).values(
                    source_order=1,
                    afgroedekode=11,
                    driftsform="Konventionel",
                    kategori="Udsæd",
                    behandling="Udsæd",
                    udgift_kr_ha=100,
                )
            )
            for index, (post, price) in enumerate(
                (
                    ("Handelsgødning, kvælstof (N)", 10),
                    ("Handelsgødning, udbringning", 100),
                    ("Grundbetaling (estimat)", 1000),
                    ("Grundbeløb (basis)", 500),
                    ("Stivelseskartofler", 200),
                ),
                1,
            ):
                session.execute(
                    insert(prisliste_table).values(
                        source_order=index,
                        post=post,
                        kategori="Gødning",
                        type="Omkostning",
                        pris=price,
                        enhed="kr/enhed",
                    )
                )
        app = FastAPI()
        app.include_router(api.router, prefix="/api/v0")
        app.dependency_overrides[current_user] = lambda: AuthenticatedUser(email=EMAIL)
        self.client = TestClient(app)

    def module(self, **values):
        return economics_store.create_module(
            CreateEconomicsModuleRequest(name="Mine", overrides=EconomicsOverrides(**values)), EMAIL
        )

    def select_module(self, module, revision=0):
        return recalc_store.select_module(
            "farm",
            "sim",
            SelectEconomicsRequest(expectedRevision=revision, economicsModuleId=module.id),
            EMAIL,
        )

    def submit_recalculation(self, revision, **values):
        request = RecalculateEconomicsRequest(
            expectedRevision=revision, requestId=uuid4(), **values
        )
        _, job = recalc_store.submit("farm", "sim", request, EMAIL)
        simulation = repository.get_simulation("farm", "sim", EMAIL)
        envelope = job.envelope()
        return simulation, request, envelope

    def test_http_recalculation_returns_completed_values_and_never_queues(self):
        self.install_calculation_inputs()
        run = self.submit()
        optimizer_worker.execute("sim", run.run_id, CONTEXT)
        selected = self.select_module(self.module(prices={SALE: 150}))
        request = RecalculateEconomicsRequest(expectedRevision=selected.revision, requestId=uuid4())
        self.queue.reset_mock()
        with patch.dict(
            main.app.dependency_overrides, {current_user: lambda: AuthenticatedUser(email=EMAIL)}
        ):
            client = TestClient(main.app)
            response = client.post(
                "/api/v0/farms/farm/simulations/sim/economics/recalculate",
                json=request.model_dump(mode="json", by_alias=True),
            )
            repeated = client.post(
                "/api/v0/farms/farm/simulations/sim/economics/recalculate",
                json=request.model_dump(mode="json", by_alias=True),
            )
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(response.json()["creationStatus"], "done")
        self.assertEqual(response.json()["economicsSnapshot"]["overrides"]["prices"][SALE], 150)
        self.assertEqual(repeated.json(), response.json())
        self.queue.send_message.assert_not_called()

    def test_http_timeout_is_persisted_and_explicit_retry_completes(self):
        request = RecalculateEconomicsRequest(expectedRevision=0, requestId=uuid4())
        expired = SimpleNamespace(get_remaining_time_in_millis=lambda: 0)
        with patch.dict(
            main.app.dependency_overrides, {current_user: lambda: AuthenticatedUser(email=EMAIL)}
        ):
            client = TestClient(main.app)
            with patch.object(jobs, "CalculationContext", return_value=expired):
                response = client.post(
                    "/api/v0/farms/farm/simulations/sim/economics/recalculate",
                    json=request.model_dump(mode="json", by_alias=True),
                )
            self.assertEqual(response.status_code, 504)
            failed = repository.get_simulation("farm", "sim", EMAIL)
            self.assertEqual(failed.creation_status, "failed")
            self.assertTrue(failed.economics_recalculation_failed)
            retried = client.post("/api/v0/farms/farm/simulations/sim/economics/recalculate/retry")
        self.assertEqual(retried.status_code, 200, retried.text)
        self.assertEqual(retried.json()["creationStatus"], "done")
        self.assertFalse(retried.json()["economicsRecalculationFailed"])
        self.queue.send_message.assert_not_called()

    def install_calculation_inputs(self):
        with self.sessions.begin() as session:
            rows = session.execute(select(caches)).all()
            for row in rows:
                data = row.data
                for candidate in data["candidates"]:
                    for year in candidate["years"]:
                        year["db_detail"] = calculator.calculate_db(1, "Konventionel", 5, mncs=175)
                        year["db_kr_ha"] = year["db_detail"]["db"]
                    candidate["avg_db_kr_ha"] = year["db_kr_ha"]
                from app.data.optimizer_inputs import optimizer_input
                from app.domain.rotation_candidate import SimulationFieldCandidates

                session.execute(
                    update(caches)
                    .where(caches.c.id == row.id)
                    .values(
                        data=data,
                        optimizer_input=optimizer_input(
                            SimulationFieldCandidates.model_validate(data)
                        ),
                    )
                )

    def test_crud_duplicate_and_membership(self):
        module = self.module(prices={SALE: 150})
        self.assertEqual(economics_store.list_modules(OTHER)[0].id, "standard")
        with self.assertRaises(EconomicsModuleNotFoundError):
            economics_store.get_module(module.id, OTHER)
        self.assertEqual(economics_store.add_member(module.id, EMAIL, OTHER), "added")
        updated = economics_store.update_module(
            module.id, UpdateEconomicsModuleRequest(expectedRevision=0, name="Renamed"), OTHER
        )
        self.assertEqual(updated.revision, 1)
        self.assertEqual(updated.overrides.prices[SALE], 150)
        copied = economics_store.duplicate_module(module.id, OTHER)
        self.assertNotEqual(copied.id, module.id)
        self.assertEqual(economics_store.list_members(copied.id, OTHER), [OTHER])
        self.assertEqual(economics_store.remove_member(module.id, OTHER, EMAIL), "removed")
        self.assertEqual(economics_store.remove_member(module.id, OTHER, OTHER), "last_member")
        economics_store.delete_module(module.id, OTHER)
        self.assertEqual(economics_store.get_module(copied.id, OTHER).overrides.prices[SALE], 150)

    def test_members_require_verified_users_and_normalize_email(self):
        module = self.module()
        self.assertEqual(
            economics_store.add_member(module.id, EMAIL, "missing@example.com"), "user_not_found"
        )
        response = self.client.post(
            f"/api/v0/economics-modules/{module.id}/members", json={"email": " OTHER@example.com "}
        )
        self.assertEqual(response.status_code, 201, response.text)
        self.assertEqual(response.json()["email"], OTHER)
        self.assertEqual(
            self.client.post(
                f"/api/v0/economics-modules/{module.id}/members", json={"email": OTHER}
            ).status_code,
            409,
        )

    def test_api_standard_immutable_and_copyable(self):
        self.assertEqual(
            self.client.patch(
                "/api/v0/economics-modules/standard",
                json={"expectedRevision": 0, "name": "Changed"},
            ).status_code,
            422,
        )
        self.assertEqual(self.client.delete("/api/v0/economics-modules/standard").status_code, 422)
        response = self.client.post("/api/v0/economics-modules/standard/duplicate")
        self.assertEqual(response.status_code, 201, response.text)
        self.assertEqual(
            response.json()["overrides"], {"prices": {}, "quantities": {}, "yieldPct": {}}
        )

    def test_unknown_identifiers_and_revision_conflicts(self):
        for values in (
            dict(prices={"bad": 1}),
            dict(quantities={"bad": 1}),
            dict(yieldPct={"999999": 1}),
        ):
            with self.subTest(values=values), self.assertRaises(ValueError):
                self.module(**values)
        module = self.module()
        with self.assertRaises(EconomicsConflictError):
            economics_store.update_module(
                module.id, UpdateEconomicsModuleRequest(expectedRevision=99, name="Changed"), EMAIL
            )
        self.assertEqual(
            self.client.patch(
                f"/api/v0/economics-modules/{module.id}",
                json={"expectedRevision": 0, "overrides": None},
            ).status_code,
            422,
        )

    def test_price_variants_shared_rates_quantities_and_zero(self):
        base = calculator.calculate_db(1, "Konventionel", 5, mncs=175)
        changed = calculator.calculate_db(
            1,
            "Konventionel",
            5,
            mncs=175,
            economics_key=EconomicsOverrides(
                prices={SALE: 150, RATE: 200}, quantities={WORK: 3}
            ).cache_key(),
        )
        self.assertEqual(changed["salgspris"], 150)
        self.assertEqual(changed["markarbejde"], 600)
        organic = calculator.calculate_db(
            1,
            "Økologisk",
            5,
            mncs=175,
            economics_key=EconomicsOverrides(prices={SALE: 150}).cache_key(),
        )
        self.assertEqual(organic["salgspris"], 200)
        zero = calculator.calculate_db(
            1,
            "Konventionel",
            5,
            mncs=175,
            economics_key=EconomicsOverrides(
                prices={SALE: 0, STRAW: 0}, quantities={WORK: 0}
            ).cache_key(),
        )
        self.assertEqual(zero["indtaegt"], 0)
        self.assertEqual(zero["markarbejde"], 0)
        self.assertEqual(
            base,
            calculator.calculate_db(
                1, "Konventionel", 5, mncs=175, economics_key=EconomicsOverrides().cache_key()
            ),
        )

    def test_yield_fen_and_physical_allocations(self):
        base = calculator.calculate_db(216, "Konventionel", 5, mncs=175)
        modified = calculator.calculate_db(
            216,
            "Konventionel",
            5,
            mncs=175,
            economics_key=EconomicsOverrides(yieldPct={"216": 20}).cache_key(),
        )
        self.assertEqual(modified["udbytte"], base["udbytte"] * 1.2)
        self.assertEqual(modified["mncs"], base["mncs"])
        self.assertEqual(modified["halm_indtaegt"], base["halm_indtaegt"] * 1.2)
        self.assertEqual(modified["goedning"], base["goedning"])

    def test_catalog_stable_identifiers_and_context(self):
        catalog = overrides.assumptions()
        self.assertIn(SALE, {p["id"] for p in catalog["prices"]})
        self.assertIn(WORK, {q["id"] for q in catalog["quantities"]})
        with self.sessions.begin() as session:
            session.execute(
                update(salgspris_table).values(source_order=salgspris_table.c.source_order + 10)
            )
        self.assertEqual(overrides.assumptions(), catalog)

    def test_farm_budgets_price_out_to_the_calculated_db(self):
        fields = [
            SimpleNamespace(
                jbnr=5,
                area_ha=10,
                crop_rotation=[SimpleNamespace(afgrode_kode=1), SimpleNamespace(afgrode_kode=11)],
            ),
            SimpleNamespace(jbnr=3, area_ha=8, crop_rotation=[SimpleNamespace(afgrode_kode=999)]),
        ]
        godning = SimpleNamespace(driftsform="Konventionel", only_organic=False, org_mineral_n=50)
        simulation = SimpleNamespace(id="sim", godning=godning)
        url = "/api/v0/farms/farm/economics/budgets"
        with (
            patch.object(budget, "list_fields", return_value=fields),
            patch.object(budget, "list_simulations", return_value=[simulation]),
            patch.object(budget, "scenario_afgrodekoder", return_value={216, 11}),
        ):
            budgets = self.client.get(url).json()
            manured = self.client.get(url, params={"simulationId": "sim"}).json()
            organic = self.client.get(url, params={"farmingSystem": "Økologisk"}).json()
            self.assertEqual(self.client.get(url, params={"simulationId": "x"}).status_code, 404)
        self.assertEqual(budgets["jbNr"], 5)
        self.assertEqual([crop["cropCode"] for crop in budgets["crops"]], [1, 11, 216])
        mineral_n = overrides.quantity_id(1, "fertiliser", "mineralN")
        self.assertEqual(
            [
                line["quantity"]
                for line in manured["crops"][0]["costs"]
                if line["quantityId"] == mineral_n
            ],
            [125],
        )
        defaults = {price["id"]: price["value"] for price in budgets["prices"]}
        plowing = next(line for line in budgets["crops"][0]["costs"] if line["quantityId"] == WORK)
        self.assertEqual(
            (plowing["quantity"], plowing["quantityUnit"], plowing["priceId"]),
            (2, "gange", RATE),
        )
        self.assertEqual(
            next(price for price in budgets["prices"] if price["id"] == RATE)["source"], "SEGES"
        )

        def priced_db(crop, changes):
            yield_factor = 1 + changes.yield_pct.get(str(crop["cropCode"]), 0) / 100
            total = 0.0
            for section, sign in (("revenue", 1), ("subsidies", 1), ("costs", -1)):
                for line in crop[section]:
                    quantity = changes.quantities.get(line["quantityId"], line["quantity"])
                    if line["followsYield"]:
                        quantity *= yield_factor
                    price = changes.prices.get(line["priceId"], defaults[line["priceId"]])
                    total += sign * quantity * price
            return round(total)

        for changes in (
            EconomicsOverrides(),
            EconomicsOverrides(prices={SALE: 150, RATE: 200}, quantities={WORK: 3}),
            EconomicsOverrides(yieldPct={"1": 10, "11": -20}),
        ):
            for crop in budgets["crops"]:
                with self.subTest(crop=crop["cropCode"], changes=changes):
                    self.assertEqual(
                        priced_db(crop, changes),
                        calculator.calculate_db(
                            crop["cropCode"], "Konventionel", 5, economics_key=changes.cache_key()
                        )["db"],
                    )
        defaults.update({price["id"]: price["value"] for price in manured["prices"]})
        self.assertEqual(
            priced_db(manured["crops"][0], EconomicsOverrides()),
            calculator.calculate_db(1, "Konventionel", 5, org_mineral_n_applied=50)["db"],
        )
        self.assertNotIn(mineral_n, [line["quantityId"] for line in organic["crops"][0]["costs"]])
        defaults.update({price["id"]: price["value"] for price in organic["prices"]})
        self.assertEqual(
            priced_db(organic["crops"][0], EconomicsOverrides()),
            calculator.calculate_db(1, "Økologisk", 5, only_organic=True)["db"],
        )

    def test_farm_budgets_require_membership_and_a_soil_type(self):
        self.assertIsNone(budget.farm_budgets("farm", OTHER, "Konventionel"))
        self.assertEqual(
            budget.farm_budgets("farm", EMAIL, "Økologisk"),
            dict(jbNr=None, farmingSystem="Økologisk", prices=[], crops=[], soilVariants={}),
        )

    def test_crop_budgets_name_each_work_rate_and_quantity_on_every_soil_group(self):
        sand_rate = overrides.identifier("rate", "Pløjning", "JB1-3", None, "")
        sand_work = overrides.quantity_id(
            1, "work", "Konventionel", "JB1-3", "", "Markarbejde", "Pløjning"
        )
        with self.sessions.begin() as session:
            session.execute(
                insert(arbejdssats_table).values(
                    source_order=2,
                    behandling="Pløjning",
                    jordbonitet="JB1-3",
                    afgroedekode=None,
                    driftsform="",
                    pris_kr_per_enhed=80,
                    enhed="kr/gang",
                )
            )
            session.execute(
                insert(arbejdsmaengde_table).values(
                    source_order=4,
                    afgroedekode=1,
                    driftsform="Konventionel",
                    jordbonitet="JB1-3",
                    kvalitet="",
                    kategori="Markarbejde",
                    behandling="Pløjning",
                    antal=3,
                )
            )
        rates = [dict(id=sand_rate, value=80), dict(id=RATE, value=100)]
        variants = budget.crop_budgets([1, 11], 5, "Konventionel", False)["soilVariants"]
        self.assertEqual(variants[RATE], rates)
        self.assertEqual(variants[WORK], [dict(id=sand_work, value=3), dict(id=WORK, value=2)])
        self.assertNotIn(SALE, variants)
        self.assertNotIn(sand_rate, variants)
        work_11 = overrides.quantity_id(
            11, "work", "Konventionel", "JB5-6", "", "Markarbejde", "Pløjning"
        )
        self.assertNotIn(work_11, variants)
        self.assertEqual(
            budget.crop_budgets([1], 3, "Konventionel", False)["soilVariants"][sand_rate],
            rates,
        )

    def test_module_edits_and_selection_never_dispatch(self):
        module = self.module(prices={SALE: 150})
        selected = self.select_module(module)
        self.assertEqual(selected.revision, 1)
        self.assertEqual(selected.economics_snapshot.source_id, "standard")
        economics_store.update_module(
            module.id,
            UpdateEconomicsModuleRequest(expectedRevision=0, prices=None, name="Changed"),
            EMAIL,
        )
        from app.data.read_model_store import get_simulation_view

        view = get_simulation_view("farm", "sim", EMAIL)
        self.assertEqual(view["status"], "done")
        self.assertIsNotNone(view["data"])
        self.queue.send_message.assert_not_called()

    def test_creation_and_optimization_keep_captured_economics_snapshot(self):
        from app.data.simulation_settings_store import create
        from app.domain.optimization import OptimizeSimulationRequest
        from app.services.optimization import jobs as optimization_jobs

        module = self.module(prices={SALE: 150})
        created = create(
            "farm", CreateSimulationRequest(name="frozen", economics_module_id=module.id), EMAIL
        )
        economics_store.update_module(
            module.id,
            UpdateEconomicsModuleRequest(expected_revision=0, overrides={"prices": {SALE: 200}}),
            EMAIL,
        )
        self.assertEqual(created.economics_snapshot.overrides.prices[SALE], 150)
        accepted = optimization_jobs.submit(
            "farm",
            created.id,
            EMAIL,
            "optimize",
            OptimizeSimulationRequest(expected_revision=0, run_id=uuid4()),
        )
        with self.sessions() as session:
            from app.data.db import simulation_result_table

            parameters = session.execute(
                select(simulation_result_table.c.parameters).where(
                    simulation_result_table.c.run_id == accepted.run_id
                )
            ).scalar_one()
        self.assertEqual(
            parameters["simulation_settings"]["economics_snapshot"]["overrides"]["prices"][SALE],
            150,
        )

    def test_manual_recalculation_preserves_choices_and_freezes_inputs(self):
        self.install_calculation_inputs()
        run = self.submit()
        optimizer_worker.execute("sim", run.run_id, CONTEXT)
        before = repository.list_simulation_fields("farm", "sim", EMAIL)
        module = self.module(prices={SALE: 150})
        selected = self.select_module(module)
        queued, request, envelope = self.submit_recalculation(selected.revision)
        repeated = jobs.submit("farm", "sim", request, EMAIL)
        self.assertEqual(repeated.revision, queued.revision)
        self.assertEqual(self.queue.send_message.call_count, 1)  # optimization only
        economics_store.update_module(
            module.id,
            UpdateEconomicsModuleRequest(
                expectedRevision=0, overrides=EconomicsOverrides(prices={SALE: 200})
            ),
            EMAIL,
        )
        economics_worker.execute(envelope, CONTEXT)
        result = repository.get_simulation("farm", "sim", EMAIL)
        self.assertEqual(result.creation_status, "done")
        self.assertEqual(result.result.status, "outdated")
        self.assertEqual(result.economics_snapshot.overrides.prices[SALE], 150)
        self.assertEqual(self.result().economics_snapshot.source_id, "standard")
        after = repository.list_simulation_fields("farm", "sim", EMAIL)
        for old, new in zip(before, after, strict=True):
            self.assertEqual(old.id, new.id)
            self.assertEqual(old.rotation_id, new.rotation_id)
            self.assertEqual(old.leaching, new.leaching)
            self.assertGreater(new.db2, old.db2)
            detail = repository.get_simulation_field_candidate_detail("farm", "sim", new.id, EMAIL)
            self.assertEqual(detail.years[0].db_detail["salgspris"], 150)
        economics_worker.execute(envelope, CONTEXT)  # duplicate delivery is a no-op
        self.assertEqual(repository.get_simulation("farm", "sim", EMAIL).revision, result.revision)
        run = self.submit(self.request(revision=result.revision))
        optimizer_worker.execute("sim", run.run_id, CONTEXT)
        self.assertEqual(self.result().status, "completed")

    def test_failed_retry_keeps_captured_snapshot_after_module_deletion(self):
        self.install_calculation_inputs()
        module = self.module(prices={SALE: 150})
        selected = self.select_module(module)
        queued, _, envelope = self.submit_recalculation(selected.revision)
        with patch.object(economics_worker, "_execute", side_effect=ValueError("failed")):
            with self.assertRaises(CalculationFailedError):
                economics_worker.execute(envelope, CONTEXT)
            economics_worker.execute(envelope, CONTEXT)
        economics_store.delete_module(module.id, EMAIL)
        retried = jobs.retry("farm", "sim", EMAIL)
        self.assertGreater(retried.revision, queued.revision)
        economics_worker.execute(envelope, CONTEXT)  # stale delivery cannot publish
        simulation = repository.get_simulation("farm", "sim", EMAIL)
        self.assertEqual(simulation.creation_status, "done")
        self.assertEqual(simulation.economics_snapshot.source_id, module.id)

    def test_farm_members_can_use_snapshot_without_original_module(self):
        module = self.module(prices={SALE: 150})
        selected = self.select_module(module)
        _, _, envelope = self.submit_recalculation(selected.revision)
        economics_worker.execute(envelope, CONTEXT)
        with self.sessions.begin() as session:
            session.execute(insert(farm_member_table).values(farm_id="farm", email=OTHER))
        simulation = repository.get_simulation("farm", "sim", OTHER)
        self.assertEqual(simulation.economics_snapshot.overrides.prices[SALE], 150)
        request = RecalculateEconomicsRequest(
            expectedRevision=simulation.revision, requestId=uuid4(), refreshFromModule=False
        )
        jobs.submit("farm", "sim", request, OTHER)
        request = RecalculateEconomicsRequest(
            expectedRevision=repository.get_simulation("farm", "sim", OTHER).revision,
            requestId=uuid4(),
        )
        with self.assertRaises(EconomicsModuleNotFoundError):
            jobs.submit("farm", "sim", request, OTHER)

    def test_duplicate_reservations_before_publication_dispatch_once(self):
        module = self.module()
        selected = self.select_module(module)
        request = RecalculateEconomicsRequest(expectedRevision=selected.revision, requestId=uuid4())
        first, job = recalc_store.submit("farm", "sim", request, EMAIL)
        repeated, other_job = recalc_store.submit("farm", "sim", request, EMAIL)
        self.assertEqual(first, repeated)
        self.assertIsNotNone(job)
        self.assertIsNone(other_job)

    def test_partial_attempt_hidden_and_retry_does_not_compound_yield(self):
        self.install_calculation_inputs()
        optimization = self.submit()
        optimizer_worker.execute("sim", optimization.run_id, CONTEXT)
        module = self.module(yieldPct={"1": 20})
        selected = self.select_module(module)
        _, _, envelope = self.submit_recalculation(selected.revision)
        original = economics_worker.recalculate_candidate
        calls = 0

        def fail_after_first_field(*args):
            nonlocal calls
            calls += 1
            if calls == 2:
                raise RuntimeError("partial failure")
            return original(*args)

        with patch.object(
            economics_worker, "recalculate_candidate", side_effect=fail_after_first_field
        ):
            with self.assertRaises(CalculationFailedError):
                economics_worker.execute(envelope, CONTEXT)
        view = read_model_store.get_simulation_view("farm", "sim", EMAIL)
        self.assertIsNone(view["data"])
        jobs.retry("farm", "sim", EMAIL)
        with self.sessions() as session:
            rows = session.execute(select(caches.c.data)).scalars().all()
        for row in rows:
            for candidate in row["candidates"]:
                self.assertEqual(candidate["years"][0]["db_detail"]["udbytte"], 60)

    def test_cached_baseline_and_locked_fields_recalculate_fen(self):
        from app.domain.rotation_candidate import RotationCandidateEvaluation

        with self.sessions.begin() as session:
            row = session.execute(select(setups).where(setups.c.id == "sim")).one()
            fields = row.fields
            for index, (field_id, setup) in enumerate(fields.items()):
                raw = session.execute(
                    select(caches.c.data).where(caches.c.field_id == field_id)
                ).scalar_one()
                candidate = raw["candidates"][0]
                for year in candidate["years"]:
                    year["year"]["afgrode_kode"] = 216
                    year["db_detail"] = calculator.calculate_db(216, "Konventionel", 5, mncs=175)
                    year["db_kr_ha"] = year["db_detail"]["db"]
                candidate["avg_db_kr_ha"] = candidate["years"][0]["db_kr_ha"]
                candidate["avg_fen"] = 60
                if index == 0:
                    setup["baseline_candidate"] = candidate
                else:
                    full = RotationCandidateEvaluation.model_validate(candidate)
                    setup["allowed_rotation_ids"] = [full.ref.to_id()]
                    setup["fixed_candidate"] = candidate
                    setup["fixed"] = dict(
                        rotation_id=full.ref.to_id(),
                        crop_rotation=[y.year.model_dump(mode="json") for y in full.years],
                        db2=full.avg_db_kr_ha * 2,
                        fen=120,
                        n_load=10,
                        leaching=20,
                    )
            session.execute(update(setups).where(setups.c.id == "sim").values(fields=fields))
        module = self.module(yieldPct={"216": 20})
        selected = self.select_module(module)
        _, _, envelope = self.submit_recalculation(selected.revision)
        economics_worker.execute(envelope, CONTEXT)
        for field in repository.list_simulation_fields("farm", "sim", EMAIL):
            self.assertEqual(field.fen, 144)
        self.assertEqual(repository.get_simulation("farm", "sim", EMAIL).creation_status, "done")

    def test_failed_recalculation_can_be_replaced_with_new_explicit_inputs(self):
        self.install_calculation_inputs()
        module = self.module(prices={SALE: 150})
        selected = self.select_module(module)
        queued, _, envelope = self.submit_recalculation(selected.revision)
        with patch.object(economics_worker, "_execute", side_effect=ValueError("bad inputs")):
            with self.assertRaises(CalculationFailedError):
                economics_worker.execute(envelope, CONTEXT)
        economics_store.update_module(
            module.id,
            UpdateEconomicsModuleRequest(
                expectedRevision=0, overrides=EconomicsOverrides(prices={SALE: 200})
            ),
            EMAIL,
        )
        count = self.queue.send_message.call_count
        standard = recalc_store.select_module(
            "farm",
            "sim",
            SelectEconomicsRequest(expectedRevision=queued.revision, economicsModuleId="standard"),
            EMAIL,
        )
        self.assertEqual(self.queue.send_message.call_count, count)
        _, _, replacement = self.submit_recalculation(standard.revision)
        economics_worker.execute(replacement, CONTEXT)
        self.assertEqual(repository.get_simulation("farm", "sim", EMAIL).creation_status, "done")
        self.assertEqual(
            repository.get_simulation("farm", "sim", EMAIL).economics_snapshot.source_id, "standard"
        )

    def test_economic_fertilizer_quantity_does_not_change_zero_physical_allocation(self):
        key = overrides.quantity_id(1, "fertiliser", "mineralN")
        result = calculator.calculate_db(
            1,
            "Konventionel",
            5,
            mncs=0,
            only_organic=True,
            economics_key=EconomicsOverrides(quantities={key: 10}).cache_key(),
        )
        self.assertEqual(result["goedning"], 100)
        self.assertEqual(result["mncs"], 0)

    def test_migration_round_trip(self):
        with self.engine.begin() as connection:
            connection.execute(economics_module_member_table.delete())
            connection.execute(economics_module_table.delete())
            economics_module_member_table.drop(connection)
            economics_module_table.drop(connection)
            path = (
                Path(__file__).parents[1]
                / "database/migrations/versions/20261013_0001_economics_modules.py"
            )
            spec = importlib.util.spec_from_file_location("economics_migration", path)
            module = importlib.util.module_from_spec(spec)
            spec.loader.exec_module(module)
            with Operations.context(MigrationContext.configure(connection)):
                module.upgrade()
                module.downgrade()
                module.upgrade()
        self.assertEqual(self.module().revision, 0)

    def test_units_and_sources_migration_round_trip(self):
        path = (
            Path(__file__).parents[1]
            / "database/migrations/versions/20261015_0001_economics_units_and_sources.py"
        )
        spec = importlib.util.spec_from_file_location("units_migration", path)
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        with self.engine.begin() as connection:
            with Operations.context(MigrationContext.configure(connection)) as operations:
                for table, column in module.COLUMNS:
                    operations.drop_column(table, column)
                module.upgrade()
                module.downgrade()
                module.upgrade()
        rate = next(price for price in overrides.assumptions()["prices"] if price["id"] == RATE)
        self.assertEqual((rate["unit"], rate["source"]), ("kr/enhed", None))
