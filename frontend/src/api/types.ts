export type User = {
  email: string
}

export type TokenResponse = {
  accessToken: string
  tokenType: string
  expiresIn: number
}

export type FarmMember = {
  email: string
}

export type Farm = {
  id: string
  cvr: string | null
  name: string
  ownerName: string
  rotationLibrary: NamedRotation[]
}

export type CreateFarmInput = {
  name: string
  ownerName: string
  cvr: string | null
}

export type CatchmentEmissions = {
  catchmentId: number | null
  catchmentName: string | null
  totalNLoadQuotaKgN: number
  calculatedNLoadKgN: number
  withinQuota: boolean
}

export type GeoJSONPolygon = {
  type: 'Polygon'
  coordinates: [number, number][][]
}

export type GeoJSONMultiPolygon = {
  type: 'MultiPolygon'
  coordinates: [number, number][][][]
}

export type Crop =
  | 'CEREAL_WINTER'
  | 'CEREAL_SPRING'
  | 'CEREAL_LEGUME_MIX'
  | 'GRASS_CLOVER'
  | 'GRASS_SEED'
  | 'FALLOW'
  | 'BEET'
  | 'MAIZE_POTATO'
  | 'RAPE'
  | 'CEREAL_WINTER_AFTER_GRASS'
  | 'MAIZE_AFTER_GRASS'
  | 'CEREAL_SPRING_AFTER_GRASS'
  | 'CEREAL_VEG_BEAN'

export type NamedRotation = {
  id: string
  name: string
  crops: Crop[]
}

export type Measure = 'PRECISION_FARMING' | 'COVER_CROP' | 'EARLY_SOWING'

export type FieldMeasures = {
  precisionFarming: boolean
  coverCropYears: number[]
  earlySowingYears: number[]
}

export type FieldRecord = {
  alias?: string | null
  id: string
  farmId: string
  imkId: number | null
  catchmentId: number | null
  retention: number | null
  soilTypeNumber: number | null
  cropRotation: RotationYear[]
  rotationId: string | null
  measures: FieldMeasures
  allowedRotationIds: string[]
  db2: number
  // Every year of the rotation is an afgrøde without a cost budget that no
  // sædskifte grows, so db2 is 0 and means no figure.
  economicsMissing?: boolean
  nLoad: number
  leaching: number
  feedUnits: number
  name: string
  areaHa: number
  inTakeoutPlan: string
  nLoadLimitKgNHa: number
  nLoadQuotaKgN: number
  quotaEligible: boolean
  geometry: GeoJSONPolygon | GeoJSONMultiPolygon | null
}

export type FieldAliases = Record<string, string>

export type FieldAlias = { fieldKey: string; alias: string | null }

export type RegistryField = {
  imkId: number
  cvr: string | null
  fieldNumber: string | null
  fieldBlock: string | null
  journalNumber: string | null
  catchmentId: number | null
  catchmentName: string | null
  retention: number | null
  soilTypeNumber: number | null
  areaHa: number
  cropRotation: string
  cropHistory: Record<string, number | null>
  inTakeoutPlan: string
  nLoadLimitKgNHa: number
  nLoadQuotaKgN: number
  quotaEligible: boolean
  geometry: GeoJSONPolygon | GeoJSONMultiPolygon
}

export type RegistryFieldSummary = {
  imkId: number
  cvr: string | null
  fieldNumber: string | null
  catchmentId: number | null
  catchmentName: string | null
  retention: number | null
  areaHa: number
  cropRotation: string
  inTakeoutPlan: string
  nLoadLimitKgNHa: number
  nLoadQuotaKgN: number
}

export type RegistryBounds = {
  west: number
  south: number
  east: number
  north: number
}

export type CreateFieldInput = {
  imkId: number | null
  catchmentId?: number | null
  retention: number | null
  cropRotation?: RotationYear[]
  measures?: FieldMeasures
  allowedRotationIds?: string[]
  name: string
  areaHa: number
  inTakeoutPlan?: string
  nLoadLimitKgNHa?: number
  nLoadQuotaKgN?: number
  geometry: GeoJSONPolygon | GeoJSONMultiPolygon | null
}

export type UpdateFieldInput = Partial<CreateFieldInput>

export type CropPercentageConstraint = {
  crop: Crop
  minimumPercentage: number
}

export type CatchmentNLoadCap = {
  catchmentId: number | null
  maxNLoadKg: number | null
}

export type CropAreaLimit = {
  cropCode: number
  minAreaHa: number | null
  maxAreaHa: number | null
}

export type CropAreaRange = {
  cropCode: number
  minAverageHa: number
  maxAverageHa: number
  minHaByYear: number[]
  maxHaByYear: number[]
  yearlyMaxAverageHa: number
}

export type OptimizationConstraints = {
  maxNLoadByCatchment: CatchmentNLoadCap[]
  minFeedUnits: number | null
  maxFeedUnits: number | null
  maxFieldsWithNewRotation: number | null
  cropPercentages: CropPercentageConstraint[]
  cropAreaLimits: CropAreaLimit[]
  globallyAllowedRotationIds: string[] | null
}

