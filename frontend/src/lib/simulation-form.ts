import type {
  CreateSimulationInput,
  FarmingSystem,
  FertiliserPresetOption,
  RotationCategoryOption,
} from '@/api/types'
import { SOWING_DATE_INTERVALS } from '@/lib/nles5-detail-labels'

// 'none' and 'custom' are fixed choices; any other value is a preset name.
export const NO_FERTILISER = 'none'
export const CUSTOM_FERTILISER = 'custom'

// Number inputs are kept as the strings the user typed, so an empty or
// half-typed field is not silently turned into a number.
export type SimulationFormValues = {
  name: string
  farmingSystem: FarmingSystem
  // Unique across categories: a variant such as brak ("1") belongs to several
  // categories but is selected once.
  rotationVariants: string[]
  nNormPercentages: string[]
  fertiliserChoice: string
  orgMineralN: string
  mineralSharePct: string
  onlyOrganic: boolean
  nContentKgPerTon: string
  catchCropDailyBasis: boolean
  catchCropSowingInterval: string
  catchCropSowingDate: string
  precisionFarming: boolean
  earlySowing: boolean
  intermediateCrop: boolean
}

export const DEFAULT_SIMULATION_FORM_VALUES: SimulationFormValues = {
  name: '',
  farmingSystem: 'Konventionel',
  rotationVariants: [],
  nNormPercentages: [],
  fertiliserChoice: NO_FERTILISER,
  orgMineralN: '0',
  mineralSharePct: '100',
  onlyOrganic: false,
  nContentKgPerTon: '6',
  catchCropDailyBasis: false,
  catchCropSowingInterval: SOWING_DATE_INTERVALS[0].date,
  catchCropSowingDate: '20/8',
  precisionFarming: false,
  earlySowing: true,
  intermediateCrop: true,
}

export const toggleValue = (values: string[], value: string): string[] =>
  values.includes(value)
    ? values.filter((current) => current !== value)
    : [...values, value]

export const selectedInCategory = (
  category: RotationCategoryOption,
  rotationVariants: string[],
): number => {
  const selected = new Set(rotationVariants)
  return category.rotations.filter((rotation) =>
    selected.has(rotation.rotationVariant),
  ).length
}

// Selects every rotation in the category, or clears them when all are selected.
export const toggleCategoryRotations = (
  category: RotationCategoryOption,
  rotationVariants: string[],
): string[] => {
  const categoryVariants = category.rotations.map(
    (rotation) => rotation.rotationVariant,
  )
  const allSelected =
    categoryVariants.length > 0 &&
    selectedInCategory(category, rotationVariants) === categoryVariants.length
  if (allSelected) {
    const removed = new Set(categoryVariants)
    return rotationVariants.filter((variant) => !removed.has(variant))
  }
  return Array.from(new Set([...rotationVariants, ...categoryVariants]))
}

type FertiliserFields = Pick<
  SimulationFormValues,
  'orgMineralN' | 'mineralSharePct' | 'onlyOrganic'
>

// Returns the fields a fertiliser choice fills in, or null when the choice
// leaves the current values as they are.
export const fertiliserFieldsForChoice = (
  choice: string,
  presets: FertiliserPresetOption[],
  farmingSystem: FarmingSystem,
): FertiliserFields | null => {
  if (choice === NO_FERTILISER) {
    return {
      orgMineralN: '0',
      mineralSharePct: '100',
      onlyOrganic: farmingSystem === 'Økologisk',
    }
  }
  if (choice === CUSTOM_FERTILISER) return null

  const preset = presets.find((option) => option.name === choice)
  if (!preset) return null
  // The preset does not set farmingSystem: the same fertiliser type (for
  // example Kvæggylle) is used on conventional and organic fields. Only
  // onlyOrganic follows farmingSystem, whatever the preset says.
  return {
    orgMineralN: String(preset.fertiliser.orgMineralN),
    mineralSharePct: String(preset.fertiliser.mineralSharePct),
    onlyOrganic:
      farmingSystem === 'Økologisk' ? true : preset.fertiliser.onlyOrganic,
  }
}

export const catchCropSowingDateOf = (values: SimulationFormValues): string =>
  values.catchCropDailyBasis
    ? values.catchCropSowingDate
    : values.catchCropSowingInterval

export const toCreateSimulationInput = (
  values: SimulationFormValues,
): CreateSimulationInput => ({
  name: values.name.trim(),
  allowedRotationVariants: values.rotationVariants,
  allowedNNormPercentages: values.nNormPercentages,
  fertiliser: {
    farmingSystem: values.farmingSystem,
    orgMineralN: Number(values.orgMineralN) || 0,
    mineralSharePct: Number(values.mineralSharePct) || 100,
    onlyOrganic: values.onlyOrganic,
    nContentKgPerTon: Number(values.nContentKgPerTon) || 6,
  },
  catchCropSowingDate: catchCropSowingDateOf(values),
  catchCropDailyBasis: values.catchCropDailyBasis,
  precisionFarming: values.precisionFarming,
  earlySowing: values.earlySowing,
  intermediateCrop: values.intermediateCrop,
})
