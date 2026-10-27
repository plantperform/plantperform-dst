from types import SimpleNamespace
from unittest.mock import patch

from fastapi.testclient import TestClient
from sqlalchemy import select, update
from test_optimizer_lifecycle import EMAIL, DatabaseTests, field
from test_read_models import rich_candidate

from app import main
from app.auth import AuthenticatedUser, current_user
from app.data import repository
from app.data.db import farm_table, field_table
from app.data.db import simulation_result_table as results
from app.data.db import simulation_table as setups
from app.domain.read_model import SimulationView

SIMULATION = "/api/v0/farms/farm/simulations/sim"
FIELDS = f"{SIMULATION}/fields"
MISSING_IMK_ID = 404


def registry_row(imk_id):
    values = {
        "imk_id": imk_id,
        "jbnr": None,
        "goedningsregion": None,
        "oeko": False,
        "kvotegivende": True,
        "crop_history": {},
        "percolation_by_kategori": None,
        "org_n_topsoil": None,
        "s_soil": None,
    }
    return SimpleNamespace(_mapping=values, **values)


def new_field(imk_id, catchment=None, quota=0):
    return {
        "imkId": imk_id,
        "name": str(imk_id),
        "areaHa": 3,
        "retention": 50,
        "kystvandId": catchment,
        "udledningskvoteMarkKgn": quota,
    }


