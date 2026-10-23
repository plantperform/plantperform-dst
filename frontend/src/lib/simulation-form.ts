import { z } from 'zod'

import type {
  CreateSimulationInput,
  FarmingSystem,
  FertiliserPresetOption,
  FertiliserSettings,
  RotationCategoryOption,
  RotationOption,
  Simulation,
} from '@/api/types'
import { STANDARD_PROFILE_ID } from '@/lib/economics-profiles'
import { formatNumber } from '@/lib/field-domain'
import { SOWING_DATE_INTERVALS } from '@/lib/nles5-detail-labels'

// 'none' and 'custom' are fixed choices; any other value is a preset name.
export const NO_FERTILISER = 'none'
export const CUSTOM_FERTILISER = 'custom'

// 100 % is always calculated, as the reference for the lower N-norm levels.
// Only crops with a yield-response curve for the simulation's driftsform are
// cut below the norm; every other crop is fertilized at 100 %.
export const FULL_N_NORM = '100'
export const MAX_REDUCED_N_NORM_LEVELS = 2

const reducedNNormCount = (selected: string[]): number =>
  selected.filter((value) => value !== FULL_N_NORM).length

export const isNNormOptionLocked = (
  selected: string[],
  value: string,
): boolean =>
  value === FULL_N_NORM ||
  (!selected.includes(value) &&
    reducedNNormCount(selected) >= MAX_REDUCED_N_NORM_LEVELS)

export const toggleNNormPercentage = (
  selected: string[],
  value: string,
): string[] => {
  if (isNNormOptionLocked(selected, value)) return selected
  return selected.includes(value)
    ? selected.filter((current) => current !== value)
    : [...selected, value]
}

// The levels a simulation keeps, 100 % first.
export const nNormPercentagesFor = (selected: string[]): string[] => [
  FULL_N_NORM,
  ...selected.filter((value) => value !== FULL_N_NORM),
]

export const copiedNNormPercentages = (
  selected: string[],
  offered: string[],
): string[] =>
  nNormPercentagesFor(
    selected
      .filter((value) => value !== FULL_N_NORM && offered.includes(value))
      .sort((left, right) => Number(right) - Number(left))
      .slice(0, MAX_REDUCED_N_NORM_LEVELS),
  )

