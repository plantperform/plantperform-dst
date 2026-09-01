# Handoff — week of 2026-08-31

## Udledningskvote is enforced per kystvandopland, not per farm

**What it does.** A farm's udledningskvote (emission quota) is now shown and
enforced separately for each kystvandopland (coastal water catchment) it has
fields in, instead of one combined farm-wide number. Both the "Optimér" and
"Års-optimering" solvers now cap N-load per catchment rather than per farm.
Catchments are labeled by their real name (e.g. "Sejerø Bugt"), not just a
numeric id.

**Why.** The regulation defines udledningskvote per kystvandopland — a
surplus in one catchment can never offset an overshoot in another. Pooling
quota and emission across catchments (the old behaviour) could show a farm as
compliant when one of its catchments individually was not, or force the
solver to under- or over-constrain a farm that spans several catchments.

**Where.** `engine.py` and `yearly_engine.py` group N-load constraints by
`kystvand_id` (one constraint per catchment; yearly adds one per catchment
per calendar year). The sidebar quota breakdown is computed live from the
current real-history state rather than a stored value. Catchment names come
from `registry_field.kystvand_navn`, loaded in
`load_kystvandoplande.py` from the `Kystvandoplande_VP3_II_2025.shp` source.

**Status.** Solid. Verified against synthetic data (a tightly capped
catchment forced onto its low-N option while an uncapped catchment picked
freely) and against a real two-catchment farm (a 300 kg N cap landed the
solver at 299.8 kg while the uncapped catchment was unaffected).

**Shortcuts.** None.

**Contract changes.** `Farm.udledningskvoteKgN` is no longer a flat,
manually-set number — see the next entry, which replaces it with a
live-computed, auto-filled value. The old field had no other backend reader,
so nothing needed migrating.

---

## "Afgrødehistorik" (formerly "Aktuel") now reflects the field's real history, not placeholders

**What it does.** When a field is first attached to a farm, its DB2, N-load,
udvaskning and fen figures used to be hardcoded to 0. They're now a real
8-year window (2019–2026) built from the field's own crop history, with
fertilizer inputs (MNCS/G0) looked up per position from the 2025+2026
regional average fertilizer distribution (Bilag 3), matched by the field's
region, driftsform (økologisk/konventionel), afgrødekode and jb_nr — not a
scenario slider, and not the field's own literal fertilizer records (those
aren't in the data), but a real regional/driftsform average rather than a
hypothetical or user-set value. This view was renamed from "Aktuel" to
"Afgrødehistorik" today, at the user's request, to better describe what it
actually shows.

A new scenario's first two rotation years (2027/2028) also now look back at
the field's real 2025/2026 history instead of wrapping around to a
hypothetical future year of the same 8-year candidate — years 2029 onward are
unaffected and still use the scenario's own settings.

Farm-level udledningskvote (see previous entry) is now auto-filled as the sum
of each kvotegivende field's quota, recomputed whenever a field is added or
removed — still user-editable afterward.

**Why.** These were two long-standing placeholder-zero gaps in the engine.
Showing a genuinely new field as "0 kg N, 0 DB2" was misleading, and a new
rotation's opening years silently used fictional data instead of the farm's
actual recent cropping.

**Where.** `field_history_evaluator.evaluate_real_history_for_field` (the
Afgrødehistorik computation); `candidate_evaluator.evaluate_sequence_for_mark`'s
`real_history` parameter (the 2027/2028 lookback, cached on
`SimulationFieldCandidates` so it's computed once per scenario, not per
call); `repository._recompute_farm_udledningskvote` (the quota auto-fill).
UI: `FarmSidebar.tsx` (the renamed view), `FarmFieldsList.tsx`,
`FarmFieldsMap.tsx`.

**Status.** Solid. The 2027/2028 lookback was verified byte-identical to the
old behaviour for position 2 onward, confirming only the intended positions
changed.

**Shortcuts.**
- A crop with no meaningful historical N-norm (e.g. permanent grass without a
  norm) can make NLES5's base term mathematically invalid; that position
  falls back to 0 rather than crashing the field.
- The underlying reference data (historical fertilizer distribution,
  kvotegivende areal list, 2017–2023 crop history) is the 2026-08-28 ANGJ-data
  vintage, documented in `backend/database/scripts/README.md`. `goedningsregion`
  assignment was done ad hoc for this vintage, not as a re-runnable script —
  ask the user if it needs to be regenerated from a newer data drop.

**Contract changes.** None beyond the quota auto-fill noted above.

---

## Afstromningskategori (P-leaching category) is now looked up per afgrøde, not hardcoded to 1

**What it does.** The P section of a field's calculation breakdown now shows
the real afstromningskategori for its crop (with a note when an
EEA-virkemiddel/efterafgrode changes the category), instead of always saying
"kategori 1".

**Why.** Leaching used a hardcoded category of 1 for every crop, so one of
the eight P-values (percolation_placeholder) was wrong for any crop that
isn't actually category 1 per Bilag 7.

**Where.** `afstromning.py`, loading the full 323-crop
`Bilag_1_tabel_1_med_P_noegle.csv`.

**Status.** Solid. The Bilag 7 source table itself covers all 323 official
afgrødekoder with no gaps, verified.

**Contract changes.** None.

---

## Års-optimering: per-year N-load caps and DB2 swing limits