class SimulationFieldSetTests(DatabaseTests):
    def setUp(self):
        super().setUp()
        main.app.dependency_overrides[current_user] = lambda: AuthenticatedUser(email=EMAIL)
        self.addCleanup(main.app.dependency_overrides.clear)
        self.enterContext(
            patch.object(
                repository,
                "_registry_contexts_for_imk_ids",
                side_effect=lambda _, imk_ids: {
                    imk_id: registry_row(imk_id) for imk_id in imk_ids if imk_id != MISSING_IMK_ID
                },
            )
        )
        self.enterContext(
            patch.object(repository, "_soil_data_for_context", return_value=((), 3, 1))
        )
        self.enterContext(
            patch.object(
                repository, "_historical_years_for_context", return_value=rich_candidate().years
            )
        )
        self.client = TestClient(main.app)

    def view(self):
        return SimulationView.model_validate(self.client.get(f"{SIMULATION}/view").json())

    def setup_row(self):
        with self.sessions() as session:
            return session.execute(
                select(setups.c.revision, setups.c.data, setups.c.fields, setups.c.field_order)
            ).one()

    def result_status(self):
        with self.sessions() as session:
            return session.execute(select(results.c.status)).scalar_one()

    def save(self, section, **values):
        with self.sessions.begin() as session:
            data = session.execute(select(setups.c.data)).scalar_one()
            data[section] = {**data.get(section, {}), **values}
            session.execute(update(setups).values(data=data))

    def caps(self):
        return self.setup_row().data["constraints"]["max_n_load_by_kystvandopland"]

    def remove(self, *field_ids):
        query = "&".join(f"fieldId={field_id}" for field_id in field_ids)
        return self.client.delete(f"{FIELDS}?{query}")

    def test_added_field_starts_from_its_history_and_leaves_the_farm_alone(self):
        farm_field = field("farm-7").model_copy(update={"imk_id": 7})
        with self.sessions.begin() as session:
            session.execute(
                field_table.insert().values(
                    id=farm_field.id, farm_id="farm", data=farm_field.model_dump(mode="json")
                )
            )

        response = self.client.post(FIELDS, json=[new_field(7)])

        self.assertEqual(response.status_code, 201, response.text)
        [added] = response.json()
        self.assertNotEqual(added["id"], farm_field.id)
        self.assertEqual((added["jbnr"], added["kvotegivende"]), (6, True))
        self.assertEqual((added["db2"], added["leaching"], added["nLoad"]), (600, 30, 15))
        self.assertIsNone(added["rotationId"])
        self.assertEqual(len(added["cropRotation"]), 8)
        view = self.view()
        self.assertEqual(
            [field.id for field in view.data.fields], ["field-b", "field-a", added["id"]]
        )
        self.assertEqual(view.input_revision, 1)
        self.assertEqual(self.result_status(), "outdated")
        self.assertEqual(self.setup_row().fields[added["id"]]["calculation_context"]["imk_id"], 7)
        with self.sessions() as session:
            self.assertEqual(
                session.execute(select(field_table.c.data)).scalar_one(),
                farm_field.model_dump(mode="json"),
            )
            self.assertEqual(session.execute(select(farm_table.c.revision)).scalar_one(), 0)

    def test_a_field_already_in_the_simulation_is_not_added_again(self):
        first = self.client.post(FIELDS, json=[new_field(7)] * 2)
        second = self.client.post(FIELDS, json=[new_field(7)])

        self.assertEqual(len(first.json()), 1)
        self.assertEqual((second.status_code, second.json()), (201, []))
        self.assertEqual([field.imk_id for field in self.view().data.fields].count(7), 1)
        self.assertEqual(self.setup_row().revision, 1)

    def test_a_field_without_registry_soil_data_is_rejected_without_changes(self):
        response = self.client.post(FIELDS, json=[new_field(7), new_field(MISSING_IMK_ID)])

        self.assertEqual(response.status_code, 422)
        row = self.setup_row()
        self.assertEqual((row.revision, row.field_order), (0, ["field-b", "field-a"]))

    def test_removed_fields_leave_only_the_simulation_and_lower_its_limit(self):
        self.save("constraints", max_fields_with_new_rotation=2)

        response = self.remove("field-a", "field-b")

        self.assertEqual(response.status_code, 204, response.text)
        self.assertEqual(self.view().data.fields, [])
        row = self.setup_row()
        self.assertEqual((row.revision, row.fields, row.field_order), (1, {}, []))
        self.assertEqual(row.data["constraints"]["max_fields_with_new_rotation"], 0)
        self.assertEqual(self.result_status(), "outdated")
        self.assertEqual(self.remove("field-a").status_code, 404)

    def test_catchment_caps_left_at_the_kvote_follow_it_and_set_caps_stay(self):
        first = [new_field(7, catchment=1, quota=10.4), new_field(8, catchment=2, quota=20)]
        self.client.post(FIELDS, json=first)
        set_cap = {"kystvand_id": 2, "max_n_load_kg": 15}
        self.save(
            "constraints",
            max_n_load_by_kystvandopland=[{"kystvand_id": 1, "max_n_load_kg": 10}, set_cap],
        )

        [added, _] = self.client.post(
            FIELDS, json=[new_field(9, catchment=1, quota=5), new_field(10, catchment=2, quota=5)]
        ).json()
        after_adding = self.caps()
        self.save(
            "constraints",
            max_n_load_by_kystvandopland=[set_cap, {"kystvand_id": 1, "max_n_load_kg": 15}],
        )
        self.remove(added["id"])

        self.assertEqual(after_adding, [set_cap])
        self.assertEqual(self.caps(), [set_cap])

    def test_a_set_cap_next_to_the_rounded_kvote_stays(self):
        self.client.post(FIELDS, json=[new_field(7, catchment=1, quota=10.5)])
        set_cap = {"kystvand_id": 1, "max_n_load_kg": 10}
        self.save("constraints", max_n_load_by_kystvandopland=[set_cap])

        self.client.post(FIELDS, json=[new_field(8, catchment=1, quota=5)])

        self.assertEqual(self.caps(), [set_cap])

    def test_yearly_caps_left_at_the_kvote_follow_it_and_set_years_stay(self):
        self.client.post(FIELDS, json=[new_field(7, catchment=1, quota=10.4)])
        self.save(
            "optimization_settings",
            max_n_load_by_kystvandopland=[
                {"kystvand_id": 1, "max_n_load_by_year": {"2027": 10, "2028": 7}}
            ],
        )

        self.client.post(FIELDS, json=[new_field(8, catchment=1, quota=5)])

        settings = self.setup_row().data["optimization_settings"]
        [cap] = settings["max_n_load_by_kystvandopland"]
        self.assertEqual(cap["max_n_load_by_year"], {"2027": 15, "2028": 7})

    def test_a_trade_is_dropped_only_when_its_opland_cannot_trade_any_more(self):
        self.client.post(
            FIELDS,
            json=[new_field(7, catchment=1, quota=10), new_field(8, catchment=2, quota=20)],
        )
        trades = [
            {"kystvand_id": 1, "price_kr_per_kg": 35, "same_each_year": True},
            {"kystvand_id": 2, "price_kr_per_kg": 40, "same_each_year": False},
        ]
        self.save("optimization_settings", kind="yearly", quota_trades=trades)

        self.client.post(FIELDS, json=[new_field(9, catchment=1, quota=5)])
        after_adding = self.setup_row().data["optimization_settings"]["quota_trades"]
        removed = next(f for f in self.view().data.fields if f.kystvand_id == 2)
        self.remove(removed.id)

        self.assertEqual(after_adding, trades)
        self.assertEqual(self.setup_row().data["optimization_settings"]["quota_trades"], trades[:1])

    def test_fields_wait_for_the_simulation_to_copy_the_farm(self):
        with self.sessions.begin() as session:
            data = session.execute(select(setups.c.data)).scalar_one()
            session.execute(update(setups).values(data={**data, "fields_initialized": False}))

        added = self.client.post(FIELDS, json=[new_field(7)])
        removed = self.remove("field-a")

        self.assertEqual((added.status_code, removed.status_code), (409, 409))
        self.assertEqual(self.setup_row().revision, 0)

    def test_fields_wait_for_a_running_optimization(self):
        with self.sessions.begin() as session:
            session.execute(update(results).values(status="in_progress"))

        added = self.client.post(FIELDS, json=[new_field(7)])
        removed = self.remove("field-a")

        self.assertEqual((added.status_code, removed.status_code), (409, 409))
        self.assertEqual(self.setup_row().field_order, ["field-b", "field-a"])
