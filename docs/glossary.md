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
| helsæd | `wholeCropSilage` | | Crop group for cereals and peas harvested whole for silage, and grønkorn blends. Majshelsæd counts as Majs |
| afgrødefordeling | `CropShare`, `CropShareLevel`, `summarizeCropDistribution` | | Area and N load per crop group or per crop for a year, or the average per year |
| afgrødearealkrav | `CropAreaLimit`, `cropAreaLimits`, `minAreaHa`, `maxAreaHa`, `CropAreaViolation`, `CropAreaRange` | `cropAreaLimits`, `minAreaHa`, `maxAreaHa`, `cropAreaViolations`, `crop-area-ranges` | Min. and/or max. hectares of one afgrødekode under Regler; percent is of the simulation's total area |
| udlæg | `undersownCropCode`, `undersownCropName`, `undersownCropSet` | `udlaegKode`, `udlaegNavn`, `udlaegSet` | |
| efterafgrøde | catch crop | | EEA in formula names |
| mellemafgrøde | `intermediateCrop` | `mellemafgrode` | |
| vinterdække | `WinterCoverKind`, `YearCover`, `rotationCovers`, `WinterCoverBand` | | What covers the soil after harvest: `cropCover` (plantedække), `stubble` or `bareSoil`, shown per year together with `catchCrop`, `intermediateCrop` and `earlySowing` |
| stubmark | `stubble` | | W=5 in NLES5: stubble left with weeds and volunteer grain |
| bar jord | `bareSoil` | | W=2 and W=3 in NLES5 |
| forfrugtsværdi | `precedingCropValueKgNHa` | `forfrugtsvaerdiKgnHa` | |
| regn forfrugtsværdien med | `includePrecedingCropValue`, `precedingCropValueLabel` | `medregnForfrugtsvaerdi` | Proposed field; the backend does not read it yet |
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
| dækningsbidrag | `db2`, `dbDkkHa`, `avgDbDkkHa`, `formatDbDkk` | `db2`, `dbKrHa`, `avgDbKrHa` | DB2 kept as an acronym |
| kr | `Dkk` suffix, `formatCompactDkk` | | |
| udbytte | `yieldAmount` | `udbytte` | |
| udbytteenhed | `yieldUnit` | `udbytteenhed` | |
| manglende udbyttenorm | `yieldNormMissing` | `udbyttenorm_mangler` | |
| udbytterespons | `hasYieldResponse` | `udbytterespons` | Whether the crop has a yield-response curve for N below the norm |
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
| økonomiforudsætninger | `EconomicsAssumptions`, `CropEconomics`, `EconomicsLine`, `EXAMPLE_ECONOMICS`, `EconomicsCropDetail` | | The SEGES prices and quantities behind DB2, per crop |
| omkostningsgruppe | `CostCategory`, `COST_CATEGORIES`, `EconomicsGroupId`, `lineGroupId` | | Udsæd, planteværn, markarbejde and tørring/lagring |
| stykpris | `UnitPrice`, `priceId`, `priceValue` | | Price per unit, e.g. kr/gang or kr/kg |
| mængde | `quantity`, `quantityUnit`, `lineQuantity` | | Per hectare, e.g. 3 sprøjtninger or 140 kg udsæd |
| kilde | `source`, `cropSources` | | Where a standard price comes from |
| fælles pris | shared price, `priceUsage`, `priceCrops`, `sharedPriceEffect`, `SharedPriceConfirm` | | A price used by several crops, e.g. Pløjning med pakning. A change is confirmed with the crops it reaches before it is saved |
| tilpasset | `EconomicsOverrides`, `isPriceCustomised`, `isQuantityCustomised`, `isLineCustomised`, `isCropCustomised`, `withoutCropChanges` | | The user's own value on top of the SEGES standard |
| udbytte i forhold til normen | `yieldPct`, `cropYieldPct`, `withYieldPct`, `isYieldCustomised`, `YieldAdjustmentRow`, `YieldPctField`, `yieldHint` | | Percent added to or taken from each field's own yield for a crop in an economics profile. Grain and straw follow it, the costs do not |
| fordeling af indtægten | `incomeSplit`, `IncomeShare` | | Costs per group and dækningsbidrag as shares of income and subsidy, shown as a bar for each crop |
| alle afgrøder | `CropsOverview` | | The first tab under Økonomi, with income, subsidy and costs per hectare for every crop |
| økonomiprofil | `EconomicsProfile`, `EconomicsProfiles`, `EconomicsProfilePage`, `useEconomicsProfiles`, `profileForSimulation`, `economicsProfileId`, `SimulationHeading`, `EconomicsChip`, `describeEconomicsEntry`, `describeProfileOption` | | A farm's named set of economics changes. Each simulation uses one, and they are kept in the browser until the backend can store them |
| økonomioversigt | `EconomicsOverview`, `overviewPath`, `EconomicsBanner`, `describeStandardEntry`, `describeProfileChanges`, `describeProfileUsers`, `profileDbEffect`, `CropDbEffect`, `leadingDbEffects`, `dbDeltaScale`, `dbDeltaBar`, `ECONOMICS_INVITATION` | | The page behind Økonomi in the user menu at the foot of the sidebar (`economicsPath` in `UserMenuContent`). Standard stands as a line at the top, and each of the farm's own profiles has a card like the cards for the simulations: who uses it, its changes summed up by kind, and the dækningsbidrag of every crop with a bar from a zero line for the difference from Standard |
| Standard (SEGES 2026) | `STANDARD_PROFILE` | | The economics profile without changes. It cannot be edited, renamed or deleted |
| ændring i forhold til Standard | `ProfileChange`, `profileChanges`, `withoutProfileChange`, `profileChangesTitle`, `ChangedValue` | | One changed yield, price or quantity in a profile, listed with the value before and after |
| ny udgave | `withProfileCopy`, `copiedFromId`, `copyProfile` | | A copy of one of the farm's own profiles, which starts with the same changes |
| Tilpas økonomien til bedriften | the guide, `EconomicsGuidePage`, `GuidePricesStep`, `GuideYieldStep`, `GuideMachinesStep`, `GuideReviewStep`, `startGuide`, `guideStepOfChange` | | Four steps that fit a profile to the farm: Salgspriser, Udbytte, Maskinstation and Gennemgang, with the effect on each crop's dækningsbidrag beside them |
| tilbage-linje | `ReturnTarget`, `returnTargetLabel` | | The dark line on a profile page that leads back to the overview, the comparison, the simulation or the field the user came from |
| indgår ikke i beregningen endnu | `NotInCalculationDot` | | The yellow dot at an own profile while the backend still calculates with Standard |
| økonomi i simuleringerne | `ComparisonEconomics`, `compareProfileChanges`, `ProfileChangeComparison`, `describeEconomicsVerdict` | | The section of the comparison with each simulation's profile and the lines where the profiles differ from Standard |
| samme marker | `haveSameFieldPlans` | | Two simulations with the same rotation on every field, so only their economics can set their dækningsbidrag apart |
| sådan er tallene beregnet | breakdown, `BreakdownRow`, `customisedBreakdownLine`, `BreakdownEconomicsContext`, `CustomisedChip` | | The calculation under a field, where a line the profile changes is marked tilpasset i {profil} and links to the line in the profile |
| regnet med {profil} | `useFieldEconomics`, `FieldReturnTarget`, `useCalculationReturn`, `calculationReturnState` | | The line under a field's key figures that names the profile behind them. A profile opened from the field leads back to the field, and from a line in the calculation back to that year's calculation |

## Soil and calculation

| Danish term | English name in code | API field | Note |
| --- | --- | --- | --- |
| JB-nummer | `soilTypeNumber` | `jbnr` | JB kept in names like `JB_COLORS` |
| afstrømningskategori | `runoffCategory`, `runoffCategoryUnknown` | `afstromningskategori`, `afstromningskategori_ukendt` | |
| efterafgrødens N-fiksering | `catchCropNFixation`, `catchCropNFixationBonus` | `efterafgroede_nfiks`, `efterafgroede_nfiks_bonus` | |
| Fmajs-korrektion | `fmajsApplied`, `fmajsCorrectionFactor`, `fmajsMineralN` | `Fmajs_anvendt`, `Fmajs_korrektionsfaktor`, `Fmajs_mineralsk_n` | Maize after clover grass |
| simulering | `Simulation`, simulation | | |
| scenarie | scenario | | |
| regler | rules, `SimulationRulesPanel`, `FieldRulesCard` | | Limits and locked fields a simulation's optimization must keep |
| simuleringens grundlag | basis, `SimulationBasisCard` | | The settings a simulation's candidates were generated from, locked once created |
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
