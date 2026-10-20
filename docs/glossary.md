# Glossary

Danish domain terms and the English names used for them in the frontend code.
UI text stays Danish. Identifiers, types, props, file names and comments are
English. The backend still sends and expects the Danish field names, so
`frontend/src/api/wire.ts` renames the keys on the way in and out. The "API
field" column is the name on the wire.

## Farm and fields

| Danish term | English name in code | API field | Note |
| --- | --- | --- | --- |
| bedrift | `Farm`, farm | | |
| mark | `FieldRecord`, `FieldPanel`, field | | |
| markblok | `fieldBlock` | `markblok` | |
| journalnummer | `journalNumber` | `journalnr` | |
| marknr | `fieldNumber` | `marknr` | The registry's number, e.g. "1-0" |
| IMK | `imkId` | `imkId` | Internet Markkort, kept as an acronym |
| areal | `areaHa` | `areaHa` | |
| driftsform | `farmingSystem`, `FarmingSystemSwitch` | `driftsform`, `farmingSystem` | Values stay Konventionel and Økologisk |
| dyrkningssystem | `croppingSystem` | `dyrkningssystem` | |
| landmand, konsulent | `farmer`, `advisor` | | `OnboardingRole`; old stored Danish values are still read |
| Din konto | account, `AccountButton` | | The signed-in user's details in a panel opened from the bar |
| fornavn, efternavn | `firstName`, `lastName` | | `UserName`; kept in the browser until the backend stores a name on the user |
| Om bedriften | `FarmAboutPage`, about | | The farm's details, who has access to it, and deleting it |
| Bedriften (gruppe i sidepanelet) | farm group, `farmGroupOpen` | | Økonomi and Om bedriften in the sidebar, which can be minimised |
| adgang (til en bedrift eller profil) | access, `FarmMember`, `MemberList`, `useMemberAccess` | | The users a farm or a profile is shared with |
| kvittering | toast, `useToast` | | The short message at the bottom after an action |

## Catchments and quota

| Danish term | English name in code | API field | Note |
| --- | --- | --- | --- |
| kystvandopland | catchment | | |
| kystvand-id, -navn | `catchmentId`, `catchmentName` | `kystvandId`, `kystvandNavn` | |
| vandopland (farvelæg) | `catchment` colour attribute | | |
| udledning | `nLoad` | | N reaching the coastal water, kg N |
| udledningskvote, mark | `nLoadQuotaKgN` | `udledningskvoteMarkKgn` | |
| udledningskvote, opland | `totalNLoadQuotaKgN` | `udledningskvoteKgN` | |
| beregnet udledning | `calculatedNLoadKgN` | `beregnetUdledningKgN` | |
| overholder | `withinQuota` | `overholder` | |
| kvoten under pres | quota pressure | | How close a farm's catchments are to their quota; orders the farm list |
| udledningsgrænse | `nLoadLimitKgNHa` | `udledningsgraenseKgnHa` | |
| udledningsloft | `maxNLoadByCatchment` | `maxNLoadByKystvandopland` | |
| kvotegivende | `quotaEligible` | `kvotegivende` | |
| opslag i markregistret | registry lookup, `summarizeLookup` | | The marker found for a CVR before the farm is created, summed per kystvandopland |
| retention | `retention` | `retention` | Share held back, 0 to 1 |
| udvaskning | `leaching` | | Nitrate leaving the root zone |

## Crops and rotations

