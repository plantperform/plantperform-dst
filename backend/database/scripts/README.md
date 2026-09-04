# Kortdata: kilder, metode og kørselsrækkefølge

Dette dokumenterer 2026-registreringen af `registry_field` (og det separate
`mars_projekt`-lag), bygget 2026-08-27. Erstatter den gamle
`load_registry.py`-pipeline (2023 IMK-geopackage), som er efterladt urørt
som reference men ikke længere køres.

**Data-vintage:** denne version bruger den nyeste `ANGJ-data`, uploadet
2026-08-28 — inkl. `Historisk_goedningsfordeling_2025_og_2026_bilag3_lookup.csv`
(historisk gødningstildeling), `Bilag_1_tabel_1_Kvotegivende_areal_og_
aktivitet.csv` (kvotegivende areal) og `DataIMK2023_DataPlantPerform_
n609506_gpkg.gpkg` (2017-2023 crop_history-historik, overlap-matchet ind i
2026-registreringen). `goedningsregion` er tildelt via centrum-i-region mod
`Marker 24-25-25/Goedningsregioner_midlertidig.gpkg` (se
[migrations/versions/20260828_0002_registry_field_goedningsregion.py]
(../migrations/versions/20260828_0002_registry_field_goedningsregion.py))
— gjort ad hoc, ikke som et genkørbart script; kontakt Anders hvis
tildelingen skal genskabes fra bunden.

## Hvor ligger data?

Der findes ingen "endelig fil" — resultatet er selve `registry_field`- og
`mars_projekt`-tabellerne i Postgres-databasen. Kildefilerne ligger i
`backend/database/data/raw/ANGJ-data/` og er **git-ignorerede** (for store,
og databasen genereres fra dem). For at give andre adgang til det samme
data, del enten:

- **Kildefilerne** (`ANGJ-data`-mappen, uden om git) + kør scripts'ene
  forfra, eller
- **En database-dump** (`pg_dump`) af de to tabeller, hvis modtageren bare
  skal bruge appen uden selv at genberegne noget.

## Kørselsrækkefølge

```
pixi run db-migrate
pixi run load-dataimk2026       # basis: geometri, id'er, crop_history
pixi run load-jordbundskort     # jbnr
pixi run load-kystvandoplande   # kystvand_id
pixi run load-retentionskort    # retention
pixi run load-udledningsgraenser
pixi run load-oekologi-hnv      # oeko, oestoette, hoejeste_hnv
pixi run load-mars-projekter    # mars_projekt-tabel + omlaegningsplan_*/in_takeout_plan
```

`load_dataimk2026.py` skal køre først (den genopbygger `registry_field` fra
bunden); resten er uafhængige af hinanden og kan køres i vilkårlig
rækkefølge efter den.

## Scripts

### `load_dataimk2026.py` — basisdata
**Kilde:** `Marker 24-25-25/Marker_2024/2025/2026.shp` (PlantPerform-native
Afgkode).
**Metode:**
- Ny geometri/id'er fra 2026-laget. `imk_id` genbruges fra det nuværende
  register hvor et 2026-felt overlapper ≥50 % med en eksisterende mark
  (størst overlap vinder ved konflikt); resten får nye, fortløbende id'er.
- `crop_history` pr. år: eksakt `(Markblok, Marknr)`-match mod det
  pågældende års lag, geometrisk dominant-overlap som fallback. 2026-huller
  (138 marker) backfilles fra 2025.
- `cvr`, `marknr`, `markblok`, `journalnr`, `area_ha` (IMK_areal) kopieres
  direkte fra 2026-laget.
- Gamle `crop_rotation`-tekstkolonne (Rot_vec-format) sættes til `""` —
  ubrugt af al kørende kode, `crop_history` er nu den reelle datakilde.
- **Dækning:** 604.238 marker. 521.042 (86 %) genbrugte id, 83.196 (14 %)
  nye.

### `load_jordbundskort.py` — `jbnr`
**Kilde:** `Jordbundskort/Jordbundskort_2024.shp` (4,4 mio. polygoner,
`JB_kode`).
**Metode:** dominant-overlap (størst areal-andel vinder).
**Dækning:** 602.707 / 604.238 (99,75 %). De resterende ~1.500 er
overvejende marginaljord under 1 ha (permanent græs, brak, natur,
miljøtiltag) — jordbundskortet dækker ikke fuldt ud denne type areal.

