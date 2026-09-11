# Handoff — week of 2026-09-11

Note for whoever picks this up: this is the first handoff from `ANGJ-branch`,
which is taking over the prototype-branch role from `new-engine` going
forward (some commits may still be pulled from `new-engine`, but it will not
be developed further). This handoff is against `dev`, not `master` — `dev`
is the current integration branch; `master`'s history looks stale/unrelated.

## Historical afgrødekoder no longer block "Tilføj marker"

**What it does.** A mark whose `crop_history` (2016-2026) includes certain
older or administrative afgrødekoder can now actually be added to a bedrift.
Before this, "Tilføj marker" would fail outright for any mark that had ever
carried one of these codes in any year, with no indication of which year or
code was the problem.

**Why.** Chasing down why afgrødekode 343 ("MFO-bestøverbrak") had no
udvasknings-kategori led to checking the whole of
`Bilag_1_tabel_1_med_P_noegle.csv` (Bilag 7, tabel 1) against every
afgrødekode that actually occurs in the real markdata
(`V1_1_IMK2026_n604144_gpkg_merged.gpkg`, all `Afg2016`..`Afg2026` columns).
**45 codes** occur in real crop history but are missing from the P-nøgle
table. Most are MFO-varianter of codes that already exist (325
MFO-Blomsterbrak, 602-606 MFO-tree codes, etc.) or otherwise-obscure
historic codes; three (0, 995 "Slettet mark", 997 "Ikke kontrolleret
afgrøde") are not real crops at all. Whenever a mark's history touched any
of these 45, the leaching calculation raised `MissingSoilDataError` and
blocked the *entire* "Tilføj marker" call — reported to the user as a
generic "mangler jorddata" error, even though the real cause was a missing
crop-category lookup, not missing P/S/Nt soil measurements.

**Where.**
- `backend/database/data/raw/ANGJ-data/Bilag_1_tabel_1_med_P_noegle.csv` —
  42 of the 45 missing codes added, each tagged in a new `Kilde` column as
  `Bekendtgørelse` (the original 323 rows) or `Historisk afgrødekode (bud) -
  <begrundelse>` (added this week, with the reasoning for the guessed
  value). Values were pattern-matched from the existing table, not looked up
  in the regulation text — e.g. every brak/bræmme/permanent-græs/tree code
  in the table is `Græs`/kategori 2 with no exception, and every potato
  variant is `Kartofler - bar jord`/kategori 7, so the same category was
  assigned to each code's closest analogue (343 "MFO-bestøverbrak" got 342
  "Bestøverbrak"'s value, etc.).
- `backend/src/app/services/nles5/bridge_v2.py`
  (`evaluate_leaching_position`) — for the 3 codes deliberately left out of
  the CSV (0, 995, 997 — there is no safe crop-category guess for them), the
  position's leaching is now reported as `0` kg N/ha with
  `afstromningskategori_ukendt: true` instead of raising. A genuinely
  missing P/S/Nt soil measurement still raises `MissingSoilDataError` as
  before — only the "unknown crop code" case was blocking incorrectly.
- `backend/tests/test_registry_soil_data.py` — new test
  (`test_unknown_category_reports_zero_instead_of_blocking`) locks in the
  0/ukendt behaviour.

**Status.** Solid. Verified end-to-end against the live app: logged in,
added a mark whose `crop_history` includes code 995 ("Slettet mark") via the
running API — this reproduced the originally-reported bug before the fix and
succeeds after it, with the affected position's leaching correctly reported
as 0/ukendt.

**Shortcuts.** The 42 added CSV values are *pattern-matched guesses*, not
sourced from Bekendtgørelsens Bilag 7 tabel 1 itself — that's exactly what
the `Kilde` column is for, so they're trivial to find and replace with
authoritative values later. Of those 42, most follow an unambiguous pattern
(MFO-variant of an existing code, or the same "family" of brak/bræmme/
permanent græs which is uniformly Græs/kategori 2 in the existing table), but
a handful have no clean analogue and are flagged as lower-confidence in the
`Kilde` text — worth a second look: kode 360 "Vildtafgrøder" and 968
"Efterafgrøder, pligtige, husdyr, målrettede".

**Contract changes.** None to any API shape. The CSV lives under
`backend/database/data/raw/`, which is gitignored (too large / regenerated
from source), so **this diff does not carry the data change** — the updated
CSV needs to reach whoever integrates this separately (I prepared a
`DataV.2.zip` for that), and `pixi run load-afstromningskategorier` needs to
be re-run against it to update the database.

**Open questions.**
- The crop *name* shown in the UI for these codes (e.g. in `cropRotation`)
  still reads "Ukendt", because `afgroede_normer.lookup_crop_params` reads
  from the separate NUAR-koder table (sourced from the master
  afgrødenormer-workbook), which was **not** touched this week. Worth
  deciding whether to extend that workbook with the same codes too, or leave
  the name as "Ukendt" since the leaching/P-nøgle side is what actually
  mattered for the bug.