| Danish term | English name in code | API field | Note |
| --- | --- | --- | --- |
| afgrøde | crop | | |
| afgrødevalg, valgte og fravalgte afgrøder | `CropChoice`, `chosenCrops`, `optedOutCrops`, `CropChoicePicker` | | The Afgrøder step in Ny simulering. Sædskifter then shows the rotations with at least one chosen crop and no opted-out one. Not saved on the simulation, and unlike `excludedCropCodes` under Grænser it does not reach the optimization |
| afgrødekode, -navn | `cropCode`, `cropName`, `CropCodeOption` | `afgrodeKode`, `afgrodeNavn` | |
| normal såmåned | sowing month | | The crop table's month the crop is normally sown, stored as `afgroede.saamaaned` |
| efterårssået | autumn-sown, `is_autumn_sown`, `AUTUMN_SOWING_MONTHS` | | Normal såmåned August to November |
| afgrødegruppe | `CropGroup`, `classifyCrop`, `cropGroupFor` | | The groups the map, the year strip and the crop distribution colour by |
| helsæd | `wholeCropSilage` | | Crop group for cereals and peas harvested whole for silage, and grønkorn blends. Majshelsæd counts as Majs |
| afgrødefordeling | `CropShare`, `CropShareLevel`, `summarizeCropDistribution` | | Area and N load per crop group or per crop for a year, or the average per year |
| afgrødearealkrav | `CropAreaLimit`, `cropAreaLimits`, `minAreaHa`, `maxAreaHa`, `CropAreaViolation`, `CropAreaRange` | `cropAreaLimits`, `minAreaHa`, `maxAreaHa`, `cropAreaViolations`, `crop-area-ranges` | Min. and/or max. hectares of one afgrødekode under Regler; percent is of the simulation's total area |
| udlæg | `undersownCropCode`, `undersownCropName`, `undersownCropSet` | `udlaegKode`, `udlaegNavn`, `udlaegSet` | |
| efterafgrøde | catch crop | | EEA in formula names |
| pligtig, målrettet efterafgrøde | mandatory, targeted catch crop | | |
| sekundær afgrøde | secondary crop | | The GeoPackage's `SekAfg<year>` columns |
| mellemafgrøde | `intermediateCrop` | `mellemafgrode` | |
| mellemafgrøde eller tidlig såning | `intermediateOrEarlySowing`, `INTERMEDIATE_OR_EARLY_SOWING`, `isIntermediateOrEarlySowingYear` | `mellemafgroede_eller_tidlig_saaning` | A history year whose reported catch crop came before an autumn-sown crop: one of the two, which the source does not say; drawn split down the middle in the colours of both |
| vinterdække | `WinterCoverKind`, `YearCover`, `rotationCovers`, `WinterCoverBand` | | What covers the soil after harvest: `cropCover` (plantedække), `stubble` or `bareSoil`, shown per year together with `catchCrop`, `intermediateCrop` and `earlySowing` |
| stubmark | `stubble` | | W=5 in NLES5: stubble left with weeds and volunteer grain |
| bar jord | `bareSoil` | | W=2 and W=3 in NLES5 |
| forfrugtsværdi | `precedingCropValueKgNHa` | `forfrugtsvaerdiKgnHa` | |
| regn forfrugtsværdien med | `includePrecedingCropValue` | `medregnForfrugtsvaerdi` | Proposed field; the backend does not read it yet |
| indregn forfrugtsværdi (indregn_ffv) | `deducts_preceding_crop_value` | | Backend. Ja or Nej per crop in the master table. Nej for grass, seed grass, clover, lucerne and other perennial crops, which get no forfrugtsværdi deducted |
| sædskifte | rotation, `cropRotation`, `rotations` | `saedskifter` | |
| sædskiftevariant | `rotationVariant`, `rotationVariants`, `allowedRotationVariants` | `saedskiftevariant`, `rotationSaedskiftevarianter`, `saedskiftevarianter` | |
| antal sædskifter | `rotationCount` | `antalSaedskifter` | |
| kategori | `category` | `kategori` | |
| N-norm | `nNormPct`, `nNormPercentages`, `allowedNNormPercentages` | `nNormPct`, `rotationNNormProcenter`, `nNormProcenter` | |
| afgrødenorm | `cropNormKgNHa` | `afgrodeNormKgnHa` | |
| reduceret norm | `reducedNorm` | | |
| låst sædskifte | locked rotation | `allowedRotationIds` | |

## Measures

| Danish term | English name in code | API field | Note |
| --- | --- | --- | --- |
| virkemiddel | measure | `virkemiddel` | MARS tile property |
| tilskudsordning | `subsidyScheme` | `tilskudsordning` | MARS tile property |
| præcisionsjordbrug | `precisionFarming` | `praecisionsjordbrug` | |
| tidlig såning | `earlySowing` | `tidligSaaning` | |
| F-dato for efterafgrøde | `catchCropSowingDate`, `sowingDate` | `eeaFdato` | |
| dagsbasis | `catchCropDailyBasis` | `eeaPrecisionDagsbasis` | |

## Fertiliser

