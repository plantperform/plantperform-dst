import { z } from 'zod'

import type {
  CreateSimulationInput,
  FarmingSystem,
  FertiliserPresetOption,
  RotationCategoryOption,
  RotationOption,
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

// Checks a number field kept as text. The first failing message is the one
// shown, so an empty field reads "Udfyld feltet", not a range message.
const checkNumberText = (
  ctx: z.RefinementCtx,
  path: keyof SimulationFormValues,
  text: string,
  isValid: (value: number) => boolean,
  message: string,
) => {
  const trimmed = text.trim()
  if (trimmed === '') {
    ctx.addIssue({ code: 'custom', path: [path], message: 'Udfyld feltet' })
    return
  }
  const value = Number(trimmed)
  if (!Number.isFinite(value)) {
    ctx.addIssue({ code: 'custom', path: [path], message: 'Angiv et tal' })
    return
  }
  if (!isValid(value)) ctx.addIssue({ code: 'custom', path: [path], message })
}

// The number rules mirror the backend's FertiliserSettings; nContentKgPerTon
// has no backend rule but only makes sense above zero.
const nitrogenSchema = z
  .object({
    fertiliserChoice: z.string(),
    orgMineralN: z.string(),
    mineralSharePct: z.string(),
    onlyOrganic: z.boolean(),
    nContentKgPerTon: z.string(),
    nNormPercentages: z
      .array(z.string())
      .min(1, 'Vælg mindst ét N-norm-niveau'),
  })
  .superRefine((values, ctx) => {
    // Without organic fertiliser the numbers are fixed and hidden.
    if (values.fertiliserChoice === NO_FERTILISER) return
    checkNumberText(
      ctx,
      'orgMineralN',
      values.orgMineralN,
      (value) => value >= 0,
      'Skal være 0 eller mere',
    )
    checkNumberText(
      ctx,
      'mineralSharePct',
      values.mineralSharePct,
      (value) => value > 0 && value <= 100,
      'Mineralsk andel skal være større end 0 og højst 100 %',
    )
    checkNumberText(
      ctx,
      'nContentKgPerTon',
      values.nContentKgPerTon,
      (value) => value > 0,
      'Angiv et N-indhold større end 0',
    )
  })

export const SIMULATION_FORM_STEPS = [
  {
    id: 'basics',
    label: 'Grundlag',
    schema: z.object({
      name: z.string().trim().min(1, 'Giv simuleringen et navn'),
      farmingSystem: z.enum(['Konventionel', 'Økologisk']),
    }),
  },
  {
    id: 'rotations',
    label: 'Sædskifter',
    schema: z.object({
      rotationVariants: z
        .array(z.string())
        .min(1, 'Vælg mindst ét sædskifte'),
    }),
  },
  {
    id: 'nitrogen',
    label: 'Kvælstof',
    schema: nitrogenSchema,
  },
  {
    id: 'practice',
    label: 'Dyrkningspraksis',
    schema: z.object({
      catchCropDailyBasis: z.boolean(),
      catchCropSowingInterval: z.string().min(1),
      catchCropSowingDate: z.string().min(1),
      precisionFarming: z.boolean(),
      earlySowing: z.boolean(),
      intermediateCrop: z.boolean(),
    }),
  },
] as const

// The fields each step owns, taken from its schema so the two cannot drift.
export const stepFields = (stepIndex: number) => {
  const { shape } = SIMULATION_FORM_STEPS[stepIndex].schema
  return Object.keys(shape) as (keyof SimulationFormValues)[]
}

export const isStepValid = (
  stepIndex: number,
  values: SimulationFormValues,
): boolean => SIMULATION_FORM_STEPS[stepIndex].schema.safeParse(values).success

// Runs every step's rules at once, for the resolver and the final create.
export const simulationFormSchema = z
  .custom<SimulationFormValues>()
  .superRefine((values, ctx) => {
    for (const step of SIMULATION_FORM_STEPS) {
      const result = step.schema.safeParse(values)
      if (result.success) continue
      for (const issue of result.error.issues) {
        ctx.addIssue({ code: 'custom', path: issue.path, message: issue.message })
      }
    }
  })

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

// A crop filter keeps rotations containing every chosen crop ('all') or at
// least one of them ('any'). No chosen crops keeps everything.
export type CropMatchMode = 'all' | 'any'

export const cropsInCategory = (category: RotationCategoryOption): string[] =>
  Array.from(
    new Set(category.rotations.flatMap((rotation) => rotation.cropSequence)),
  ).sort((a, b) => a.localeCompare(b, 'da'))

export const filterRotations = (
  rotations: RotationOption[],
  {
    crops,
    mode,
    onlySelectedFrom,
  }: {
    crops: string[]
    mode: CropMatchMode
    // When given, only rotations in this selection are kept.
    onlySelectedFrom?: string[]
  },
): RotationOption[] => {
  const selected = onlySelectedFrom ? new Set(onlySelectedFrom) : null
  return rotations.filter((rotation) => {
    if (selected && !selected.has(rotation.rotationVariant)) return false
    if (crops.length === 0) return true
    const sequence = new Set(rotation.cropSequence)
    return mode === 'all'
      ? crops.every((crop) => sequence.has(crop))
      : crops.some((crop) => sequence.has(crop))
  })
}

export const setRotationsSelected = (
  rotationVariants: string[],
  rotations: RotationOption[],
  selected: boolean,
): string[] => {
  const variants = rotations.map((rotation) => rotation.rotationVariant)
  if (selected) return Array.from(new Set([...rotationVariants, ...variants]))
  const removed = new Set(variants)
  return rotationVariants.filter((variant) => !removed.has(variant))
}

// Categories for the chosen driftsform first, keeping their order otherwise.
export const orderCategoriesForFarmingSystem = (
  categories: RotationCategoryOption[],
  farmingSystem: FarmingSystem,
): RotationCategoryOption[] => [
  ...categories.filter((category) => category.croppingSystem === farmingSystem),
  ...categories.filter((category) => category.croppingSystem !== farmingSystem),
]

// Counts selected rotations that exist only in categories of the other
// driftsform. Brak is in every category, so it never counts. This is a
// warning, not a rule: mixing is allowed.
export const farmingSystemMismatchCount = (
  categories: RotationCategoryOption[],
  rotationVariants: string[],
  farmingSystem: FarmingSystem,
): number => {
  const matching = new Set(
    categories
      .filter((category) => category.croppingSystem === farmingSystem)
      .flatMap((category) =>
        category.rotations.map((rotation) => rotation.rotationVariant),
      ),
  )
  return rotationVariants.filter((variant) => !matching.has(variant)).length
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

// Expects values that passed simulationFormSchema.
export const toCreateSimulationInput = (
  values: SimulationFormValues,
): CreateSimulationInput => {
  const withoutFertiliser = values.fertiliserChoice === NO_FERTILISER
  return {
    name: values.name.trim(),
    allowedRotationVariants: values.rotationVariants,
    allowedNNormPercentages: values.nNormPercentages,
    fertiliser: {
      farmingSystem: values.farmingSystem,
      orgMineralN: withoutFertiliser ? 0 : Number(values.orgMineralN),
      mineralSharePct: withoutFertiliser ? 100 : Number(values.mineralSharePct),
      onlyOrganic: values.onlyOrganic,
      // Hidden without fertiliser, where whatever was typed earlier is ignored.
      nContentKgPerTon: withoutFertiliser
        ? Number(DEFAULT_SIMULATION_FORM_VALUES.nContentKgPerTon)
        : Number(values.nContentKgPerTon),
    },
    catchCropSowingDate: catchCropSowingDateOf(values),
    catchCropDailyBasis: values.catchCropDailyBasis,
    precisionFarming: values.precisionFarming,
    earlySowing: values.earlySowing,
    intermediateCrop: values.intermediateCrop,
  }
}