export type FertiliserSettings = {
  farmingSystem: 'Konventionel' | 'Økologisk'
  orgMineralN: number
  mineralSharePct: number
  onlyOrganic: boolean
  nContentKgPerTon: number
}

export type FertiliserPresetOption = {
  name: string
  fertiliser: FertiliserSettings
}

export type Simulation = {
  fieldsInitialized?: boolean
  optimizationSettings?: OptimizationSettings
  creationStatus?: CreationStatus
  economicsRecalculationFailed?: boolean
  revision: number
  result: SimulationResultSummary
  id: string
  farmId: string
  name: string
  createdAt: string
  constraints: OptimizationConstraints
  rotationVariants: string[]
  nNormPercentages: string[]
  fertiliser: FertiliserSettings
  catchCropSowingDate: string
  catchCropDailyBasis: boolean
  precisionFarming: boolean
  earlySowing: boolean
  intermediateCrop: boolean
  comparisonAvailability?: { kind: 'ready' | 'uncalculated' } |
    { kind: 'partial'; missingCount: number } | null
  includePrecedingCropValue?: boolean
  economicsModuleId?: string
  economicsSnapshot?: EconomicsSnapshot
}

export type EconomicsOverrides = {
  prices: Readonly<Record<string, number>>
  quantities: Readonly<Record<string, number>>
  yieldPct: Readonly<Record<string, number>>
}

export type EconomicsSnapshot = {
  sourceId: string
  name: string
  revision: number
  overrides: EconomicsOverrides
}

export type EconomicsModule = {
  id: string
  name: string
  revision: number
  overrides: EconomicsOverrides
}

export type CreateSimulationInput = {
  optimizationSettings?: OptimizationSettings
  economicsModuleId?: string
  requestId?: string
  optimizeOnCreate?: boolean
  constraints?: OptimizationConstraints
  name: string
  allowedRotationVariants?: string[]
  allowedNNormPercentages?: string[]
  fertiliser?: FertiliserSettings
  catchCropSowingDate?: string
  catchCropDailyBasis?: boolean
  precisionFarming?: boolean
  earlySowing?: boolean
  intermediateCrop?: boolean
  includePrecedingCropValue?: boolean
}

export type OptimizationSettings = {
  kind: 'optimize' | 'yearly'
  excludedCropCodes: number[]
  maxNLoadByCatchment: CatchmentYearlyNLoadCaps[]
  db2SwingPct: number | null
  // Kvotehandel; only the yearly optimization uses it.
  quotaTrades: QuotaTrade[]
}

// Kvotehandel at a fixed price: the yearly optimization may buy or sell kvote
// in the catchment at priceDkkPerKg per kg N per year, an amount it chooses
// for each year, or one amount for every year with sameEachYear.
export type QuotaTrade = {
  catchmentId: number
  priceDkkPerKg: number
  // Trades saved before this setting existed are the same each year.
  sameEachYear?: boolean
}

export type UpdateSimulationInput = Partial<CreateSimulationInput> & {
  expectedRevision: number
}

export type CreationStatus = 'queued' | 'running' | 'done' | 'failed'

export type OptimizationStatus = 'OPTIMAL' | 'FEASIBLE'

export type OptimizeSimulationInput = {
  expectedRevision?: number
  runId?: string
  excludedCropCodes?: number[]
}

export type RotationAssignment = {
  fieldId: string
  rotationId: string
}

export type OptimizeSimulationResponse = {
  status: OptimizationStatus
  // The crops' DB2 alone, without the quotaTrades' payments.
  objectiveDb2: number
  totalNLoadKg: number
  totalLeachingKg: number
  totalFeedUnits: number
  fields: FieldRecord[]
  assignments: RotationAssignment[]
  // Runs from before kvotehandel have none.
  quotaTrades?: SimulationQuotaTrade[]
}

// A kvotehandel a yearly run chose, per calendar year: > 0 buys, < 0 sells.
// The payment is the average per year, negative when the trade sells more
// than it buys.
export type SimulationQuotaTrade = {
  catchmentId: number
  catchmentName: string | null
  tradeKgByYear: Record<number, number>
  priceDkkPerKg: number
  sameEachYear: boolean
  paymentDkkPerYear: number
}

export type CatchmentYearlyNLoadCaps = {
  catchmentId: number | null
  maxNLoadByYear: Record<number, number>
}

export type YearlyOptimizeSimulationInput = {
  expectedRevision?: number
  runId?: string
  maxNLoadByCatchment?: CatchmentYearlyNLoadCaps[]
  db2SwingPct?: number | null
  quotaTrades?: QuotaTrade[]
  excludedCropCodes?: number[]
}

export type YearlyOptimizationRotationOption = {
  rotationVariant: string
  variant: string
  cropSequence: string[]
  activeLen: number
}

export type YearlyOptimizationCategoryOption = {
  category: string
  rotations: YearlyOptimizationRotationOption[]
}

