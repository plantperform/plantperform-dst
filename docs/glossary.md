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
| driftsform | `farmingSystem` | `driftsform` | Values stay Konventionel and Økologisk |
| dyrkningssystem | `croppingSystem` | `dyrkningssystem` | |
| landmand, konsulent | `farmer`, `advisor` | | `OnboardingRole`; old stored Danish values are still read |

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
| udledningsgrænse | `nLoadLimitKgNHa` | `udledningsgraenseKgnHa` | |
| udledningsloft | `maxNLoadByCatchment` | `maxNLoadByKystvandopland` | |
| kvotegivende | `quotaEligible` | `kvotegivende` | |
| retention | `retention` | `retention` | Share held back, 0 to 1 |
| udvaskning | `leaching` | | Nitrate leaving the root zone |

## Crops and rotations

| Danish term | English name in code | API field | Note |
| --- | --- | --- | --- |
| afgrøde | crop | | |
| afgrødekode, -navn | `cropCode`, `cropName`, `CropCodeOption` | `afgrodeKode`, `afgrodeNavn` | |
| afgrødegruppe | `CropGroup`, `classifyCrop`, `cropGroupFor` | | The groups the map, the year strip and the crop distribution colour by |
| afgrødefordeling | `CropShare`, `summarizeCropDistribution` | | Area and N load per crop group for a year, or the average per year |
| udlæg | `undersownCropCode`, `undersownCropName` | `udlaegKode`, `udlaegNavn` | |
| efterafgrøde | catch crop | | EEA in formula names |
| mellemafgrøde | `intermediateCrop` | `mellemafgrode` | |
| forfrugtsværdi | `precedingCropValueKgNHa` | `forfrugtsvaerdiKgnHa` | |
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
| tildelt husdyrgødning, udnyttet | `appliedManureUtilisedKgNHa` | `tildeltHusdyrgodningUdnyttetKgnHa` | |
| tildelt handelsgødning | `appliedMineralFertiliserKgNHa` | `tildeltHandelsgodningKgnHa` | |
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

## Soil and calculation

| Danish term | English name in code | API field | Note |
| --- | --- | --- | --- |
| JB-nummer | `soilTypeNumber` | `jbnr` | JB kept in names like `JB_COLORS` |
| afstrømningskategori | `runoffCategory`, `runoffCategoryUnknown` | `afstromningskategori`, `afstromningskategori_ukendt` | |
| efterafgrødens N-fiksering | `catchCropNFixation`, `catchCropNFixationBonus` | `efterafgroede_nfiks`, `efterafgroede_nfiks_bonus` | |
| M11-korrektion | `m11CorrectionApplied`, `m11CorrectionFactor` | `M11_korrektion_anvendt`, `M11_korrektionsfaktor` | |
| simulering | `Simulation`, simulation | | |
| scenarie | scenario | | |
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
- Routes, DOM ids and anchors are English, for example `/profile` and `#settings`.
- A new backend field with a Danish name gets an entry in `api/wire.ts` and in
  this glossary in the same commit.
