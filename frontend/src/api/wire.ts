const SHARED_NAMES: Record<string, string> = {
  kystvandId: 'catchmentId',
  kystvandNavn: 'catchmentName',
  maxNLoadByKystvandopland: 'maxNLoadByCatchment',
  udledningskvoteMarkKgn: 'nLoadQuotaKgN',
  udledningsgraenseKgnHa: 'nLoadLimitKgNHa',
  udledningskvoteKgN: 'totalNLoadQuotaKgN',
  beregnetUdledningKgN: 'calculatedNLoadKgN',
  kvotegivende: 'quotaEligible',
  overholder: 'withinQuota',
  jbnr: 'soilTypeNumber',
  marknr: 'fieldNumber',
  markblok: 'fieldBlock',
  afgrodeKode: 'cropCode',
  afgrodeNavn: 'cropName',
  udlaegKode: 'undersownCropCode',
  udlaegNavn: 'undersownCropName',
  excludedAfgrodekoder: 'excludedCropCodes',
  afgrodeNormKgnHa: 'cropNormKgNHa',
  mellemafgrode: 'intermediateCrop',
  forfrugtsvaerdiKgnHa: 'precedingCropValueKgNHa',
  rotationSaedskiftevarianter: 'rotationVariants',
  saedskiftevarianter: 'allowedRotationVariants',
  saedskiftevariant: 'rotationVariant',
  rotationNNormProcenter: 'nNormPercentages',
  nNormProcenter: 'allowedNNormPercentages',
  driftsform: 'farmingSystem',
  dyrkningssystem: 'croppingSystem',
  praecisionsjordbrug: 'precisionFarming',
  tidligSaaning: 'earlySowing',
  eeaFdato: 'catchCropSowingDate',
  eeaPrecisionDagsbasis: 'catchCropDailyBasis',
  godning: 'fertiliser',
  mineralskAndelPct: 'mineralSharePct',
  nIndholdKgPerTon: 'nContentKgPerTon',
  tildeltHusdyrgodningUdnyttetKgnHa: 'appliedManureUtilisedKgNHa',
  tildeltHandelsgodningKgnHa: 'appliedMineralFertiliserKgNHa',
  husdyrgodningOrganiskBundetKgnHa: 'manureOrganicBoundKgNHa',
  husdyrgodningTonPrHa: 'manureTonsPerHa',
  dbKrHa: 'dbDkkHa',
  avgDbKrHa: 'avgDbDkkHa',
  fen: 'feedUnits',
  minFen: 'minFeedUnits',
  maxFen: 'maxFeedUnits',
  totalFen: 'totalFeedUnits',
  avgFen: 'avgFeedUnits',
  journalnr: 'journalNumber',
}

const RESPONSE_ONLY_NAMES: Record<string, string> = {
  navn: 'name',
  kategori: 'category',
  saedskifter: 'rotations',
  antalSaedskifter: 'rotationCount',
  udbytte: 'yieldAmount',
  udbytteenhed: 'yieldUnit',
  udbyttenorm_mangler: 'yieldNormMissing',
  salgspris: 'salePrice',
  indtaegt: 'revenue',
  tilskud: 'subsidy',
  goedning: 'fertiliserCost',
  udsaed: 'seed',
  plantevaern: 'cropProtection',
  markarbejde: 'fieldWork',
  toerring: 'drying',
  omkostninger_total: 'totalCosts',
  linjer: 'lines',
  behandling: 'treatment',
  udgift_kr_ha: 'costDkkHa',
  afstromningskategori: 'runoffCategory',
  afstromningskategori_ukendt: 'runoffCategoryUnknown',
  efterafgroede_nfiks: 'catchCropNFixation',
  efterafgroede_nfiks_bonus: 'catchCropNFixationBonus',
  M11_korrektion_anvendt: 'm11CorrectionApplied',
  M11_korrektionsfaktor: 'm11CorrectionFactor',
}

const RESPONSE_NAMES: Record<string, string> = {
  ...SHARED_NAMES,
  ...RESPONSE_ONLY_NAMES,
}

const REQUEST_NAMES: Record<string, string> = Object.fromEntries(
  Object.entries(SHARED_NAMES).map(([wire, domain]) => [domain, wire]),
)

const renameKeys = (value: unknown, names: Record<string, string>): unknown => {
  if (Array.isArray(value)) return value.map((item) => renameKeys(item, names))
  if (value === null || typeof value !== 'object') return value
  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => [
      names[key] ?? key,
      renameKeys(item, names),
    ]),
  )
}

export const fromWire = <T>(value: unknown): T =>
  renameKeys(value, RESPONSE_NAMES) as T

export const toWire = (value: unknown): unknown =>
  renameKeys(value, REQUEST_NAMES)
