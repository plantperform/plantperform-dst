export type Farm = {
  id: string
  cvr: string | null
  name: string
  ownerName: string
  nitrogenQuotaKg: number
  rotationLibrary: NamedRotation[]
}

export type CreateFarmInput = {
  name: string
  ownerName: string
  cvr: string | null
  nitrogenQuotaKg?: number
}

export type UpdateFarmInput = {
  nitrogenQuotaKg: number
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
  cropRotation: Crop[]
  measures: FieldMeasures
  allowedRotationIds: string[]
  db2: number
  nLoad: number
  leaching: number
  name: string
  areaHa: number
  inTakeoutPlan: boolean
  nQuotaKgN: number | null
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
  nQuotaKgN: number | null
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
  nQuotaKgN: number | null
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
  cropRotation: Crop[]
  measures?: FieldMeasures
  allowedRotationIds?: string[]
  name: string
  areaHa: number
  inTakeoutPlan?: boolean
  nQuotaKgN?: number | null
  geometry: GeoJSONPolygon | GeoJSONMultiPolygon | null
}

export type UpdateFieldInput = Partial<CreateFieldInput>

export type CropPercentageConstraint = {
  crop: Crop
  minimumPercentage: number
}

export type OptimizationConstraints = {
  maxNLoadKg: number | null
  maxFieldsWithNewRotation: number | null
  cropPercentages: CropPercentageConstraint[]
  globallyAllowedRotationIds: string[] | null
}

export type Simulation = {
  id: string
  farmId: string
  name: string
  createdAt: string
  constraints: OptimizationConstraints
}

export type CreateSimulationInput = {
  name: string
}

export type OptimizationStatus = 'OPTIMAL' | 'FEASIBLE'

export type OptimizeSimulationInput = {
  timeLimitSeconds?: number
}

export type RotationAssignment = {
  fieldId: string
  rotationId: string
  measures: FieldMeasures
}

export type OptimizeSimulationResponse = {
  status: OptimizationStatus
  objectiveDb2: number
  totalNLoadKg: number
  totalLeachingKg: number
  fields: FieldRecord[]
  assignments: RotationAssignment[]
}