### `load_kystvandoplande.py` — `kystvand_id`
**Kilde:** `Kystvandoplande/Kystvandoplande_VP3_II_2025.shp` (545 polygoner).
**Metode:** dominant-overlap.
**Dækning:** 604.126 / 604.238 (99,98 %).

### `load_retentionskort.py` — `retention`
**Kilde:** `Retentionskort/TotalRetention_regioner_v260327.tif` (100m
raster, procent, EPSG:25832).
**Metode:** ægte pixel-vægtet zonalt gennemsnit (rasterize + numpy
bincount), ikke bin-midtpunkt. Marker der er for små til at ramme et
pixel-centrum (91 % af hullerne er <1 ha) udfyldes bagefter fra den
geometrisk nærmeste mark der fik en rigtig værdi.
**Dækning:** 604.236 / 604.238 (99,9997 %) efter nabo-udfyldning.
Ny dependency: `rasterio`.

### `load_udledningsgraenser.py` — udledningsgrænse
**Kilde:** `Udeledningsdata/Foreloebige_udledningsgraenser_...shp` (2,8 mio.
polygondele, uændret sti/script fra før migreringen).
**Metode:** arealvægtet gennemsnit af overlappende polygonstykker, ganget
med markens fulde `area_ha` (ikke kun det dækkede areal) for kvoten.
**Dækning:** 597.774 / 604.238 (98,9 %). De resterende 6.464 marker uden
overlap er **bevidst efterladt på standardværdien 0** (ikke udfyldt fra
nærmeste nabo — besluttet fravalgt).

### `load_oekologi_hnv.py` — `oeko`, `oestoette`, `hoejeste_hnv`
**Kilder:**
- `Økologiske Arealer/Oekologiske_arealer_2025.shp` (82.973 polygoner)
- `Ø-støtte/O_Stotte.shp` (90 polygoner)
- `HNV_5_13_2025/HNV_5_13_2025.shp` (1,25 mio. polygoner, `HNVscore` 5-13)

**Metode:** ren berøring (`ST_Intersects`, ingen areal-vægtning) for
`oeko`/`oestoette`; MAX(`HNVscore`) blandt alle berørende polygoner for
`hoejeste_hnv`.
**Dækning:** 89.164 økologiske, 19.231 med Ø-støtte, 186.066 med en
HNV-værdi.

### `load_mars_projekter.py` — MARS-projekter
**Kilde:** `Mars_data.gpkg`, lag `marsprojekter_samlet` (1.666 polygoner,
Miljø- og Arealprojekter-tilskudsordninger).
**Metode:**
- Laver hele laget permanent i tabellen `mars_projekt` (geometri +
  alle attributter: titel, virkemiddel, status, tilskudsordning,
  kvælstofeffekt osv.) — serveres som sit eget kortlag via
  `/api/v0/mars/tiles/{z}/{x}/{y}.pbf`, uafhængigt af mark-farvelægningen.
- Sætter `registry_field.omlaegningsplan_virkemiddel` /
  `omlaegningsplan_status`: ren berøring (helt eller delvist overlap); en
  mark der rører flere projekter får alle deres distinkte
  virkemiddel/status-værdier kommasepareret, ordret fra kilden (fx
  "Ekstensivering, Skovrejsning").
- Spejler `virkemiddel`-teksten ind i det allerede eksisterende
  `in_takeout_plan`-felt ("omlægningsplan" i UI'en), som er lavet om fra et
  rent ja/nej-flag til at bære selve teksten (eller `"nej"` hvis ingen
  MARS-projekt) — første-omgangs genbrug af den eksisterende UI-plads
  fremfor at bygge et helt nyt visningskoncept.
**Dækning:** 53.565 marker (8,9 %) rører mindst ét MARS-projekt.

## Domæneændringer i samme omgang

- `registry_field.soil_id` droppet — erstattet af `jbnr` direkte
  (NLES5-motoren bruger allerede jbnr, ikke det grove Sand/Ler-flag).
- `registry_field.in_takeout_plan`: boolean → tekst (se ovenfor).
- Nye kolonner: `markblok`, `journalnr`, `oeko`, `oestoette`, `hoejeste_hnv`,
  `omlaegningsplan_virkemiddel`, `omlaegningsplan_status` — ingen af dem har
  frontend-visning endnu (bevidst fravalgt, kommer senere).