**What it does.** A new "Års-optimering" panel lets the solver cap total
N-load per calendar year (one value for all years, or one per year), bound
how much total DB2 may swing year to year (±X% of the scenario average), and
shift a field's rotation within its own cycle as an extra lever to hit those
targets.

**Why.** Gives the adviser year-by-year compliance and income-stability
control that the original single "Optimér" pass (which only optimises the
whole 8-year total) couldn't offer.

**Where.** `yearly_engine.py`, new `optimize-yearly` endpoint.

**Status.** Solid. Verified against real scenario data: a 50% DB2-swing cap
flattened per-year deviation from over 100% down to within ±41% at a 0.4%
cost to total DB2; a 60 kg N per-year cap on 2024 was hit exactly.

**Shortcuts.** None.

**Contract changes.** New API endpoint. Also fixed, while building this: the
"+manuel" ref-id suffix for overridden/shifted candidates didn't encode
which override or start year was used, so different shifts of the same base
candidate could silently collide on the same storage key — the suffix now
encodes both. Existing single-field manual edits are unaffected.

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

**Status.** Solid.

**Shortcuts.** None.

**Contract changes.** None. Cleaned up stale `allowed_rotation_ids` data left
over from the old Crop-enum era.

---

## 2026 field dataset: markblok/jbnr, MARS omlægningsplan layer

**What it does.** Field data (`registry_field`) now comes from the 2026
Marker/Jordbundskort/MARS shapefiles instead of the 2023 IMK geopackage.
Fields show their real `markblok`/`jbnr` instead of a crude sand/clay flag,
and there's a new independent, togglable "Grøn Trepart – Omlægningsplan" map
layer showing MARS-project fields (vådområder/skovrejsning/lavbundsprojekter
etc.), with a legend and hover popup.

**Why.** `jbnr` is the real Danish JB-classification the optimisation engine
already used internally — showing the crude sand/clay derivation in the UI
was inconsistent with what the engine actually calculates against. The MARS
layer surfaces omlægningsplan status, previously invisible in the map.

**Where.** `load_dataimk2026.py` plus a new sequence of load scripts
(documented in `backend/database/scripts/README.md`); new `mars_projekt`
table and `/api/v0/mars/tiles` endpoint; `FarmFieldsMap.tsx`.

**Status.** Solid. New registry rows keep their existing `imk_id` where a
2026 field overlaps ≥50% with the current one, so saved farm fields aren't
orphaned.

**Shortcuts.** None.

**Contract changes.**
- New dependency: `rasterio` (pixel-weighted zonal mean for the retention
  raster).
- Database migration: drops `registry_field.soil_id`; adds `markblok`,
  `journalnr`, `oeko`, `oestoette`, `hoejeste_hnv`,
  `omlaegningsplan_virkemiddel`, `omlaegningsplan_status`.
- `CreateFieldInput`/`FieldRecord`/`RegistryField` no longer carry a
  soil (SAND/CLAY) value.
- `in_takeout_plan` changed from boolean to text (the MARS virkemiddel name,
  or `"nej"`) — includes a data migration for already-saved `FieldRecord`
  JSONB blobs that still held the old boolean.
- Also fixed in this same change: `get_tile()` was opening a second pooled
  DB connection and deserializing every field (including geometry) just to
  read owned ids, which was exhausting the connection pool and making
  "Tilføj marker" very slow while panning.

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

**Why.** Surfaces udvaskning/udledning without an extra click. The ton figure went
through two iterations this week (first N-content-based, then utilised-N,
then finally the applied-amount basis above) based on direct user
clarification of what the figure should represent physically.

**Where.** `MetricTile`, the calculation-breakdown components; ton figure in
the same field's `n_inputs`.

**Status.** Solid.

**Shortcuts.** The ton-fertilizer figure is a pure reporting figure with no
effect on any calculation yet — it's groundwork for a later optimisation
parameter (min/max tons of fertilizer used per year).

**Contract changes.** None.

---

## Backend stability: route handlers run synchronously

**What it does.** No user-visible change, but the backend no longer freezes
under concurrent load (several endpoints loading at once, or the map firing
many tile requests while panning).

**Why.** Every route handler was declared `async def` but did blocking
SQLAlchemy/psycopg work with no `await`. FastAPI only offloads blocking work
to its thread pool for plain `def` handlers — an `async def` route with no
`await` runs its DB round-trip directly on the shared event loop, blocking
every other request for its duration.

**Where.** All route handlers, now plain `def`. Connection pool bumped from
5+10 to 10+20 in `db.py`.

**Status.** Solid.

**Shortcuts.** None.

**Contract changes.** None (internal fix only).

---

## New simulations start in 2027

**What it does.** New scenarios compute their 8-year rotation window against
2027–2034 instead of 2024–2031.

**Why.** Keeps the planning window current.

**Where.** `START_CALENDAR_YEAR` / `ROTATION_START_CALENDAR_YEAR` and their
mirrored fallback defaults (`bridge_v2`, `engine.py`, `RotationYearsDetail`).

**Status.** Solid.

**Shortcuts.** The year is a constant, not derived from the current date —
it'll need bumping again by hand next year.

**Contract changes.** None.

---

## Not worth keeping

Nothing from this stretch of work was discarded — everything above is
intended for the port. The one thing worth flagging as *iteration, not
final*: the ton-fertilizer figure changed basis twice (see the "Nøgletal and
ton-fertilizer display" entry above) before landing on the applied-amount
version. Only that final version needs porting.