// Number inputs are kept as the strings the user typed, so an empty or
// half-typed field is not silently turned into a number.
export type SimulationFormValues = {
  name: string
  farmingSystem: FarmingSystem
  economicsProfileId: string
  chosenCrops: string[]
  optedOutCrops: string[]
  // Unique across categories: a variant such as brak ("1") belongs to several
  // categories but is selected once.
  rotationVariants: string[]
  nNormPercentages: string[]
  fertiliserChoice: string
  orgMineralN: string
  mineralSharePct: string
  onlyOrganic: boolean
  nContentKgPerTon: string
  includePrecedingCropValue: boolean
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
  economicsProfileId: STANDARD_PROFILE_ID,
  chosenCrops: [],
  optedOutCrops: [],
  rotationVariants: [],
  nNormPercentages: [FULL_N_NORM],
  fertiliserChoice: NO_FERTILISER,
  orgMineralN: '0',
  mineralSharePct: '100',
  onlyOrganic: false,
  nContentKgPerTon: '6',
  includePrecedingCropValue: true,
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

// Økologisk never tops up with handelsgødning, so its N has to come from
// organic fertiliser: "Ingen organisk gødning" is not offered for it.
export const offersNoFertiliser = (farmingSystem: FarmingSystem): boolean =>
  farmingSystem !== 'Økologisk'

// The fertiliser an økologisk simulation starts from when it had none.
export const organicFertiliserChoice = (
  presets: FertiliserPresetOption[],
): string => presets[0]?.name ?? CUSTOM_FERTILISER

// Økologisk organic fertiliser covers the whole N-norm, so only konventionel
// caps the utilised N it supplies (orgMineralN). Økologisk sends 0.
export const capsOrganicFertiliserN = (farmingSystem: FarmingSystem): boolean =>
  farmingSystem !== 'Økologisk'

export const organicFertiliserNLabel = (
  fertiliser: Pick<FertiliserSettings, 'farmingSystem' | 'orgMineralN'>,
): string =>
  capsOrganicFertiliserN(fertiliser.farmingSystem)
    ? `${formatNumber(fertiliser.orgMineralN)} kg N/ha`
    : 'Hele N-normen'

const ORGANIC_NEEDS_FERTILISER = 'Økologisk kræver organisk gødning'

// The number rules mirror the backend's FertiliserSettings; nContentKgPerTon
// has no backend rule but only makes sense above zero. The schema is loose so
// the rules can read the driftsform, which the basics step owns.
const nitrogenSchema = z
  .looseObject({
    fertiliserChoice: z.string(),
    orgMineralN: z.string(),
    mineralSharePct: z.string(),
    onlyOrganic: z.boolean(),
    nContentKgPerTon: z.string(),
    nNormPercentages: z
      .array(z.string())
      .refine((selected) => selected.includes(FULL_N_NORM), {
        message: '100 % skal altid være med',
      })
      .refine(
        (selected) => reducedNNormCount(selected) <= MAX_REDUCED_N_NORM_LEVELS,
        { message: 'Vælg højst to niveauer under 100 %' },
      ),
    includePrecedingCropValue: z.boolean(),
  })
  .superRefine((values, ctx) => {
    const organic = values.farmingSystem === 'Økologisk'
    // Without organic fertiliser the numbers are fixed and hidden.
    if (values.fertiliserChoice === NO_FERTILISER) {
      if (organic) {
        ctx.addIssue({
          code: 'custom',
          path: ['fertiliserChoice'],
          message: ORGANIC_NEEDS_FERTILISER,
        })
      }
      return
    }
    if (!organic) {
      checkNumberText(
        ctx,
        'orgMineralN',
        values.orgMineralN,
        (value) => value >= 0,
        'Skal være 0 eller mere',
      )
    }
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
      economicsProfileId: z.string(),
    }),
  },
  {
    id: 'crops',
    label: 'Afgrøder',
    schema: z.object({
      chosenCrops: z.array(z.string()).min(1, 'Vælg mindst en afgrøde'),
      optedOutCrops: z.array(z.string()),
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
  {
    id: 'limits',
    label: 'Grænser',
    // Constraints and optimization settings are validated by the panel.
    schema: z.object({}),
  },
  {
    id: 'confirm',
    label: 'Bekræft',
    // Reviews the saved settings; Save and Run are separate actions.
    schema: z.object({}),
  },
] as const

export type SimulationFormStepId = (typeof SIMULATION_FORM_STEPS)[number]['id']

export const stepIndexOf = (id: SimulationFormStepId): number =>
  SIMULATION_FORM_STEPS.findIndex((step) => step.id === id)

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

export type CropChoice = Pick<
  SimulationFormValues,
  'chosenCrops' | 'optedOutCrops'
>

export type RotationChoice = CropChoice &
  Pick<SimulationFormValues, 'rotationVariants'>

const byDanishName = (a: string, b: string) => a.localeCompare(b, 'da')

const rotationsByVariant = (
  categories: RotationCategoryOption[],
): Map<string, RotationOption> => {
  const byVariant = new Map<string, RotationOption>()
  for (const category of categories) {
    for (const rotation of category.rotations) {
      if (!byVariant.has(rotation.rotationVariant)) {
        byVariant.set(rotation.rotationVariant, rotation)
      }
    }
  }
  return byVariant
}

const cropsIn = (rotations: RotationOption[]): string[] =>
  Array.from(
    new Set(rotations.flatMap((rotation) => rotation.cropSequence)),
  ).sort(byDanishName)

const hasAnyCrop = (rotation: RotationOption, crops: string[]): boolean =>
  rotation.cropSequence.some((crop) => crops.includes(crop))

export const cropsForFarmingSystem = (
  categories: RotationCategoryOption[],
  farmingSystem: FarmingSystem,
): string[] =>
  cropsIn(
    categories
      .filter((category) => category.croppingSystem === farmingSystem)
      .flatMap((category) => category.rotations),
  )

const matchesCropChoice = (
  rotation: RotationOption,
  { chosenCrops, optedOutCrops }: CropChoice,
): boolean =>
  hasAnyCrop(rotation, chosenCrops) && !hasAnyCrop(rotation, optedOutCrops)

export const categoriesMatchingCropChoice = (
  categories: RotationCategoryOption[],
  choice: CropChoice,
): RotationCategoryOption[] =>
  categories.flatMap((category) => {
    const rotations = category.rotations.filter((rotation) =>
      matchesCropChoice(rotation, choice),
    )
    return rotations.length > 0 ? [{ ...category, rotations }] : []
  })

export const otherCrops = (
  categories: RotationCategoryOption[],
  chosenCrops: string[],
): string[] =>
  cropsIn(
    [...rotationsByVariant(categories).values()].filter((rotation) =>
      hasAnyCrop(rotation, chosenCrops),
    ),
  ).filter((crop) => !chosenCrops.includes(crop))

export const matchingRotationCount = (
  categories: RotationCategoryOption[],
  choice: CropChoice,
): number =>
  rotationsByVariant(categoriesMatchingCropChoice(categories, choice)).size

export const withCropChoice = (
  categories: RotationCategoryOption[],
  { chosenCrops, optedOutCrops, rotationVariants }: RotationChoice,
): RotationChoice => {
  const others = otherCrops(categories, chosenCrops)
  const choice = {
    chosenCrops: [...chosenCrops].sort(byDanishName),
    optedOutCrops: optedOutCrops
      .filter((crop) => others.includes(crop))
      .sort(byDanishName),
  }
  const byVariant = rotationsByVariant(categories)
  return {
    ...choice,
    rotationVariants: rotationVariants.filter((variant) => {
      const rotation = byVariant.get(variant)
      return rotation !== undefined && matchesCropChoice(rotation, choice)
    }),
  }
}

export const withFarmingSystem = (
  categories: RotationCategoryOption[],
  choice: RotationChoice,
  farmingSystem: FarmingSystem,
): RotationChoice => {
  if (choice.chosenCrops.length === 0) return choice
  const offered = cropsForFarmingSystem(categories, farmingSystem)
  return withCropChoice(categories, {
    ...choice,
    chosenCrops: choice.chosenCrops.filter((crop) => offered.includes(crop)),
  })
}

export const chosenCropsFor = (
  categories: RotationCategoryOption[],
  {
    rotationVariants,
    farmingSystem,
  }: Pick<SimulationFormValues, 'rotationVariants' | 'farmingSystem'>,
): string[] => {
  const offered = cropsForFarmingSystem(categories, farmingSystem)
  return cropsIn(selectedRotations(categories, rotationVariants)).filter(
    (crop) => offered.includes(crop),
  )
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

export const selectedCountsByCategory = (
  categories: RotationCategoryOption[],
  rotationVariants: string[],
): { category: string; count: number }[] =>
  categories
    .map((category) => ({
      category: category.category,
      count: selectedInCategory(category, rotationVariants),
    }))
    .filter(({ count }) => count > 0)

// The selected rotations in selection order, each once, with its crops.
export const selectedRotations = (
  categories: RotationCategoryOption[],
  rotationVariants: string[],
): RotationOption[] => {
  const byVariant = rotationsByVariant(categories)
  return rotationVariants.flatMap((variant) => byVariant.get(variant) ?? [])
}

// Rotations x N-norm levels x fields. The backend also crosses each rotation
// with all of its variants and drops duplicates, which the frontend cannot
// see, so this is not the exact number of candidates.
export const combinationCount = (
  values: Pick<SimulationFormValues, 'rotationVariants' | 'nNormPercentages'>,
  fieldCount: number,
): number =>
  values.rotationVariants.length * values.nNormPercentages.length * fieldCount

const OTHER_SYSTEM_PLURAL: Record<FarmingSystem, string> = {
  Konventionel: 'økologiske',
  Økologisk: 'konventionelle',
}

export const farmingSystemMismatchMessage = (
  count: number,
  farmingSystem: FarmingSystem,
): string =>
  `Du har valgt ${count} ${OTHER_SYSTEM_PLURAL[farmingSystem]} sædskifter til en ${farmingSystem.toLowerCase()} simulering.`

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

// True when a preset is chosen and its numbers were edited afterwards. The
// preset name is not sent, so this only labels the choice as tilpasset.
export const isPresetModified = (
  values: Pick<
    SimulationFormValues,
    'farmingSystem' | 'fertiliserChoice' | 'orgMineralN' | 'mineralSharePct'
  >,
  presets: FertiliserPresetOption[],
): boolean => {
  const preset = presets.find(
    (option) => option.name === values.fertiliserChoice,
  )
  if (!preset) return false
  return (
    (capsOrganicFertiliserN(values.farmingSystem) &&
      Number(values.orgMineralN) !== preset.fertiliser.orgMineralN) ||
    Number(values.mineralSharePct) !== preset.fertiliser.mineralSharePct
  )
}

export const catchCropSowingDateOf = (values: SimulationFormValues): string =>
  values.catchCropDailyBasis
    ? values.catchCropSowingDate
    : values.catchCropSowingInterval

export const yesNo = (value: boolean) => (value ? 'Ja' : 'Nej')

export const precedingCropValueLabel = (included: boolean) =>
  included ? 'Regnes med' : 'Regnes ikke med'

export const nNormPercentagesLabel = (percentages: string[]) =>
  [...percentages]
    .sort((a, b) => Number(a) - Number(b))
    .map((value) => `${value} %`)
    .join(', ')

export const catchCropSowingLabel = (date: string, dailyBasis: boolean) => {
  if (dailyBasis) return `${date} · dagsbasis §38`
  const interval = SOWING_DATE_INTERVALS.find((option) => option.date === date)
  return `${interval?.label ?? date} · trappesats §37`
}

// Expects values that passed simulationFormSchema.
export const toCreateSimulationInput = (
  values: SimulationFormValues,
): CreateSimulationInput => {
  const withoutFertiliser = values.fertiliserChoice === NO_FERTILISER
  const capped = capsOrganicFertiliserN(values.farmingSystem)
  return {
    name: values.name.trim(),
    allowedRotationVariants: values.rotationVariants,
    allowedNNormPercentages: nNormPercentagesFor(values.nNormPercentages),
    fertiliser: {
      farmingSystem: values.farmingSystem,
      orgMineralN:
        withoutFertiliser || !capped ? 0 : Number(values.orgMineralN),
      mineralSharePct: withoutFertiliser ? 100 : Number(values.mineralSharePct),
      // Økologisk never tops up with handelsgødning, whatever the draft holds.
      onlyOrganic: values.farmingSystem === 'Økologisk' || values.onlyOrganic,
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
    includePrecedingCropValue: values.includePrecedingCropValue,
  }
}

export const copiedSimulationName = (name: string) => `${name} (kopi)`

// An økologisk simulation always has organic fertiliser and no cap, so only
// its mineral share tells the type apart.
const fertiliserPresetOf = (
  fertiliser: FertiliserSettings,
  presets: FertiliserPresetOption[],
): FertiliserPresetOption | undefined => {
  const capped = capsOrganicFertiliserN(fertiliser.farmingSystem)
  return presets.find(
    (option) =>
      (!capped || option.fertiliser.orgMineralN === fertiliser.orgMineralN) &&
      option.fertiliser.mineralSharePct === fertiliser.mineralSharePct,
  )
}

const fertiliserChoiceOf = (
  fertiliser: FertiliserSettings,
  presets: FertiliserPresetOption[],
): string => {
  if (
    capsOrganicFertiliserN(fertiliser.farmingSystem) &&
    fertiliser.orgMineralN === 0 &&
    fertiliser.mineralSharePct === 100
  ) {
    return NO_FERTILISER
  }
  return fertiliserPresetOf(fertiliser, presets)?.name ?? CUSTOM_FERTILISER
}

export const simulationToFormValues = (
  simulation: Simulation,
  presets: FertiliserPresetOption[],
  offeredNNormPercentages: string[],
): SimulationFormValues => {
  const { fertiliser, catchCropDailyBasis, catchCropSowingDate } = simulation
  const isInterval = SOWING_DATE_INTERVALS.some(
    (interval) => interval.date === catchCropSowingDate,
  )
  return {
    ...DEFAULT_SIMULATION_FORM_VALUES,
    name: copiedSimulationName(simulation.name),
    farmingSystem: fertiliser.farmingSystem,
    rotationVariants: simulation.rotationVariants,
    nNormPercentages: copiedNNormPercentages(
      simulation.nNormPercentages,
      offeredNNormPercentages,
    ),
    fertiliserChoice: fertiliserChoiceOf(fertiliser, presets),
    // Økologisk stores no cap; the preset's keeps a later switch to
    // konventionel from starting at 0.
    orgMineralN: String(
      capsOrganicFertiliserN(fertiliser.farmingSystem)
        ? fertiliser.orgMineralN
        : (fertiliserPresetOf(fertiliser, presets)?.fertiliser.orgMineralN ??
            fertiliser.orgMineralN),
    ),
    mineralSharePct: String(fertiliser.mineralSharePct),
    onlyOrganic: fertiliser.onlyOrganic,
    nContentKgPerTon: String(fertiliser.nContentKgPerTon),
    catchCropDailyBasis,
    catchCropSowingInterval:
      !catchCropDailyBasis && isInterval
        ? catchCropSowingDate
        : DEFAULT_SIMULATION_FORM_VALUES.catchCropSowingInterval,
    catchCropSowingDate: catchCropDailyBasis
      ? catchCropSowingDate
      : DEFAULT_SIMULATION_FORM_VALUES.catchCropSowingDate,
    precisionFarming: simulation.precisionFarming,
    earlySowing: simulation.earlySowing,
    intermediateCrop: simulation.intermediateCrop,
    includePrecedingCropValue:
      simulation.includePrecedingCropValue ??
      DEFAULT_SIMULATION_FORM_VALUES.includePrecedingCropValue,
  }
}