export type YearlyOptimizeSimulationResponse = {
  status: OptimizationStatus
  objectiveDb2: number
  totalNLoadKg: number
  totalLeachingKg: number
  totalFeedUnits: number
  totalDb2ByYear: Record<number, number>
  totalNLoadByYear: Record<number, number>
  fields: FieldRecord[]
  assignments: RotationAssignment[]
}

export type YearlySummaryEntry = {
  year: number
  totalNLoadKg: number
  totalDb2: number
  totalFeedUnits: number
  fieldCount: number
}

export type RotationCandidateRef = {
  rotationVariant: string
  variant: string
  nNormPct: string
}

export type RotationCandidateOption = {
  ref: RotationCandidateRef
  activeLen: number
  cropSequence: string[]
}

export type RotationYear = {
  cropCode: number
  cropName: string
  undersownCropCode: number | null
  undersownCropName: string | null
}

export type RotationCandidateYearResult = {
  year: RotationYear
  leachingKgNHa: number
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  leachingDetail: Record<string, any>
  dbDkkHa: number
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  dbDetail: Record<string, any>
  precedingCropValueKgNHa: number
  appliedManureUtilisedKgNHa: number
  appliedMineralFertiliserKgNHa: number
  manureOrganicBoundKgNHa: number
  manureTonsPerHa: number
  cropNormKgNHa: number | null
  nNormPct: number
}

export type FieldYearValue = Pick<RotationCandidateYearResult,
  'year' | 'leachingKgNHa' | 'dbDkkHa' | 'precedingCropValueKgNHa' |
  'appliedManureUtilisedKgNHa' | 'appliedMineralFertiliserKgNHa' |
  'manureOrganicBoundKgNHa' | 'manureTonsPerHa' | 'cropNormKgNHa' | 'nNormPct'> & {
  feedUnitsPerHa: number
  winterCover: Record<string, unknown>
  economicsMissing?: boolean
}

// Detailed calculations also satisfy the display inputs used by older fixtures.
export type DisplayYearValue = FieldYearValue | RotationCandidateYearResult
export type FieldYearValues = Record<string, DisplayYearValue[]>

export type ViewState = {
  inputRevision: number
  viewVersion: number
  status: 'queued' | 'running' | 'done' | 'failed' | 'missing'
  error: { code?: string; message?: string } | null
}

export type FarmViewData = {
  fields: FieldRecord[]
  fieldYears: FieldYearValues
  yearlySummary: YearlySummaryEntry[]
}

export type SavedResultView = {
  runId: string
  resultRevision: number
  response: OptimizeSimulationResponse
  fieldsBefore: FieldRecord[]
  fieldYears: FieldYearValues
  economicsSnapshot?: EconomicsSnapshot
}

export type SimulationViewData = FarmViewData & {
  cropAreaRanges: CropAreaRange[]
  yearlyOptimizationCandidates: YearlyOptimizationCategoryOption[]
  savedResult: SavedResultView | null
}

export type FarmView = ViewState & { farm: Farm; data: FarmViewData | null }
export type SimulationView = ViewState & {
  simulation: Simulation
  data: SimulationViewData | null
}

export type RotationPositionOverride = {
  position: number
  cropCode: number
  undersownCropCode?: number | null
  undersownCropName?: string | null
  undersownCropSet?: boolean
}

export type RotationCandidateEvaluation = {
  ref: RotationCandidateRef
  activeLen: number
  years: RotationCandidateYearResult[]
  avgLeachingKgNHa: number
  avgDbDkkHa: number
  avgFeedUnits: number
  baseRef?: RotationCandidateRef | null
  overrides: RotationPositionOverride[]
  startYear: number
}

export type RecomputeFieldRotationInput = {
  baseRef: RotationCandidateRef
  overrides: RotationPositionOverride[]
  startYear?: number
}

export type CropCodeOption = {
  code: number
  name: string
}

export type FieldRotationCandidates = {
  fieldId: string
  soilTypeNumber: number
  candidates: RotationCandidateEvaluation[]
}

export type FarmingSystem = 'Konventionel' | 'Økologisk'

export type EvaluateRotationCandidatesInput = {
  fieldIds: string[]
  category: string
  candidateRefs: RotationCandidateRef[]
  startYear?: number
  irrigated?: boolean
}

export type RotationOption = {
  rotationVariant: string
  cropSequence: string[]
  activeLen: number
}

export type RotationCategoryOption = {
  category: string
  croppingSystem: FarmingSystem
  rotationCount: number
  rotations: RotationOption[]
}

export type SimulationResultSummary = {
  status:
    | 'not_started'
    | 'queued'
    | 'in_progress'
    | 'completed'
    | 'failed'
    | 'outdated'
  runId: string | null
  kind: 'optimize' | 'yearly' | null
  inputRevision: number | null
  resultRevision: number | null
  queuedAt: string | null
  startedAt: string | null
  finishedAt: string | null
  error: { code: string; message: string; detail?: unknown } | null
}

export type SimulationResult = SimulationResultSummary & {
  parameters: OptimizeSimulationInput | YearlyOptimizeSimulationInput
  response: OptimizeSimulationResponse | null
  fieldsBefore: FieldRecord[]
  selectedCandidates: Record<string, RotationCandidateEvaluation>
}
