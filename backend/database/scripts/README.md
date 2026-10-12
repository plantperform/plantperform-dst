# Indlæsning af register- og referencedata

Denne README beskriver kommandoerne i `pixi run load-registry-data`, som er
defineret i [backend/pixi.toml](../../pixi.toml), og hvilke kildefiler de bruger.

Kør alle kommandoer fra `backend/` med en tilgængelig PostgreSQL/PostGIS-database
og `DATABASE_URL` konfigureret i miljøet eller `backend/.env`.
Kildefilerne ligger under `backend/database/data/raw/` og er git-ignorerede.
Backend’en bruger de indlæste databasetabeller under API-kald.

## Komplet genindlæsning

```bash
pixi run load-registry-data
```

Kommandoen kører migrationer og derefter de ni loaders i rækkefølgen nedenfor.
Kæden bruger `&&` og stopper ved første fejl. Allerede gennemførte trin bliver
ikke rullet tilbage; hele indlæsningen er ikke én fælles transaktion.

**Genindlæsningen erstatter hele `registry_field` og referencedataene.**
Registeret bruger GeoPackage-filens egne `IMK_ID`, så gemte bedrifter og
scenarier med gamle id’er kan blive forældreløse. Stop backend’en før
indlæsningen, og start den igen, når alle trin er gennemført.

## Aktuelle kommandoer, scripts og kildefiler

Rådatafilernes stier i tabellen er relative til `backend/database/data/raw/`.
Migrationernes stier er relative til `backend/`.

| Trin | Kommando | Script | Kildefiler | Skriver eller genberegner |
| --- | --- | --- | --- | --- |
| 1 | `pixi run db-migrate` | Alembic | `database/alembic.ini` og `database/migrations/versions/*.py` | Anvender alle migrationer, inkl. tabellerne til de efterfølgende loaders. |
| 2 | `pixi run load-registry-from-merged-gpkg` | [load_registry_from_merged_gpkg.py](load_registry_from_merged_gpkg.py) | `V1_1_IMK2026_n604144_gpkg_merged.gpkg`, lag `PlantPerform` | Erstatter `registry_field` med geometri, mark-id’er, afgrødehistorik og de øvrige markdata fra den sammenlagte kilde. Indlæser de historiske efterafgrøder fra `SekAfg<år>`-kolonnerne som `secondary_crop_history`, hvis GeoPackage’en har dem. Tilføjer historiske afgrødekoder til `afgroede`. |
| 3 | `pixi run load-kystvandoplande` | [load_kystvandoplande.py](load_kystvandoplande.py) | `ANGJ-data/Marker 24-25-25/Kystvandoplande/Kystvandoplande_VP3_II_2025.shp` samt `.shx`, `.dbf`, `.prj` og `.cpg` med samme filnavn | Opdaterer `registry_field.kystvand_id` og `kystvand_navn` efter størst arealoverlap. |
| 4 | `pixi run load-mars-projekter` | [load_mars_projekter.py](load_mars_projekter.py) | `ANGJ-data/Marker 24-25-25/Mars_data.gpkg`, lag `marsprojekter_samlet` | Erstatter `mars_projekt` og opdaterer markernes `omlaegningsplan_virkemiddel`, `omlaegningsplan_status` og `in_takeout_plan` efter overlap. |
| 5 | `pixi run load-historisk-goedningsfordeling` | [load_historisk_goedningsfordeling.py](load_historisk_goedningsfordeling.py) | `ANGJ-data/Historisk_goedningsfordeling_2025_og_2026_bilag3_lookup.csv` | Erstatter `historisk_goedningsfordeling`: mineralsk og organisk N-input pr. region, driftsform, afgrøde og JB-nr. |
| 6 | `pixi run load-saedskifte-lookup` | [load_saedskifte_lookup.py](load_saedskifte_lookup.py) | `ANGJ-data/Ny_sædskifte_lookup_sammenlagt.csv` | Erstatter `saedskifte_rotation` og `saedskifte_category`. |
| 7 | `pixi run load-afgroeder` | [load_afgroeder.py](load_afgroeder.py) | `ANGJ-data/Afgroedetabel2027_master.csv`; `V1_1_IMK2026_n604144_gpkg_merged.gpkg` bruges også, hvis den findes, til historiske afgrødenavne | Erstatter `afgroede`, `afgroede_norm_lookup` og `afgroede_nfix_lookup`, inkl. NUAR, afstrømningskategorier og permanente afgrødekoder. Læser også historiske koder fra `registry_field.crop_history`. |
| 8 | `pixi run load-oekonomital-afgroedebundet` | [load_oekonomital_afgroedebundet.py](load_oekonomital_afgroedebundet.py) | `ANGJ-data/Oekonomital_afgroedebundet.csv` | Erstatter `salgspris`, `halmudbytte`, `arbejdsmaengde` og `dyrkningsomkostning`. |
| 9 | `pixi run load-oekonomital-generelle-satser` | [load_oekonomital_generelle_satser.py](load_oekonomital_generelle_satser.py) | `ANGJ-data/Oekonomital_generelle_satser.csv` | Erstatter `arbejdssats` og `prisliste`. |
| 10 | `pixi run load-kvotegivende-areal` | [load_kvotegivende_areal.py](load_kvotegivende_areal.py) | `ANGJ-data/Afgroedetabel2027_master.csv` | Opdaterer `registry_field.kvotegivende` ud fra markens 2026-afgrøde og masterens `kvotegivende_areal`, og nulstiller `udledningskvote_mark_kgn` for ikke-kvotegivende arealer (skov, natur, miljøtilsagn). GeoPackage-filens eget flag er tomt for ca. 17.500 marker og mangler nyere afgrødekoder, så trinnet skal køre efter trin 2. |