| Danish term | English name in code | API field | Note |
| --- | --- | --- | --- |
| gødning | `fertiliser`, `FertiliserSettings` | `godning` | |
| gødningstyper | `fertiliserPresets`, `useFertiliserPresets` | | |
| brugerdefineret | `'custom'` fertiliser choice | | |
| mineralsk andel | `mineralSharePct` | `mineralskAndelPct` | |
| N-indhold pr. ton | `nContentKgPerTon` | `nIndholdKgPerTon` | |
| tildelt husdyrgødning, udnyttet | `appliedManureUtilisedKgNHa`, `manureUtilisedKgNHa` | `tildeltHusdyrgodningUdnyttetKgnHa` | Shown as "Org. gødning" in the Gødning columns |
| tildelt handelsgødning | `appliedMineralFertiliserKgNHa`, `mineralFertiliserKgNHa` | `tildeltHandelsgodningKgnHa` | |
| tilgængeligt N | `availableNKgNHa`, `availableNShareOfNorm` | | Forfrugtsværdi plus the tildelt N that counts toward the norm |
| gødningsoverblik | `FertiliserFigures`, `fieldFertiliser`, `fertiliserByFieldId` | | The Gødning column group in the mark list, per year or the average per year |
| organisk bundet | `manureOrganicBoundKgNHa` | `husdyrgodningOrganiskBundetKgnHa` | |
| ton husdyrgødning pr. ha | `manureTonsPerHa` | `husdyrgodningTonPrHa` | |

## Economics

| Danish term | English name in code | API field | Note |
| --- | --- | --- | --- |
| dækningsbidrag | `db2`, `dbDkkHa`, `avgDbDkkHa` | `db2`, `dbKrHa`, `avgDbKrHa` | DB2 kept as an acronym |
| kr | `Dkk` suffix, `formatCompactDkk` | | |
| udbytte | `yieldAmount` | `udbytte` | |
| udbytteenhed | `yieldUnit` | `udbytteenhed` | |
| manglende udbyttenorm | `yieldNormMissing` | `udbyttenorm_mangler` | |
| udbytterespons | `hasYieldResponse` | `udbytterespons` | Whether the crop has a yield-response curve for N below the norm, for the simulation's driftsform |
| udbyttefaktor | `yieldFactor` | `udbytte_faktor` | Share of the normudbytte reached with the available N |
| foderenheder (FEN) | `feedUnits`, `minFeedUnits`, `maxFeedUnits`, `totalFeedUnits`, `avgFeedUnits`, `isFodderCrop` | `fen`, `minFen`, `maxFen`, `totalFen`, `avgFen` | |
| salgspris | `salePrice` | `salgspris` | |
| indtægt | `revenue` | `indtaegt` | |
| tilskud | `subsidy` | `tilskud` | |
| gødning, omkostning | `fertiliserCost` | `goedning` | |
| udsæd | `seed` | `udsaed` | |
| planteværn | `cropProtection` | `plantevaern` | |
| markarbejde | `fieldWork` | `markarbejde` | |
| tørring | `drying` | `toerring` | |
| omkostninger i alt | `totalCosts` | `omkostninger_total` | |
| omkostningslinjer | `lines`, `CostLine`, `treatment`, `costDkkHa` | `linjer`, `behandling`, `udgift_kr_ha` | |
| økonomiforudsætninger | `EconomicsAssumptions`, `CropEconomics`, `EconomicsLine` | | The standard prices and quantities behind dækningsbidraget, per crop |
| bedriftens afgrødebudgetter | `useFarmBudgets`, `BudgetScope`, `useEconomicsAssumptions` | | The standard budget of each crop on the farm, row by row, from the backend |
| gødning, andre gødningsstoffer, udsæd, planteværn, markarbejde, tørring/lagring | `fertiliser`, `otherFertilisers`, `seed`, `cropProtection`, `fieldWork`, `drying` (`CostCategory`) | `category` | The cost groups of a crop |
| stykpris | `UnitPrice`, `priceId` | `priceId` | Price per unit, e.g. kr/gang or kr/kg |
| kilde | `source`, `cropSources` | `source` | Where a price comes from, e.g. SEGES Budgetkalkuler 2026 |
| mængde | `quantity`, `quantityUnit`, `quantityId` | `quantityId` | Per hectare, e.g. 3 sprøjtninger |
| følger udbyttet | `followsYield` | `followsYield` | Revenue and drying, which the yield percentage scales |
| salgspris | `saleLine` | | The first revenue line of a crop |
| fælles pris | shared price, `priceCrops` | | A price used by several crops, e.g. Pløjning med pakning |
| pris eller mængde, der afhænger af jordtypen | `soilVariants` | `soilVariants` | A work rate or work quantity with a value per soil group; a change sets them all |
| økonomiprofil | `EconomicsProfile`, `economicsProfileId`, `EconomicsModule` | `economicsModuleId` | A user's named set of changes on top of Standard, stored as an economics module that its members can use on all their farms |
| dele en profil | `EconomicsProfileShareButton`, `addEconomicsModuleMember`, `removeEconomicsModuleMember` | `members` | Gives another user the profile; everyone who has it can edit, share and delete it |
| forlade en profil | `describeLeaveProfile`, `onLeave` | | Removes yourself from a profile shared with you; the others keep it |
| har også økonomiprofilen | `memberProfileNames`, `memberProfilesLabel` | | Under Adgang: the farm's profiles that another member also has |
| profilen tallene er regnet med | `appliedProfile`, `EconomicsSnapshot` | `economicsSnapshot` | The profile a simulation's figures use until it is recalculated |
| genberegn økonomi | `recalculate`, `isEconomicsCurrent` | | Prices a simulation with its chosen profile without optimizing again |
| genberegningen fejlede | `economicsRecalculationFailed` | `economicsRecalculationFailed` | A failed recalculation that can be retried |
| Standard (SEGES 2026) | `STANDARD_PROFILE`, `STANDARD_SOURCE` | | The profile without changes |
| tilpasset | customised, `EconomicsOverrides` | | The profile's own value instead of the standard |
| udbytte i forhold til normen | `yieldPct` | | Percent on top of each field's own yield for a crop |
| ændring i forhold til Standard | `ProfileChange` | | One changed yield, price or quantity in a profile |
| profilens virkning i en simulering | `SimulationEconomicsEffect`, `simulationEconomicsEffect` | | A profile's change in dækningsbidrag for the crops a simulation grows, weighted by each crop's average area per year |
| Tilpas økonomien til bedriften | the guide, `EconomicsGuidePage` | | |
| sådan er tallene beregnet | breakdown, `BreakdownRow` | | The calculation under a field |

