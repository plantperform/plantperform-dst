"""Transient candidates. Only selected evaluations cross the persistence boundary."""

from dataclasses import dataclass
from types import SimpleNamespace

from app.data import repository, simulation_store
from app.data.optimizer_inputs import optimizer_input, parse_optimizer_input
from app.domain.rotation_candidate import RotationCandidateEvaluation
from app.domain.simulation import CreateSimulationRequest, OptimizationConstraints
from app.services.scenario import candidate_evaluator
from plantperform_fargate.deadline import check_deadline
from plantperform_fargate.orchestrator import OptimizationInfeasibleError


@dataclass
class PreparedSnapshot:
    simulation: object
    fields: list
    candidates: list
    contexts: dict
    setup_fields: dict
    fields_before: list | None = None

    def __iter__(self):
        yield self.simulation
        yield self.fields
        yield self.candidates

    def __getitem__(self, index):
        return (self.simulation, self.fields, self.candidates)[index]


def evaluation_args(simulation, registry, real_history, jbnr):
    soil = repository._soil_data_for_context(registry)
    percolation, org_n, s_soil = soil if soil else (None, None, None)
    return {
        **simulation.godning.model_dump(),
        "jbnr": jbnr,
        "fdato": simulation.eea_fdato,
        "precision_dagsbasis": simulation.eea_precision_dagsbasis,
        "praecisionsjordbrug": simulation.praecisionsjordbrug,
        "tidlig_saaning": simulation.tidlig_saaning,
        "mellemafgrode": simulation.mellemafgrode,
        "real_history": real_history,
        "percolation_by_kategori": percolation,
        "org_n_topsoil": org_n,
        "s_soil": s_soil,
        "economics_key": simulation.economics_snapshot.overrides.cache_key(),
    }


def prepare(simulation, fields, setup_fields, contexts):
    simulation.constraints = simulation_store.merge_constraints(
        OptimizationConstraints(),
        simulation.constraints,
        len(fields),
    )
    request = CreateSimulationRequest.model_validate(
        {
            **simulation.model_dump(mode="json"),
            "saedskiftevarianter": simulation.rotation_saedskiftevarianter,
            "n_norm_procenter": simulation.rotation_n_norm_procenter,
        }
    )
    prepared = candidate_evaluator.prepare_candidates(
        request.saedskiftevarianter,
        request.n_norm_procenter,
        request.tidlig_saaning,
        request.mellemafgrode,
    )
    rows, computed_fields, computed_setups = [], [], {}
    conflicts = []
    for field in fields:
        check_deadline()
        registry = SimpleNamespace(**contexts[field.id]) if contexts.get(field.id) else None
        setup, full = repository.prepare_simulation_field(
            field,
            registry,
            request,
            prepared=prepared,
            economics_key=simulation.economics_snapshot.overrides.cache_key(),
        )
        previous = setup_fields.get(field.id, {})
        args = evaluation_args(simulation, registry, full.real_history, full.jbnr)
        for key in ("manual_candidate", "fixed_candidate"):
            value = previous.get(key)
            if not value or (
                value["ref"]["saedskiftevariant"] == "permanent" and not value.get("base_ref")
            ):
                continue
            old = RotationCandidateEvaluation.model_validate(value)
            source = old.base_ref or old.ref
            if source.saedskiftevariant != "permanent" and (
                source.saedskiftevariant not in simulation.rotation_saedskiftevarianter
                or source.n_norm_pct not in simulation.rotation_n_norm_procenter
            ):
                if key == "fixed_candidate" and field.allowed_rotation_ids:
                    conflicts.append(field.name)
                continue
            updated = candidate_evaluator.evaluate_with_overrides(
                source,
                old.overrides,
                start_year=old.start_year,
                **args,
            )
            if updated is not None:
                setup[key] = updated.model_dump(mode="json")
                full = simulation_store.merge_candidates(full, setup[key])
        if field.allowed_rotation_ids:
            selected = next(
                (c for c in full.candidates if c.ref.to_id() == field.rotation_id), None
            )
            if selected is None:
                conflicts.append(field.name)
            elif selected.ref.saedskiftevariant != "permanent" and any(
                y.year.afgrode_kode in simulation.optimization_settings.excluded_afgrodekoder
                for y in selected.years[: selected.active_len]
            ):
                conflicts.append(field.name)
            else:
                setup["fixed_candidate"] = selected.model_dump(mode="json")
                setup["allowed_rotation_ids"] = field.allowed_rotation_ids
                setup["fixed"] = {
                    "crop_rotation": [y.year.model_dump(mode="json") for y in selected.years],
                    "rotation_id": selected.ref.to_id(),
                    **repository._locked_candidate_figures(field, selected),
                }
        # Old valuations and winners are historical outputs, never new alternatives.
        setup.pop("economics_candidate", None)
        computed_setups[field.id] = {**setup, "calculation_context": contexts.get(field.id)}
        computed_fields.append(
            simulation_store.project_fields(
                {field.id: setup},
                [field.id],
                None,
            )[0]
        )
        compact = parse_optimizer_input(optimizer_input(full))
        rows.append(compact)
        del full
    if conflicts:
        raise OptimizationInfeasibleError(
            "Disse marker er låst til valg, der ikke passer til indstillingerne: "
            + ", ".join(dict.fromkeys(conflicts))
            + ". Ret indstillingerne eller lås markerne op."
        )
    return PreparedSnapshot(simulation, computed_fields, rows, contexts, computed_setups, fields)


def hydrate(snapshot, selected):
    result = {}
    rows = {row.field_id: row for row in snapshot.candidates}
    for field_id, candidate in selected.items():
        check_deadline()
        if candidate.ref.saedskiftevariant == "permanent":
            result[field_id] = RotationCandidateEvaluation.model_validate(
                snapshot.setup_fields[field_id]["fixed_candidate"],
            )
            continue
        context = snapshot.contexts.get(field_id)
        registry = SimpleNamespace(**context) if context else None
        row = rows[field_id]
        value = candidate_evaluator.evaluate_with_overrides(
            candidate.base_ref or candidate.ref,
            candidate.overrides,
            start_year=candidate.start_year,
            **evaluation_args(snapshot.simulation, registry, row.real_history, row.jbnr),
        )
        if value is None:
            raise ValueError("Selected rotation could not be reconstructed")
        if abs(value.avg_db_kr_ha - candidate.avg_db_kr_ha) > 0.00001:
            raise ValueError("Selected rotation changed during calculation")
        result[field_id] = value
    return result
