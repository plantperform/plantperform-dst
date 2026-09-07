# Handoff — week of 2026-09-04

## Real per-field percolation/soil-nitrogen (P/S/Nt) data now drives NLES5, not a shared placeholder

**What it does.** Every field's udvaskning calculation now uses that field's
own percolation factor (one of 8 values, chosen by its crop's
afstrømningskategori), organic topsoil nitrogen, and soil factor — all three
real, sourced from the new 2026 dataset — instead of one flat placeholder
shared by every field in the country. This applies everywhere NLES5 runs:
new scenario creation, Optimér, Års-optimering, Rediger manuelt, and
Afgrødehistorik.

**Why.** The placeholder was always a known stand-in, flagged as such in the
engine's own docstring. The new field data source (see the Data.V1_2.zip entry
below) finally carries real per-field values for all three, so continuing to
use one shared number for every field in the country stopped being a scoping
compromise and became simply wrong: two agronomically different fields, one
sandy and one clay, were computing byte-identical leaching for the same crop.

**Where.** `bridge_v2.evaluate_leaching_position` takes
`percolation_by_kategori`/`org_n_topsoil`/`s_soil` as parameters (it's
`lru_cache`d and can't do its own DB lookup). `repository.
get_registry_percolation_context` is the one public accessor every caller
uses to fetch and round them from `registry_field`. Worth knowing for anyone
touching this again: the 8 stored percolation values are positional (index =
afstrømningskategori 1-8), not separately named fields — easy to get backwards.

**Status.** Solid, but it took two passes to actually be true everywhere,
worth being explicit about for whoever ports it: the first pass wired the
real values into scenario creation only (`candidate_evaluator`). A user
screenshot of a freshly-run Års-optimering showing all-zero leaching for
every field caught that `orchestrator.py`'s four other call sites
(`apply_manual_rotation`, `_expand_yearly_options`, `run_yearly_optimization`,
`_resolve_field_rotation_candidate`) were still silently getting `None` for
all three values — and, per the next entry, `None` there now raises rather
than falling back, so nothing computed at all. All four now call
`get_registry_percolation_context` too, verified against the user's own real
59-field simulation (previously many fields stuck at zero, now none).

Separately, `candidate_evaluator.evaluate_sequence_for_mark` also gained a
`try/except ValueError` around the leaching call, for a *different*,
pre-existing NLES5 edge case unrelated to missing P/S/Nt: some very-low-N-norm
crop/JB11 combinations make the model's μ+Nθ+C term go negative, which the
formula can't take a fractional power of. That falls back to 0 kg N/ha for
the position, the same pattern already used in `field_history_evaluator`. A
field with real, present P/S/Nt data can still legitimately hit this on a
specific crop — it's not a sign the data is missing.

**Shortcuts.** None in the wiring itself. The missing-data handling is a
deliberate decision, covered in its own entry below, not a shortcut.

**Contract changes.** `evaluate_leaching_position`, `evaluate_sequence_for_mark`,
`evaluate_candidate_for_mark`, `evaluate_with_overrides`,
`generate_candidates_for_field`, and `evaluate_real_history_for_field` all
gained the same three parameters.
`services/soil/percolation_placeholder.py` is deleted — nothing calls it
anymore.

---

## No fallback for missing P/S/Nt data — fields without it are excluded via a new `banned` column

**What it does.** ~410 of 603,479 fields have no percolation/org_n_topsoil/
s_soil data in the source at all. Rather than guessing a value for them,
`evaluate_leaching_position` raises, and the field is marked
`registry_field.banned = true` — excluded from the map, search, and every
lookup path, the same as if it didn't exist, but without deleting the row.

**Why.** Explicit user decision, made in two steps. First, "let's not use
these fields, instead of doing a fallback" — once it was confirmed the
missing-data fields are almost entirely non-arable (permanent græs uden norm,
brak, miljøtilsagn, natur/skov), not real sædskiftemarker the engine has any
business computing a rotation for. Second, on how to make them invisible:
"I would rather that you make a new 'banned' column, where you ban them
instead of deleting" — reversible, since a future full reload from a
regenerated source file could bring the same rows back with real data. The
user was explicit this is meant to be a general mechanism, not
single-purpose: "if we then figure out that there are any certain
afgrødekoder we don't want, we can ban those fields as well."

**Where.** Migration `20260904_0002_registry_field_banned.py` adds the
column and backfills it in the same migration.
`registry_repository.py`'s eight query functions (search, get, bounds, and
the four map-tile queries) all filter `NOT banned`.
`repository._registry_context_for_imk_id` filters it too, so a banned field
can't be attached to a farm or contribute real-history data even via a
direct imk_id lookup.

**Status.** Solid.

**Shortcuts.** None — this is the permanent mechanism, not a stopgap.

**Contract changes.** New `registry_field.banned` boolean column, default
false.

---

## Mellemafgrøde and tidlig såning were computing zero leaching benefit — now fixed

**What it does.** Mellemafgrøder (catch crops) and tidligt såede
vinterafgrøder (early-sown winter crops) now actually reduce udvaskning by
20% each, as the law requires. Efterafgrøde sown into majshelsæd
(whole-crop maize) gets its own, lower 10% rate instead of the usual 45%.

**Why.** This was found, not requested: the user shared the full
høringsmateriale (hearing documents) for the 2027 udledningsbaseret
markregulering and asked for a cross-check against what's implemented.
`bridge_v2.py`'s leaching formula had `EMA` and `ETS` hardcoded to `0.0`
regardless of whether a mellemafgrøde or tidlig-såning udlægskode was
actually present on that rotation position — so choosing either virkemiddel
had **no effect on calculated udvaskning at all**, silently, since NLES5
launch. The real values (20%/20%) come straight from the draft
bekendtgørelse, Bilag 1, §48 stk. 3 and §49 stk. 3. The majshelsæd rate
(10% vs. the normal 45%) was already implemented from SKH's faktaark and is
confirmed correct against §37 stk. 2 — no change needed there, it's flagged
here only because it was verified in the same pass.

**Where.** `bridge_v2.evaluate_leaching_position`, the `EEA`/`EMA`/`ETS`/`EPJ`
sample dict. `_EEA_STRENGTH_MAJS`, `_EMA_STRENGTH`, `_ETS_STRENGTH` constants,
each with the exact paragraph cited in a comment.

**Status.** Fixed and numerically verified: mellemafgrøde or tidlig såning
alone now gives exactly the expected 0.80 multiplier; combined with
præcisionsjordbrug it gives 0.768 (= 0.80 × 0.96, confirming the two apply as
independent multiplicative terms, not summed); independently cross-checked
against SKH's own worked example of a 47.2% combined efterafgrøde +
præcisionsjordbrug effect.

**Shortcuts.** None in the fix itself.

**Contract changes.** None (no schema change) — but **any scenario computed
before this fix that used mellemafgrøde or tidlig såning has an understated
udvaskning/udledning figure for those years**. There's no stored "computed
with buggy engine" flag; recomputing (open the scenario, or re-run
Optimér/Års-optimering) picks up the fix automatically. Worth deciding whether
any existing demo/test scenarios need to be explicitly re-checked before
being shown to anyone as representative numbers.

---

## Efterafgrøde's nitrogen benefit is now a forfrugtsværdi credit, not a cost deduction

**What it does.** Growing an efterafgrøde (catch crop) after a main crop now
credits 21 kg N/ha to the **following** crop's nitrogen need (via the
existing forfrugtsværdi mechanism), instead of being netted off as a negative
cost in the efterafgrøde's own establishment year. Efterafgrøde, mellemafgrøde
and tidlig såning each now have real per-category udsæd/etablering costs
(previously mellemafgrøde-frøgræs and tidlig såning had no cost line at all,
and efterafgrøde's cost had "saved N" baked in as a discount).

**Why.** Direct user correction: "der hvor der er sparet N ex. efterafgrøder
skal ikke sættes som en negativ omkostning på den måde — efterafgrøden skal i
stedet give en forfrugtsværdi." Folding the N benefit into the cost line was
double-counting in a way that made the establishment year look cheaper than
it is and the following year's fertilizer need look higher than it is. 21 kg
N/ha is SKH's own figure for efterafgrøde after korn/majshelsæd; mellemafgrøde
explicitly has no such carry-over per the same source ("der indregnes ikke
nogen kvælstofeftervirkning"), and tidlig såning's fact sheet never mentions
the concept at all — so only efterafgrøde got the credit.

**Where.** `candidate_evaluator.compute_n_inputs` (new `prev_udlaeg_kode`
parameter, `_EFTERAFGRODE_FORFRUGTSVAERDI_KGN_HA = 21.0`).
`db_calculator._UDL_KOSTKATEGORI` (category split: efterafgrøde/mellemafgrøde
each now have a separate frøgræs-continued variant at 0 kr, since the
frøgræs itself is the cover — no fresh establishment cost; majshelsæd has its
own cheaper efterafgrøde category, no full harrowing needed).

**Status.** Solid — costs are taken directly from SKH's faktaark om
virkemidler (2026); not independently re-verified beyond that source.

**Shortcuts.** None beyond the pricing itself being SKH's estimates rather
than the farm's own actuals (same caveat as all `Prisliste_2026.csv` figures).

**Contract changes.** None.

---

## Præcisionsjordbrug: new opt-in scenario toggle

**What it does.** "Nyt scenarie" has a new checkbox, off by default. When on,
every year in the scenario where the main crop is korn or raps gets an extra
4% udvaskning reduction (applied as its own independent `(1 − 0.04)` term,
not merged into the efterafgrøde/mellemafgrøde percentages) and a 50 kr/ha
cost. Years with any other main crop are completely unaffected, even with
the toggle on.

**Why.** User request, directly modeled on the existing
efterafgrøde-dagsbasis toggle pattern: "lad det være noget man kan togle
on/off når man laver et nyt scenarie... det skal ganges på som et
selvstændigt led (1-0,04)."

**Where.** New `praecisionsjordbrug: bool` field on `Simulation` /
`CreateSimulationRequest` (sibling to `godning`, same pattern as
`eea_precision_dagsbasis`), threaded through
`repository.py`/`orchestrator.py`/`candidate_evaluator.py` into
`bridge_v2.evaluate_leaching_position` (the `EPJ` term) and
`db_calculator.calculate_db` (the cost line). `NewScenarioPanel.tsx` for the
checkbox.

**Status.** Mechanically solid — gating on korn/raps, independent
multiplication, and the toggle wiring are all verified (see the leaching
bug-fix entry above for the numeric cross-check). The price is not.

**Shortcuts.** The 50 kr/ha price is an explicit placeholder — SKH's own
materials gave three different figures (40, 70, and 50 kr) depending on which
document/section, and the user picked 50 kr "indtil videre" (for now) to
unblock the feature. Worth firming up before this is treated as a real number
in front of a customer.

**Contract changes.** New field on `Simulation`/`CreateSimulationRequest`
(backend) and on the matching frontend `Simulation`/`CreateSimulationInput`
types. Defaults to `false`, so no existing saved scenario changes behavior.

**Open questions.** The korn/raps crop-code set
(`{1,2,3,10,11,14,15,22}` — Vårbyg/Vårhvede/Havre/Vinterbyg/Vinterhvede/
Vinterrug/Vinterhybridrug/Vinterraps) is duplicated identically in
`bridge_v2.py` and `db_calculator.py`, each with a "keep in sync" comment.
Worth consolidating into one shared constant during the real port so the two
can't silently drift.

---

## Tidlig såning and mellemafgrøde are now per-scenario on/off toggles

**What it does.** "Nyt scenarie" has two new checkboxes, both on by default.
Turning either off removes just that virkemiddel type from every rotation
position that has it — the crop and every other udlægstype (including
efterafgrøde) at that position is unaffected, and no sædskiftevariant becomes
unselectable. Two otherwise-different variants can end up identical after
stripping (e.g. one that only differed by a mellemafgrøde at one position);
duplicates within the same N-norm% are computed once, not discarded after
the fact.

**Why.** Direct user request for a new way to handle these two virkemidler,
as an explicit scenario-level choice rather than something implied only by
which sædskiftevariant happens to be picked.

**Where.** `candidate_evaluator._strip_disabled_virkemidler`, gated on the
new `Simulation.tidlig_saaning`/`mellemafgrode` fields (both default `true`,
so every existing saved scenario keeps its current behavior unchanged).
`NewScenarioPanel.tsx` for the two checkboxes.

**Status.** Solid.

**Shortcuts.** None.

**Contract changes.** New `tidligSaaning`/`mellemafgrode` fields on
`Simulation`/`CreateSimulationRequest` (backend) and the matching frontend
types, both defaulting to `true`.

---

## New crop-exclusion filter, and Års-optimering can now shift every candidate

**What it does.** "Års-optimering" still caps total N-load per calendar year
(one value for all years, or one per year) and bounds how much total DB2 may
swing year to year (±X% of the scenario average) — but every stored
candidate for a field can now be shifted to any of its own start-year
positions when it runs, not just a pre-approved subset. In exchange, opening
either "Optimér" or "Års-optimering" now shows a list of every afgrødekode
actually in use across the scenario's candidates, which the user can
deselect; any candidate containing a deselected crop *anywhere* in its
rotation is dropped from that run entirely. The exclusion list is run-scoped,
not saved — it resets to "everything selected" the next time either dialog
opens.

**Why.** Gives the adviser year-by-year compliance and income-stability
control that the original single "Optimér" pass (which only optimises the
whole 8-year total) couldn't offer — that part is unchanged from when this
was first built. What changed this week is *which* candidates the solver was
even allowed to shift: the original design (Fase 12) required the user to
explicitly pick which (saedskiftevariant, variant) pairs were shift-eligible
via a dedicated selector; everything else contributed only its unshifted
variant. That's exactly what surfaced as a live concern: "er jeg bange for at
der i års optimeringen ikke er mulighed for at skubbe sædskifterne for at få
det til at passe?" (worried Års-optimering has no way to shift rotations to
make things fit) — if the user hadn't pre-selected a candidate as
shift-eligible, the solver genuinely could not move it, no matter how much
that would have helped satisfy a cap. Removing the pre-selection and letting
every candidate shift fixes that directly. Crop exclusion is the replacement
lever for keeping the resulting search space (and runtime) under the user's
control, now scoped to something more meaningful to an adviser —
"don't consider anything with sukkerroer" — than an abstract variant-pair
picklist.

**Where.** `yearly_engine.py`, `orchestrator._expand_yearly_options` (shift
loop is no longer gated on a `selected_pairs` membership check),
`orchestrator._exclude_afgrodekoder` (new, shared by both `_build_options`,
used by plain Optimér, and `_expand_yearly_options`). New endpoint
`GET /{simulation_id}/afgroder-i-brug`. `excludedAfgrodekoder` state on
`FarmInspector.tsx`'s Optimér/Års-optimering dialogs, sent as
`excluded_afgrodekoder` on both request bodies.

**Status.** Solid. The per-year caps and DB2 swing limit were previously
verified against real scenario data: a 50% DB2-swing cap flattened per-year
deviation from over 100% down to within ±41% at a 0.4% cost to total DB2; a
60 kg N per-year cap on 2024 was hit exactly. The free-shift and
crop-exclusion change is mechanically verified but hasn't had the same kind
of real-farm numeric cross-check yet.

**Shortcuts.** None.

**Contract changes.** New `optimize-yearly` endpoint (pre-existing).
`YearlyOptimizeSimulationRequest.selected_saedskifter` (and the
`SaedskifteVariantRef` model) is removed this week — replaced by
`excluded_afgrodekoder: list[int]` on both `OptimizeSimulationRequest` and
`YearlyOptimizeSimulationRequest`. A client still sending the old field
won't error, pydantic just ignores it, but it no longer does anything. Also
fixed previously: the "+manuel" ref-id suffix for overridden/shifted
candidates didn't encode which override or start year was used, so different
shifts of the same base candidate could silently collide on the same storage
key — the suffix now encodes both.

**Open questions.** No upper bound yet on how large the shift search space
gets for a field with many candidates × many active_len positions, now that
all of them expand — the existing `time_limit_seconds` is the only backstop.
Worth watching if a very large farm's Års-optimering run starts timing out
rather than finishing under budget.

---

## Performance: eliminated per-field N+1 queries after real P/S/Nt broke cache reuse

**What it does.** Opening a field's calculation detail (in a scenario, or now
in Afgrødehistorik) and running Års-optimering no longer re-fetch and
re-deserialize every field in the farm just to find the one being looked at.

**Why.** Found by direct investigation of a real complaint: noticeably high
Python RAM with nothing that should be computing. `ManualRotationEditor` is
mounted once per field in the list — its dialog is only hidden via a prop
when closed, not unmounted — so all 59 of them were eagerly fetching
candidate-detail on every simulation view, and each of those hit
`get_simulation_field_candidate_detail`/its siblings, which fetched and
deserialized *every* field and *every* field's candidate list (geometry
included) just to pick out one. That's an O(fields²) cost that was always
there, but only became visible once the real per-field P/S/Nt values
(entries above) broke `evaluate_leaching_position`'s `lru_cache` reuse across
fields — before that, every field shared one placeholder value, so the cache
masked how much redundant work was happening underneath.

**Where.** `ManualRotationEditor.tsx` withholds `fieldId` from
`useSimulationFieldCandidateDetail` while its dialog is closed, so SWR's key
builder returns `null` and skips the fetch. `repository.get_simulation_field`/
`get_field` (new, single-row getters, mirroring the existing
`get_simulation_field_candidates` pattern) replace the list-then-filter
approach in `orchestrator.get_field_candidate_detail` and
`repository.get_farm_historical_yearly_summary`.
`bridge_v2.evaluate_leaching_position`'s `lru_cache` size was cut from
100,000 to 20,000 — with real per-field values in the key, a 100k-entry cache
under this access pattern grew to multiple GB RSS viewing one 59-field
simulation's candidate details; a smaller cache still gets full within-field
reuse (the same crop/position recurring across a field's own shift variants),
just not the cross-field reuse it got by accident before.
`saedskifte_library.get_raw_rotation` also gained its own small `@cache` — it
was being re-filtered from scratch on every call for the same trivially
small (saedskiftevariant, variant) keyspace.

**Status.** Solid — re-verified end to end on the user's real 500-field farm.

**Shortcuts.** None.

**Contract changes.** None (internal only). If a future change makes the
P/S/Nt values vary more within a single field (they currently don't), the
20,000 cache size should be revisited rather than assumed still generous —
see the reasoning left in `evaluate_leaching_position`'s docstring.

---

## Excess floating-point precision trimmed to 3 decimals: P/S/Nt, udledningsgrænse, and retention

**What it does.** The new data source's percolation, org_n_topsoil, s_soil,
udledningsgrænse, and retention figures carried 16+ significant digits of
floating-point noise. All five are now rounded to 3 decimals, consistently,
at both read-time and storage-time.

**Why.** User-set tolerance: a somewhat-correct udvaskningsberegning at 3
decimals of correctness is fine — and, once shown, the same tolerance was
confirmed to apply to udledningsgrænse and retention too. 3 decimals on the
*inputs* to NLES5 also directly helps the cache-reuse problem in the entry
above: two fields with near-identical soil now have a real chance of landing
on the exact same rounded value and sharing a cache entry, instead of every
field's 16-digit float guaranteeing its own unique cache key.

**Where.** `repository._PERCOLATION_ROUND_DIGITS = 3` (P/S/Nt, applied
wherever they're read for a calculation).
`load_registry_from_merged_gpkg.py`'s `ROUND_DIGITS = 3` /
`clean_float_rounded()` (applied at load time to the same three, plus
`RetTot` and the derived `udledningskvote_mark_kgn`, computed as a rounded
SQL expression rather than rounded in Python after the fact).

**Status.** Solid.

**Shortcuts.** None — this is a permanent rounding rule, not a temporary
display truncation.

**Contract changes.** None (values are corrected in place, same columns).

---

## Afgrødehistorik gains the same calculation-detail view and Årsoversigt as scenarios

**What it does.** Expanding a field in Afgrødehistorik now opens the same
beregningsgennemgang (calculation-detail breakdown) already available for
scenario candidates — same P/S/NT/formula tables — instead of that button
being scenario-only. Årsoversigt (the yearly DB2/udvaskning/FE strip) now
also renders above the field list in Afgrødehistorik, summed across the
farm's own real crop history instead of a simulation's candidates. Tabs in
both views now label each year by its real calendar year (e.g.
"2026 – Vinterhvede") instead of a relative rotation position
("År 8 – Vinterhvede"), which was actively misleading for Afgrødehistorik
since its 8 positions already *are* fixed calendar years (2019–2026), not a
repeating cycle.

**Why.** Direct user request to bring feature parity between the two views,
plus a display correction once seen (relative position labels don't make
sense for a view whose years are already real years), and a follow-up bug
report that the yearly strip wasn't rendering in the historical view at all
on the first attempt.

**Where.** New endpoints `GET /farms/{farm_id}/fields/{field_id}/historical-detail`
and `GET /farms/{farm_id}/fields/historical-yearly-summary`
(`repository.get_field_historical_years`/`get_farm_historical_yearly_summary`).
New `HistoricalDetailPanel.tsx` (mirrors `RotationDetailPanel.tsx`, no
rotation-watching needed since historical data doesn't change from
optimization runs). `YearlyOverviewStrip.tsx`'s `simulationId` prop is now
optional — omitting it switches the component to the historical data source
and calendar-year-as-is labeling instead of relative-position conversion.
`FarmFieldsList.tsx`'s expand-detail column is no longer gated to simulation
view.

**Status.** Solid.

**Shortcuts.** None.

**Contract changes.** Two new read-only endpoints, no existing ones changed.

---

## Real SEGES yield/price data extended to organic driftsform and remaining crops

**What it does.** Real Budgetkalkuler-2026 pricing now covers 33 of the 34
crop codes used in the sædskifte-lookup (up from 16 last week) — the one
remaining, Lupin, has no SEGES budget calculation at all (SEGES doesn't
publish one), so its figures are built from real agronomic cultivation
guides plus rates for comparable legumes already in the dataset, per source
material the user provided directly. Sourced and implemented the same way as
the other 33 crops, just from a different kind of source document — not a
placeholder. Documented in `Dyrkningsomkostninger_afgroedekoder.csv`'s own
kilde field. Separately, the yield-norm master table gained real organic-specific
yield rows for 32 of the 34 crop codes (up from **zero** — every organic
yield used to be a flat guess).

**Why.** The user supplied
`goedningsnormer_konventionel_og_estimeret_øko.xlsx` specifically to close
this gap. Until now, *every* crop at Økologisk driftsform used the same
flat -32% reduction off the conventional yield, regardless of crop — a
placeholder the user has wanted replaced with real per-crop figures since it
was first flagged.

**Where.** `db_calculator._load_udbyttenormer`/`_lookup_udbyttenorm` (now
keyed on driftsform too, returns `(norm, er_reel_oeko_norm)` so the -32%
fallback only fires when no real organic row exists).
`_lookup_salgspris` also gained a same-price-as-conventional fallback for the
crops still missing a dedicated organic sale price.

**Status.** Solid for 18 of the 34 crop codes, which have a real, sourced
organic yield row (SEGES-udtræk, or — for the 4 permanent-græs codes
250/251/252/254 — a verified, deliberate "organic = conventional" equivalence,
confirmed byte-identical, not a guess). The other 16 need a closer look
before being treated as reliable:

- **2 codes have no organic row at all**, so they're unchanged from before
  this week — still the flat -32% guess: **701 (Grønkorn af vårbyg)**, which
  has real conventional data but nothing organic-specific yet, and
  **263 (Sædskiftegræs uden kløver, omdrift)**, which has no row in either
  driftsform — a pre-existing gap in the official Bilag 1/3 source data
  itself (confirmed via `db_calculator`: it already returns 0 udbytte for
  code 263 today, in both driftsformer), not something this week's data
  could fix.
- **14 codes now have an organic row, but it's still a constructed "best
  bet" placeholder** (the same kind of guess as before, just crop-specific
  now instead of one flat -32%), not real SEGES data: Majs til modenhed (5),
  Vinterrug (14), Rødsvingelfrø (108), Engrapgræsfrø mark-type (112),
  Engrapgræsfrø plæne-type (113), Kløverfrø (120), Kartofler stivelses- (151),
  Kartofler spise- (152), Sukkerroer til fabrik (160), Ærtehelsæd (215),
  Vinterrug helsæd (222), Fodersukkerroer (280); plus Hestebønner (31), whose
  JB1+3-uvandet row alone is still best-bet (its other two JB-groups did get
  real data — SEGES has no calculation for hestebønner on that soil type and
  explicitly advises against growing it there); and Kode 260 (Græs med
  kløver/lucerne <50%, omdrift), whose *yield* is a reasonable copy from the
  source but whose *N-norm* specifically is still best-bet.

So "32 of 34 got an organic row" (true) is a narrower claim than "32 of 34
now have reliable organic data" (not true, per above) — worth not conflating
the two when this is ported. The master table's `Kilder_og_noter` tab has the
authoritative, always-current version of this list if it's revised further.

**Shortcuts.** Lupin is not a shortcut — see "What it does" above for why its
sourcing looks different from the other 33 crops. The 14 "best bet" organic
rows above are the real shortcut: a temporary, constructed stand-in until a
proper source (e.g. a future SEGES organic budget calculation for these
crops) is found — same caveat that applied to the flat -32% they replaced,
just narrower in scope now.

**Contract changes.** None (data-only). The underlying CSV filenames also
lost their `Testdata_`/`midlertidig_test_` prefixes this round
(`Salgspriser_afgroedekoder.csv`, `Prisliste_2026.csv`, etc.) — purely a
rename, same shape, but note it if anything outside this codebase references
the old filenames.

---

## Driftsform field separated from gødningstype, kept in sync with kun-organisk gødning

**What it does.** "Driftsform" (Konventionel/Økologisk) now has its own field
directly under the scenario name, instead of living inside the gødning grid
next to "Gødningstype". "Kun organisk gødning" now always follows the current
driftsform choice, regardless of what order the user picks driftsform vs. a
gødningstype preset in.

**Why.** Driftsform governs crop yield norms and N-norm lookups for the
*whole* scenario, not just the gødning settings it was visually grouped
with — grouping it there was misleading. The onlyOrganic bug meant it was
possible to end up with Driftsform = Økologisk but "kun organisk gødning"
still off (or vice versa) depending on click order, which would silently
compute an inconsistent economics/leaching mix for what's supposed to be a
pure-organic scenario.

**Where.** `NewScenarioPanel.tsx` — the new standalone Driftsform `<select>`,
and `applyGodningsTypeValg`'s `setOnlyOrganic(driftsform === 'Økologisk' ? ...)`.

**Status.** Solid.

**Shortcuts.** None.

**Contract changes.** None.

---

## Sædskifte lookup migrated to a simplified, N-norm%-independent data source

**What it does.** No visible behavior change. Internally, rotation data now
comes from `Ny_sædskifte_lookup_sammenlagt.csv`, keyed only by
(saedskiftevariant, variant) instead of the old
(saedskiftevariant, variant, N-norm%) three-key file. N-norm% scaling was
already a pure percentage calculation in
`candidate_evaluator.compute_n_inputs` — the rotation data itself carrying a
redundant N-norm% axis meant some (variant, N-norm%) combinations existed in
the old file and others didn't, for no real reason. The 6 sædskifte
categories also became 4, read directly from the new file's own "Sammenlagt
kategori" column instead of a separate, now-dead lookup file.

**Why.** Data-source cleanup: every valid N-norm% now applies uniformly to
every sædskiftevariant/variant, rather than only to whichever combinations
the old file happened to enumerate.

**Where.** `saedskifte_library.py` (rewritten), `saedskifte_kategorier.py`
(rewritten to derive categories from the CSV's own column),
`rotation_candidates.py` (N-norm% picker is now a fixed constant list, since
the data source no longer carries that axis).

**Status.** Solid.

**Shortcuts.** None.

**Contract changes.** The old data file,
`PlantPerform_saedskifte_lookup_v4_uden_normgruppe_dedup (1).xlsx`, is no
longer read by any code and can be deleted from `ANGJ-data` (gitignored, not
in this diff).

---

## Manual rotation editor per field

**What it does.** After "Optimér" assigns a sædskifte, "Rediger manuelt" lets
you swap to a different sædskifte or override individual years' crops on one
field, with udvaskning/DB2/FE recalculated live before saving. Saving locks
the field so a later "Optimér" run won't overwrite it.

**Why.** Lets an adviser hand-correct one field's rotation for reasons the
solver can't see (a known local constraint, a contract with a specific buyer)
without losing that choice on the next optimisation pass.

**Where.** Reuses and fixes the pre-existing lock mechanism
(`allowed_rotation_ids`), which was previously dead code.

**Status.** Solid. Two things landed on it this week without changing its
behavior: it now recalculates against real per-field P/S/Nt data (see that
entry above — this editor was one of the paths silently getting zero
leaching before the fix), and it no longer triggers up to 59 redundant
field-list fetches per simulation view (see the Performance entry above).

**Shortcuts.** None.

**Contract changes.** None. Cleaned up stale `allowed_rotation_ids` data left
over from the old Crop-enum era.

---

## Nøgletal and ton-fertilizer display

**What it does.** The field calculation breakdown now shows a two-layer
nøgletal view: the six headline figures (Normudbytte, Foderenheder,
Forfrugtsværdi, Tildelt gødning, DB, Tilgængeligt N) plus Udvaskning and
Udledning up front, with the full NUAR/DB2 formula only in an expanded
second layer. There's also a per-field-per-year ton-fertilizer reference
figure, using the raw scenario fertilizer setting (org_mineral_n ÷ N
content) — constant across all 8 rotation years, since the same amount is
physically applied regardless of any one crop's N-norm.

**Why.** Surfaces udvaskning/udledning without an extra click. The ton figure
went through two iterations (first N-content-based, then utilised-N, then
finally the applied-amount basis above) based on direct user clarification of
what the figure should represent physically.

**Where.** `MetricTile`, the calculation-breakdown components; ton figure in
the same field's `n_inputs`.

**Status.** Solid.

**Shortcuts.** The ton-fertilizer figure is a pure reporting figure with no
effect on any calculation yet — it's groundwork for a later optimisation
parameter (min/max tons of fertilizer used per year).

**Contract changes.** None.

---

## New 2026 field data source, packaged for handoff as Data.V1_2.zip

**What it does.** The registry (`registry_field`, 603,479 fields) now loads
from a fresh government dataset (`V1_1_IMK2026_n604144_gpkg`) instead of the
2023/2024-vintage source. `imk_id` now comes directly from this file — it's
the authoritative id going forward, not reused/invented via the old
overlap-matching logic. To get a running copy of the app, extract
`Data.V1_2.zip` into `backend/database/data/raw/` — it contains the files the
current code reads (the merged geopackage, the Kystvandoplande and MARS
project shapefiles, and the CSV/xlsx files read directly by
`saedskifte_library.py`, `afgroede_normer.py`, `afstromning.py`,
`historisk_goedning.py` and `db_calculator.py`), nothing superseded or
orphaned. Then run, in order: `pixi run load-registry-from-merged-gpkg`,
`pixi run load-kystvandoplande`, `pixi run load-mars-projekter` (the "Grøn
Trepart – Omlægningsplan" map layer and each field's
omlaegningsplan_virkemiddel/in_takeout_plan — order relative to
load-kystvandoplande doesn't matter, both only need registry_field to
already exist), `pixi run db-migrate` (for the percolation/banned columns),
`pixi run backfill-percolation` (only needed if you migrate an
already-loaded table — a fresh `load-registry-from-merged-gpkg` run
populates those columns itself).

**Why.** The old dataset's `imk_id` included ~14% freshly-invented ids from
best-effort overlap matching, not a stable external identifier — a real
problem for anything keying on it long-term. The new file also carries real
per-field percolation/soil-nitrogen data (see entries above) that the old one
didn't have at all.

**Where.** `database/scripts/load_registry_from_merged_gpkg.py` (replaces 6
of the previous 7 loader scripts — `load_kystvandoplande.py` is still run
separately, see its own module docstring for why kystvand_id/kystvand_navn
can't come from the merge). `database/scripts/backfill_percolation.py`
(one-time migration helper, not part of a fresh setup).

**Status.** Solid — verified row counts, spot-checked known fields, and
cross-checked the opland/kystvand fix (below) against real farm data.

**Shortcuts.** ~410 fields (almost entirely non-arable: permanent græs uden
norm, brak, miljøtilsagn, natur/skov) have no percolation/Nt/S data in the
source at all — these are marked `registry_field.banned` and excluded from
every read path (map, search, lookup) rather than shown with guessed
numbers (see that entry above). A handful of text columns
(`omlaegningsplan_virkemiddel`, `in_takeout_plan` and others, ~91% of rows)
show the literal string `"nan"` instead of blank, a GPKG round-tripping
artifact from the enrichment merge — left as-is, explicit decision, not
fixed.

**Contract changes.** Every field's `imk_id` changed. Existing saved
farms/scenarios that reference the old ids are now orphaned (no matching
registry row) — explicitly accepted, not migrated. Any script or export
relying on the old ids needs the new file's own id instead.

---

## Kystvand_id/kystvand_navn were coming from two different, disagreeing sources

**What it does.** A field's coastal-catchment id and its name now always
come from the same computation (a real dominant-overlap spatial join against
`Kystvandoplande_VP3_II_2025.shp`), so they can no longer disagree with each
other — a field's "Vandopland" map colour and its catchment name are
guaranteed to refer to the same real catchment.

**Why.** The new registry load initially took `kystvand_id` straight from
the new file's own attribute column, while `kystvand_navn` was carried over
from the old table via a (cvr, marknr) join — two unrelated sources for what
should be one fact. Found from a live bug report ("fields I know share one
opland show scattered across many") — confirmed empirically (e.g. one real
farm had 4 fields quietly misassigned to a neighbouring catchment).

**Where.** `load_kystvandoplande.py`'s `compute_dominant_kystvand_id`, run
once after any full registry reload (see the Data.V1_2.zip entry's setup order).

**Status.** Solid — re-verified against the specific catchments the bug
report named; all now resolve to exactly one id.

**Shortcuts.** None.

**Contract changes.** None (corrects data in place, same columns).

---

## Not worth keeping

- The Fase-12 "selected_pairs" mechanism — an explicit UI selector for which
  (saedskiftevariant, variant) pairs Års-optimering was allowed to shift —
  is fully replaced this week by letting every candidate shift and adding
  crop exclusion instead (see that entry above). Nothing from the old
  selector is worth porting; `SaedskifteVariantRef` and
  `selected_saedskifter` are gone.
- The ton-fertilizer figure changed basis twice (see "Nøgletal and
  ton-fertilizer display" above) before landing on the applied-amount
  version. Only that final version needs porting.
- The præcisionsjordbrug price went through three candidate figures (40, 70,
  50 kr/ha) from different SKH source documents before settling on 50 kr as
  an explicit placeholder — see that entry's Shortcuts. Only 50 kr is in the
  code; the other two were never implemented.
