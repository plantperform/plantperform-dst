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
  udlaegSet: 'undersownCropSet',
  excludedAfgrodekoder: 'excludedCropCodes',
  afgrodeNormKgnHa: 'cropNormKgNHa',
  mellemafgrode: 'intermediateCrop',
  forfrugtsvaerdiKgnHa: 'precedingCropValueKgNHa',
  medregnForfrugtsvaerdi: 'includePrecedingCropValue',
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
  fenFeHa: 'feedUnitsPerHa',
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
  economics_missing: 'economicsMissing',
  udbytterespons: 'hasYieldResponse',
  udbytte_faktor: 'yieldFactor',
  salgspris: 'salePrice',
  frasorteret_andel: 'culledShare',
  frasorteret_pris: 'culledPrice',
  halm_indtaegt: 'strawRevenue',
  indtaegt: 'revenue',
  tilskud: 'subsidy',
  goedning: 'fertiliserCost',
  andre_goedningsstoffer: 'otherFertilisers',
  udsaed: 'seed',
  plantevaern: 'cropProtection',
  markarbejde: 'fieldWork',
  toerring: 'drying',
  andet: 'other',
  omkostninger_total: 'totalCosts',
  linjer: 'lines',
  behandling: 'treatment',
  udgift_kr_ha: 'costDkkHa',
  afstromningskategori: 'runoffCategory',
  afstromningskategori_ukendt: 'runoffCategoryUnknown',
  afstromning_vinterdaekke: 'runoffWinterCover',
  mellemafgroede_eller_tidlig_saaning: 'intermediateOrEarlySowing',
  efterafgroede_nfiks: 'catchCropNFixation',
  efterafgroede_nfiks_bonus: 'catchCropNFixationBonus',
  Fmajs_anvendt: 'fmajsApplied',
  Fmajs_korrektionsfaktor: 'fmajsCorrectionFactor',
  Fmajs_mineralsk_n: 'fmajsMineralN',
}

const RESPONSE_NAMES: Record<string, string> = {
  ...SHARED_NAMES,
  ...RESPONSE_ONLY_NAMES,
}

const REQUEST_NAMES: Record<string, string> = Object.fromEntries(
  Object.entries(SHARED_NAMES).map(([wire, domain]) => [domain, wire]),
)

const isLeaf = (value: unknown) => value === null || typeof value !== 'object'

const renameKeys = (value: unknown, names: Record<string, string>): unknown => {
  if (isLeaf(value)) return value
  if (Array.isArray(value)) {
    return value.every(isLeaf)
      ? value
      : value.map((item) => renameKeys(item, names))
  }
  const source = value as Record<string, unknown>
  const renamed: Record<string, unknown> = {}
  for (const key of Object.keys(source)) {
    renamed[names[key] ?? key] = renameKeys(source[key], names)
  }
  return renamed
}

export const fromWire = <T>(value: unknown): T =>
  renameKeys(value, RESPONSE_NAMES) as T

export const toWire = (value: unknown): unknown =>
  renameKeys(value, REQUEST_NAMES)
