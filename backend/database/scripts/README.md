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

Kommandoen kører migrationer og derefter de otte loaders i rækkefølgen nedenfor.
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
| 2 | `pixi run load-registry-from-merged-gpkg` | [load_registry_from_merged_gpkg.py](load_registry_from_merged_gpkg.py) | `V1_1_IMK2026_n604144_gpkg_merged.gpkg`, lag `PlantPerform` | Erstatter `registry_field` med geometri, mark-id’er, afgrødehistorik og de øvrige markdata fra den sammenlagte kilde. Tilføjer historiske afgrødekoder til `afgroede`. |
| 3 | `pixi run load-kystvandoplande` | [load_kystvandoplande.py](load_kystvandoplande.py) | `ANGJ-data/Marker 24-25-25/Kystvandoplande/Kystvandoplande_VP3_II_2025.shp` samt `.shx`, `.dbf`, `.prj` og `.cpg` med samme filnavn | Opdaterer `registry_field.kystvand_id` og `kystvand_navn` efter størst arealoverlap. |
| 4 | `pixi run load-mars-projekter` | [load_mars_projekter.py](load_mars_projekter.py) | `ANGJ-data/Marker 24-25-25/Mars_data.gpkg`, lag `marsprojekter_samlet` | Erstatter `mars_projekt` og opdaterer markernes `omlaegningsplan_virkemiddel`, `omlaegningsplan_status` og `in_takeout_plan` efter overlap. |
| 5 | `pixi run load-historisk-goedningsfordeling` | [load_historisk_goedningsfordeling.py](load_historisk_goedningsfordeling.py) | `ANGJ-data/Historisk_goedningsfordeling_2025_og_2026_bilag3_lookup.csv` | Erstatter `historisk_goedningsfordeling`: mineralsk og organisk N-input pr. region, driftsform, afgrøde og JB-nr. |
| 6 | `pixi run load-saedskifte-lookup` | [load_saedskifte_lookup.py](load_saedskifte_lookup.py) | `ANGJ-data/Ny_sædskifte_lookup_sammenlagt.csv` | Erstatter `saedskifte_rotation` og `saedskifte_category`. |
| 7 | `pixi run load-afgroeder` | [load_afgroeder.py](load_afgroeder.py) | `ANGJ-data/Afgroedetabel2027_master.csv`; `V1_1_IMK2026_n604144_gpkg_merged.gpkg` bruges også, hvis den findes, til historiske afgrødenavne | Erstatter `afgroede`, `afgroede_norm_lookup` og `afgroede_nfix_lookup`, inkl. NUAR, afstrømningskategorier og permanente afgrødekoder. Læser også historiske koder fra `registry_field.crop_history`. |
| 8 | `pixi run load-oekonomital-afgroedebundet` | [load_oekonomital_afgroedebundet.py](load_oekonomital_afgroedebundet.py) | `ANGJ-data/Oekonomital_afgroedebundet.csv` | Erstatter `salgspris`, `halmudbytte`, `arbejdsmaengde` og `dyrkningsomkostning`. |
| 9 | `pixi run load-oekonomital-generelle-satser` | [load_oekonomital_generelle_satser.py](load_oekonomital_generelle_satser.py) | `ANGJ-data/Oekonomital_generelle_satser.csv` | Erstatter `arbejdssats` og `prisliste`. |