## Kortdata i GeoPackage’en

Retention, organisk kvælstof i overjorden (NT), perkolation (P) og
jordbundseffekt (S) i den sammenlagte GeoPackage beregnes fra de officielle
kort efter bekendtgørelsen om udledningsbaseret markregulering for 2027, og
historiske efterafgrøder lægges ind som sekundær afgrøde. Kør scripts, hver
gang GeoPackage’en eller en af kilderne udskiftes, og før
`pixi run load-registry-data`:

```bash
pixi run load-retentionskort
pixi run load-nles5-soil-inputs
pixi run load-catch-crop-history
```

Alle scripts overskriver kolonnerne for alle marker direkte i GeoPackage-filen.
Tag en kopi af filen først, hvis de gamle værdier skal kunne genskabes. Kortene
ligger i `ANGJ-data/Udeledningsdata/UMR_2027/` samt `.shx`, `.dbf`, `.prj` og
`.cpg` med samme filnavn.

| Script | Kilde | Skriver |
| --- | --- | --- |
| [load_retentionskort.py](load_retentionskort.py) | `Kvaelstofretention_UMR_2027.shp` | `RetTot`: arealvægtet gennemsnit over markens overlap, afrundet til 2 decimaler (§ 13, stk. 3; PUMR-kravspec felt A22). Marker uden overlap får en tom værdi. |
| [load_nles5_soil_inputs.py](load_nles5_soil_inputs.py) | `Organisk kvaelstof i overjorden 2027.shp`, `Afstroemningsvaerdier 2027.shp` | `orgNtopsoil2024` og de otte `P_*`-kolonner: den værdi, der dækker den største del af marken (§ 29, stk. 6 og § 32, stk. 3). Kortenes 0 betyder ingen data og tæller ikke med; en mark helt uden data får en tom værdi og markeres som `banned` ved indlæsning. `S_soil2024`: exp(−0,001849 · lerprocent) for `JB_Kode` efter bilag 2, tabel 14. |
| [load_catch_crop_history.py](load_catch_crop_history.py) | `ANGJ-data/Marker 24-25-25/Efterafgrøde_historik/Efterafgrøder 2024-2026.zip` (markkort med pligtige og målrettede efterafgrøder pr. år) | Tilføjer `SekAfg2024`–`SekAfg2026`: afgrødekode 968, når efterafgrødemarker dækker mindst 90 % af marken, ellers en tom værdi. `load-registry-from-merged-gpkg` indlæser dem som `registry_field.secondary_crop_history`. |
