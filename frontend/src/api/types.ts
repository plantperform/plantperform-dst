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
  udledningskvoteKgN: number
  rotationLibrary: NamedRotation[]
}

export type CreateFarmInput = {
  name: string
  ownerName: string
  cvr: string | null
  udledningskvoteKgN?: number
}

export type UpdateFarmInput = {
  udledningskvoteKgN: number
}

export type GeoJSONPolygon = {
  type: 'Polygon'
  coordinates: [number, number][][]
}

export type GeoJSONMultiPolygon = {
  type: 'MultiPolygon'
  coordinates: [number, number][][][]
}

export type Soil = 'SAND' | 'CLAY'

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
  id: string
  farmId: string
  imkId: number | null
  kystvandId: number | null
  retention: number | null
  soil: Soil
  jbnr: number | null
  cropRotation: RotationYear[]
  rotationId: string | null
  measures: FieldMeasures
  allowedRotationIds: string[]
  db2: number
  nLoad: number
  leaching: number
  fen: number
  name: string
  areaHa: number
  inTakeoutPlan: boolean
  udledningsgraenseKgnHa: number
  udledningskvoteMarkKgn: number
  geometry: GeoJSONPolygon | GeoJSONMultiPolygon | null
}

export type RegistryField = {
  imkId: number
  cvr: string | null
  marknr: string | null
  kystvandId: number | null
  retention: number | null
  soilId: number | null
  areaHa: number
  cropRotation: string
  cropHistory: Record<string, number | null>
  inTakeoutPlan: boolean
  udledningsgraenseKgnHa: number
  udledningskvoteMarkKgn: number
  geometry: GeoJSONPolygon | GeoJSONMultiPolygon
}

export type RegistryFieldSummary = {
  imkId: number
  cvr: string | null
  marknr: string | null
  kystvandId: number | null
  retention: number | null
  soilId: number | null
  areaHa: number
  cropRotation: string
  inTakeoutPlan: boolean
  udledningsgraenseKgnHa: number
  udledningskvoteMarkKgn: number
}

export type RegistryBounds = {
  west: number
  south: number
  east: number
  north: number
}

export type CreateFieldInput = {
  imkId: number | null
  kystvandId?: number | null
  retention: number | null
  soil: Soil
  cropRotation?: RotationYear[]
  measures?: FieldMeasures
  allowedRotationIds?: string[]
  name: string
  areaHa: number
  inTakeoutPlan?: boolean
  udledningsgraenseKgnHa?: number
  udledningskvoteMarkKgn?: number
  geometry: GeoJSONPolygon | GeoJSONMultiPolygon | null
}

export type UpdateFieldInput = Partial<CreateFieldInput>

export type CropPercentageConstraint = {
  crop: Crop
  minimumPercentage: number
}

export type OptimizationConstraints = {
  maxNLoadKg: number | null
  minFen: number | null
  maxFen: number | null
  maxFieldsWithNewRotation: number | null
  cropPercentages: CropPercentageConstraint[]
  globallyAllowedRotationIds: string[] | null
}

export type GodningSettings = {
  driftsform: 'Konventionel' | 'Økologisk'
  orgMineralN: number
  mineralskAndelPct: number
  onlyOrganic: boolean
  nIndholdKgPerTon: number
}

export type GodningPresetOption = {
  navn: string
  godning: GodningSettings
}

export type Simulation = {
  id: string
  farmId: string
  name: string
  createdAt: string
  constraints: OptimizationConstraints
  rotationSaedskiftevarianter: string[]
  rotationNNormProcenter: string[]
  godning: GodningSettings
  eeaFdato: string
  eeaPrecisionDagsbasis: boolean
}

export type CreateSimulationInput = {
  name: string
  saedskiftevarianter?: string[]
  nNormProcenter?: string[]
  godning?: GodningSettings
  eeaFdato?: string
  eeaPrecisionDagsbasis?: boolean
}