## Soil and calculation

| Danish term | English name in code | API field | Note |
| --- | --- | --- | --- |
| JB-nummer | `soilTypeNumber` | `jbnr`, `jbNr` | JB kept in names like `JB_COLORS` |
| lerprocent | clay percentage, `CLAY_PCT_BY_JB` | | Bilag 2, table 14; gives S in NLES5 |
| perkolationsværdi | percolation value | | P in NLES5, one per runoff category |
| organisk kvælstof i overjorden | organic N in the topsoil | | NT in NLES5 |
| afstrømningskategori | `runoffCategory`, `runoffCategoryUnknown`, `runoffWinterCover` | `afstromningskategori`, `afstromningskategori_ukendt`, `afstromning_vinterdaekke` | |
| efterafgrødens N-fiksering | `catchCropNFixation`, `catchCropNFixationBonus` | `efterafgroede_nfiks`, `efterafgroede_nfiks_bonus` | |
| Fmajs-korrektion | `fmajsApplied`, `fmajsCorrectionFactor`, `fmajsMineralN` | `Fmajs_anvendt`, `Fmajs_korrektionsfaktor`, `Fmajs_mineralsk_n` | Maize after clover grass |
| simulering | `Simulation`, simulation | | |
| scenarie | scenario | | |
| regler | rules, `SimulationRulesPanel`, `FieldRulesCard` | | Limits and locked fields a simulation's optimization must keep |
| simuleringens grundlag | basis, `SimulationBasisCard` | | Editable saved settings used to calculate candidates during optimization |
| beregning | calculation | | |
| årsgennemgang | `YearWalkthrough` | | |

## Kept as they are

- Acronyms: IMK, JB, CVR, DB2, NLES5, NUAR, MARS, EEA.
- NLES5 formula symbols in the calculation detail, such as M, W, MP, WP, NT,
  `L_nuar`, `Fdato_factor`, EEA, EMA, ETS and EPJ. They mirror the model.
- UI text, and the Danish values the backend expects, such as Konventionel,
  Økologisk and crop names.
- Backend URL paths, and registry and MARS tile properties such as
  `kystvand_id`, `jbnr`, `marknr`, `udledningsgraense_kgn_ha`, `kvotegivende`,
  `virkemiddel`, `tilskudsordning` and `areal_ha`. They are read as data.
- localStorage and sessionStorage keys, so stored preferences survive.

## Naming rules

- Units go at the end: `KgN`, `KgNHa`, `Ha`, `Pct`, `PerHa`, `Dkk`.
- Percent values end in `Pct`. Ratios from 0 to 1 have no suffix.
- Routes, DOM ids and anchors are English, for example `/farms/:farmId/about` and `about-access`.
- A new backend field with a Danish name gets an entry in `api/wire.ts` and in
  this glossary in the same commit.
