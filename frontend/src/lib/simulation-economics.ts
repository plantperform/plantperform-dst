import type { FieldRecord } from '@/api/types'
import {
  isCropCustomised,
  profileChanges,
  profileDbEffect,
  type CropDbEffect,
  type EconomicsAssumptions,
  type EconomicsOverrides,
  type ProfileChange,
} from '@/lib/economics'

type RotationField = Pick<FieldRecord, 'areaHa' | 'cropRotation'>

export type CropArea = {
  cropCode: number
  cropName: string
  areaHa: number
}

export type SimulationCropEffect = CropDbEffect & {
  areaHa: number
  deltaDkk: number
  changes: ProfileChange[]
}

export type SimulationEconomicsEffect = {
  crops: SimulationCropEffect[]
  otherCrops: CropArea[]
  deltaDkk: number
  unusedCropNames: string[]
}

const yearlyCropAreas = (fields: RotationField[]): CropArea[] => {
  const areas = new Map<number, CropArea>()
  for (const field of fields) {
    for (const { cropCode, cropName } of field.cropRotation) {
      const area = areas.get(cropCode) ?? { cropCode, cropName, areaHa: 0 }
      area.areaHa += field.areaHa / field.cropRotation.length
      areas.set(cropCode, area)
    }
  }
  return [...areas.values()].sort((left, right) => right.areaHa - left.areaHa)
}

export const simulationEconomicsEffect = (
  assumptions: EconomicsAssumptions,
  overrides: EconomicsOverrides,
  fields: RotationField[],
): SimulationEconomicsEffect => {
  const areas = yearlyCropAreas(fields)
  const grownCropCodes = new Set(areas.map((area) => area.cropCode))
  const effects = new Map(
    profileDbEffect(assumptions, overrides).map((effect) => [
      effect.cropCode,
      effect,
    ]),
  )
  const changes = profileChanges(assumptions, overrides)
  const crops = areas.flatMap((area) => {
    const effect = effects.get(area.cropCode)
    if (!effect) return []
    return [
      {
        ...effect,
        areaHa: area.areaHa,
        deltaDkk: Math.round(effect.deltaDkkHa * area.areaHa),
        changes: changes.filter((change) =>
          change.cropNames.includes(effect.cropName),
        ),
      },
    ]
  })
  return {
    crops,
    otherCrops: areas.filter((area) => !effects.has(area.cropCode)),
    deltaDkk: crops.reduce((total, entry) => total + entry.deltaDkk, 0),
    unusedCropNames: assumptions.crops
      .filter(
        (crop) =>
          !grownCropCodes.has(crop.cropCode) &&
          isCropCustomised(overrides, crop),
      )
      .map((crop) => crop.cropName),
  }
}