export type OptimizationStatus = 'OPTIMAL' | 'FEASIBLE'

export type OptimizeSimulationInput = {
  timeLimitSeconds?: number
}

export type RotationAssignment = {
  fieldId: string
  rotationId: string
}

export type OptimizeSimulationResponse = {
  status: OptimizationStatus
  objectiveDb2: number
  totalNLoadKg: number
  totalLeachingKg: number
  totalFen: number
  fields: FieldRecord[]
  assignments: RotationAssignment[]
}

export type SaedskifteVariantRef = {
  saedskiftevariant: string
  variant: string
}

export type YearlyOptimizeSimulationInput = {
  timeLimitSeconds?: number
  maxNLoadByYear?: Record<number, number>
  db2SwingPct?: number | null
  selectedSaedskifter?: SaedskifteVariantRef[]
}

export type YearlyOptimizationSaedskifteOption = {
  saedskiftevariant: string
  variant: string
  cropSequence: string[]
  activeLen: number
}

export type YearlyOptimizationKategoriOption = {
  kategori: string
  saedskifter: YearlyOptimizationSaedskifteOption[]
}

export type YearlyOptimizeSimulationResponse = {
  status: OptimizationStatus
  objectiveDb2: number
  totalNLoadKg: number
  totalLeachingKg: number
  totalFen: number
  totalDb2ByYear: Record<number, number>
  totalNLoadByYear: Record<number, number>
  fields: FieldRecord[]
  assignments: RotationAssignment[]
}

export type YearlySummaryEntry = {
  year: number
  totalNLoadKg: number
  totalDb2: number
  totalFen: number
  fieldCount: number
}

export type RotationCandidateRef = {
  saedskiftevariant: string
  variant: string
  nNormPct: string
}

export type RotationCandidateOption = {
  ref: RotationCandidateRef
  activeLen: number
  cropSequence: string[]
}

export type RotationYear = {
  afgrodeKode: number
  afgrodeNavn: string
  udlaegKode: number | null
  udlaegNavn: string | null
}

export type RotationCandidateYearResult = {
  year: RotationYear
  leachingKgNHa: number
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  leachingDetail: Record<string, any>
  dbKrHa: number
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  dbDetail: Record<string, any>
  forfrugtsvaerdiKgnHa: number
  tildeltHusdyrgodningUdnyttetKgnHa: number
  tildeltHandelsgodningKgnHa: number
  husdyrgodningOrganiskBundetKgnHa: number
  husdyrgodningTonUdnyttetPrHa: number
  husdyrgodningTonTotalPrHa: number
  afgrodeNormKgnHa: number | null
  nNormPct: number
}

export type RotationPositionOverride = {
  position: number
  afgrodeKode: number
}

export type RotationCandidateEvaluation = {
  ref: RotationCandidateRef
  activeLen: number
  years: RotationCandidateYearResult[]
  avgLeachingKgNHa: number
  avgDbKrHa: number
  avgFen: number
  baseRef?: RotationCandidateRef | null
  overrides: RotationPositionOverride[]
  startYear: number
}

export type RecomputeFieldRotationInput = {
  baseRef: RotationCandidateRef
  overrides: RotationPositionOverride[]
  startYear?: number
}

export type AfgrodeKodeOption = {
  code: number
  navn: string
}

export type FieldRotationCandidates = {
  fieldId: string
  jbnr: number
  candidates: RotationCandidateEvaluation[]
}

export type Driftsform = 'Konventionel' | 'Økologisk'

export type EvaluateRotationCandidatesInput = {
  fieldIds: string[]
  kategori: string
  candidateRefs: RotationCandidateRef[]
  startYear?: number
  irrigated?: boolean
}

export type SaedskifteOption = {
  saedskiftevariant: string
  cropSequence: string[]
  activeLen: number
}

export type RotationKategoriOption = {
  kategori: string
  dyrkningssystem: Driftsform
  antalSaedskifter: number
  saedskifter: SaedskifteOption[]
}
