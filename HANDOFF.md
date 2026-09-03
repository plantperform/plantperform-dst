# Handoff — week of 2026-09-03

## Mellemafgrøde and tidlig såning were computing zero leaching benefit — now fixed

**What it does.** Mellemafgrøder (catch crops) and tidligt såede vinterafgrøder
(early-sown winter crops) now actually reduce udvaskning by 20% each, as the
law requires. Efterafgrøde sown into majshelsæd (whole-crop maize) gets its
own, lower 10% rate instead of the usual 45%.

**Why.** This was found, not requested: the user shared the full høringsmateriale
(hearing documents) for the 2027 udledningsbaseret markregulering and asked for
a cross-check against what's implemented. `bridge_v2.py`'s leaching formula had
`EMA` and `ETS` hardcoded to `0.0` regardless of whether a mellemafgrøde or
tidlig-såning udlægskode was actually present on that rotation position — so
choosing either virkemiddel had **no effect on calculated udvaskning at all**,
silently, since NLES5 launch. The real values (20%/20%) come straight from the
draft bekendtgørelse, Bilag 1, §48 stk. 3 and §49 stk. 3. The majshelsæd rate
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
"Afgrødehistorik", to better describe what it actually shows.

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
intended for the port. Two things worth flagging as *iteration, not final*:

- The ton-fertilizer figure changed basis twice (see "Nøgretal and
  ton-fertilizer display" above) before landing on the applied-amount
  version. Only that final version needs porting.
- The præcisionsjordbrug price went through three candidate figures (40, 70,
  50 kr/ha) from different SKH source documents before settling on 50 kr as
  an explicit placeholder — see that entry's Shortcuts. Only 50 kr is in the
  code; the other two were never implemented.
