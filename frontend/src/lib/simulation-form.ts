import { z } from 'zod'

import type {
  AutumnAllocation,
  AutumnCropOption,
  AutumnFertiliser,
  CreateSimulationInput,
  FarmingSystem,
  FertiliserPresetOption,
  FertiliserSettings,
  OrganicNCeiling,
  RotationCategoryOption,
  RotationOption,
  Simulation,
} from '@/api/types'
import { STANDARD_PROFILE_ID } from '@/lib/economics-profiles'
import { formatNumber } from '@/lib/field-domain'
import {
  NTHETA_COEFFICIENTS,
  SOWING_DATE_INTERVALS,
} from '@/lib/nles5-detail-labels'
import { MAX_OWN_ROTATIONS_IN_SIMULATION } from '@/lib/own-rotations'

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

export type AutumnAllocationDraft = {
  cropCode: number
  kgNHa: string
  fertiliserType: AutumnFertiliser
}

// The basic støtte's ceiling is what an økologisk simulation starts from.
export const DEFAULT_ORGANIC_N_CEILING: OrganicNCeiling = 107

// Number inputs are kept as the strings the user typed, so an empty or
// half-typed field is not silently turned into a number.
export type SimulationFormValues = {
  name: string
  farmingSystem: FarmingSystem
  // Chosen for økologisk only; konventionel keeps the default and sends it
  // unused.
  organicNCeiling: OrganicNCeiling
  economicsProfileId: string
  // The crops the farm will grow. A crop that is not chosen is opted out.
  chosenCrops: string[]
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
  autumnAllocationEnabled: boolean
  autumnAllocations: AutumnAllocationDraft[]
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
  organicNCeiling: DEFAULT_ORGANIC_N_CEILING,
  economicsProfileId: STANDARD_PROFILE_ID,
  chosenCrops: [],
  rotationVariants: [],
  nNormPercentages: [FULL_N_NORM],
  fertiliserChoice: NO_FERTILISER,
  orgMineralN: '0',
  mineralSharePct: '100',
  onlyOrganic: false,
  nContentKgPerTon: '6',
  includePrecedingCropValue: true,
  autumnAllocationEnabled: false,
  autumnAllocations: [],
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

export const ORGANIC_N_CEILING_SUPPORT: Record<OrganicNCeiling, string> = {
  107: 'Basisstøtte',
  65: 'Basisstøtte og tillæg for reduceret N-tilførsel',
}

// The ceiling a simulation holds the farm's average utilised N per ha
// harmoniareal to, with the støtte it gives. Konventionel has none.
export const organicNCeilingLabel = (
  fertiliser: Pick<FertiliserSettings, 'farmingSystem' | 'organicNCeiling'>,
): string | null =>
  fertiliser.farmingSystem === 'Økologisk'
    ? `${fertiliser.organicNCeiling} kg N pr. ha harmoniareal · ${ORGANIC_N_CEILING_SUPPORT[fertiliser.organicNCeiling]}`
    : null

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
    autumnAllocationEnabled: z.boolean(),
    autumnAllocations: z.array(
      z.object({
        cropCode: z.number(),
        kgNHa: z.string(),
        fertiliserType: z.enum(['mineral', 'manure']),
      }),
    ),
  })
  .superRefine((values, ctx) => {
    if (
      values.autumnAllocationEnabled &&
      values.autumnAllocations.some(({ kgNHa }) => !(Number(kgNHa) >= 0))
    ) {
      ctx.addIssue({
        code: 'custom',
        path: ['autumnAllocations'],
        message: 'Angiv 0 eller mere for hver afgrøde',
      })
    }
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
      organicNCeiling: z.union([z.literal(107), z.literal(65)]),
      economicsProfileId: z.string(),
    }),
  },
  {
    id: 'crops',
    label: 'Afgrøder',
    schema: z.object({
      chosenCrops: z.array(z.string()).min(1, 'Vælg mindst en afgrøde'),
    }),
  },
  {
    id: 'rotations',
    label: 'Sædskifter',
    schema: z.object({
      rotationVariants: z.array(z.string()).min(1, 'Vælg mindst ét sædskifte'),
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
    id: 'quotaTrade',
    label: 'Kvotehandel',
    // The kvotehandel draft is validated by the panel, like the limits.
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
        ctx.addIssue({
          code: 'custom',
          path: issue.path,
          message: issue.message,
        })
      }
    }
  })

export const toggleValue = (values: string[], value: string): string[] =>
  values.includes(value)
    ? values.filter((current) => current !== value)
    : [...values, value]

export type GroupSelection = 'none' | 'some' | 'all'

export const groupSelection = (
  values: string[],
  group: string[],
): GroupSelection => {
  const selected = group.filter((value) => values.includes(value)).length
  if (selected === 0) return 'none'
  return selected === group.length ? 'all' : 'some'
}

// A group is selected as a whole, or cleared when all of it already is.
export const toggleGroup = (values: string[], group: string[]): string[] =>
  groupSelection(values, group) === 'all'
    ? values.filter((value) => !group.includes(value))
    : [...values, ...group.filter((value) => !values.includes(value))]

// Only the crops of the chosen rotations are listed for exclusion, so the
// exclusion of any other crop stays as it is.
export const excludedCropCodesAfter = (
  excludedCodes: number[],
  listedCodes: number[],
  includedCodes: number[],
): number[] => [
  ...excludedCodes.filter((code) => !listedCodes.includes(code)),
  ...listedCodes.filter((code) => !includedCodes.includes(code)),
]

export const selectedInCategory = (
  category: RotationCategoryOption,
  rotationVariants: string[],
): number => {
  const selected = new Set(rotationVariants)
  return category.rotations.filter((rotation) =>
    selected.has(rotation.rotationVariant),
  ).length
}

export type CropChoice = Pick<SimulationFormValues, 'chosenCrops'>

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

const fitsFarmingSystem = (
  category: RotationCategoryOption,
  farmingSystem: FarmingSystem,
): boolean =>
  category.croppingSystem === null || category.croppingSystem === farmingSystem

export const cropsForFarmingSystem = (
  categories: RotationCategoryOption[],
  farmingSystem: FarmingSystem,
): string[] =>
  cropsIn(
    categories
      .filter((category) => fitsFarmingSystem(category, farmingSystem))
      .flatMap((category) => category.rotations),
  )

// A crop that is not chosen is opted out, so a rotation fits only when every
// crop in it is chosen.
const matchesCropChoice = (
  rotation: RotationOption,
  { chosenCrops }: CropChoice,
): boolean =>
  rotation.cropSequence.length > 0 &&
  rotation.cropSequence.every((crop) => chosenCrops.includes(crop))

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

export const matchingRotationCount = (
  categories: RotationCategoryOption[],
  choice: CropChoice,
): number =>
  rotationsByVariant(categoriesMatchingCropChoice(categories, choice)).size

export const withCropChoice = (
  categories: RotationCategoryOption[],
  { chosenCrops, rotationVariants }: RotationChoice,
): RotationChoice => {
  const choice = { chosenCrops: [...chosenCrops].sort(byDanishName) }
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

export const ownRotationVariantsOf = (
  categories: RotationCategoryOption[],
): Set<string> =>
  new Set(
    categories
      .filter((category) => category.croppingSystem === null)
      .flatMap((category) =>
        category.rotations.map((rotation) => rotation.rotationVariant),
      ),
  )

export const selectableRotationCategories = (
  categories: RotationCategoryOption[],
  ownRotationIds: ReadonlySet<string>,
  keptRotationVariants: readonly string[],
): RotationCategoryOption[] =>
  categories.flatMap((category) => {
    if (category.croppingSystem !== null) return [category]
    const rotations = category.rotations.filter(
      (rotation) =>
        ownRotationIds.has(rotation.rotationVariant) ||
        keptRotationVariants.includes(rotation.rotationVariant),
    )
    return rotations.length === 0
      ? []
      : [{ ...category, rotationCount: rotations.length, rotations }]
  })

const OWN_ROTATION_ID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export const selectableRotationVariants = (
  rotationVariants: string[],
  categories: RotationCategoryOption[],
  selectable: RotationCategoryOption[],
  ownRotationIds: ReadonlySet<string>,
): string[] => {
  const listed = new Set(
    categories.flatMap((category) =>
      category.rotations.map((rotation) => rotation.rotationVariant),
    ),
  )
  const own = ownRotationVariantsOf(categories)
  const allowed = ownRotationVariantsOf(selectable)
  return rotationVariants.filter((variant) =>
    listed.has(variant)
      ? !own.has(variant) || allowed.has(variant)
      : ownRotationIds.has(variant) || !OWN_ROTATION_ID.test(variant),
  )
}

export const selectRotationsWithinLimit = (
  rotationVariants: string[],
  rotations: RotationOption[],
  ownVariants: Set<string>,
): string[] => {
  const selected = new Set(rotationVariants)
  let ownCount = rotationVariants.filter((variant) =>
    ownVariants.has(variant),
  ).length
  const added: string[] = []
  for (const { rotationVariant } of rotations) {
    if (selected.has(rotationVariant)) continue
    if (ownVariants.has(rotationVariant)) {
      if (ownCount >= MAX_OWN_ROTATIONS_IN_SIMULATION) continue
      ownCount += 1
    }
    selected.add(rotationVariant)
    added.push(rotationVariant)
  }
  return [...rotationVariants, ...added]
}

// Categories for the chosen driftsform first, keeping their order otherwise.
export const orderCategoriesForFarmingSystem = (
  categories: RotationCategoryOption[],
  farmingSystem: FarmingSystem,
): RotationCategoryOption[] => [
  ...categories.filter((category) =>
    fitsFarmingSystem(category, farmingSystem),
  ),
  ...categories.filter(
    (category) => !fitsFarmingSystem(category, farmingSystem),
  ),
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
      .filter((category) => fitsFarmingSystem(category, farmingSystem))
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

export type InitialRotations = {
  rotationVariants: string[]
  farmingSystem: FarmingSystem | null
}

export const initialFormValues = (
  categories: RotationCategoryOption[],
  presets: FertiliserPresetOption[],
  rotations: InitialRotations,
): SimulationFormValues => {
  const farmingSystem =
    rotations.farmingSystem ?? DEFAULT_SIMULATION_FORM_VALUES.farmingSystem
  const fertiliserChoice = offersNoFertiliser(farmingSystem)
    ? NO_FERTILISER
    : organicFertiliserChoice(presets)
  const { rotationVariants } = rotations
  return {
    ...DEFAULT_SIMULATION_FORM_VALUES,
    farmingSystem,
    onlyOrganic: farmingSystem === 'Økologisk',
    fertiliserChoice,
    ...fertiliserFieldsForChoice(fertiliserChoice, presets, farmingSystem),
    rotationVariants,
    chosenCrops: chosenCropsFor(categories, {
      rotationVariants,
      farmingSystem,
    }),
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

// One kg of mineral N weighs this much more in NLES5's N term in autumn than in
// spring. Everything else in a year's leaching is the same for both.
export const AUTUMN_N_EXTRA_LEACHING_PCT =
  (NTHETA_COEFFICIENTS.bCA / NTHETA_COEFFICIENTS.bCS - 1) * 100

export const AUTUMN_FERTILISER_LABELS: Record<AutumnFertiliser, string> = {
  mineral: 'Handelsgødning',
  manure: 'Husdyrgødning',
}

// With only one kind of gødning there is nothing to choose between. Konventionel
// with a cap of 0 has no husdyrgødning, whatever the fertiliser choice is called.
export const forcedAutumnFertiliser = (
  values: Pick<
    SimulationFormValues,
    'farmingSystem' | 'fertiliserChoice' | 'onlyOrganic' | 'orgMineralN'
  >,
): AutumnFertiliser | null => {
  if (values.farmingSystem === 'Økologisk' || values.onlyOrganic) {
    return 'manure'
  }
  return values.fertiliserChoice === NO_FERTILISER ||
    !(Number(values.orgMineralN) > 0)
    ? 'mineral'
    : null
}

// Only the crops of the chosen rotations are offered.
export const listedAutumnCrops = (
  crops: AutumnCropOption[],
  categories: RotationCategoryOption[],
  rotationVariants: string[],
): AutumnCropOption[] => {
  const names = new Set(
    selectedRotations(categories, rotationVariants).flatMap(
      (rotation) => rotation.cropSequence,
    ),
  )
  return crops.filter((crop) => names.has(crop.name))
}

export const autumnCropGroups = (
  crops: AutumnCropOption[],
): { group: string; crops: AutumnCropOption[] }[] =>
  Array.from(new Set(crops.map((crop) => crop.group)), (group) => ({
    group,
    crops: crops.filter((crop) => crop.group === group),
  }))

export const autumnDraftFor = (
  drafts: AutumnAllocationDraft[],
  cropCode: number,
): AutumnAllocationDraft =>
  drafts.find((draft) => draft.cropCode === cropCode) ?? {
    cropCode,
    kgNHa: '',
    fertiliserType: 'mineral',
  }

export const withAutumnDraft = (
  drafts: AutumnAllocationDraft[],
  next: AutumnAllocationDraft,
): AutumnAllocationDraft[] => [
  ...drafts.filter((draft) => draft.cropCode !== next.cropCode),
  next,
]

// A crop that left the chosen rotations takes its amount with it.
export const keepListedAutumnDrafts = (
  drafts: AutumnAllocationDraft[],
  listed: AutumnCropOption[],
): AutumnAllocationDraft[] =>
  drafts.filter((draft) =>
    listed.some((crop) => crop.cropCode === draft.cropCode),
  )

const autumnAllocationsOf = (
  values: SimulationFormValues,
): AutumnAllocation[] => {
  if (!values.autumnAllocationEnabled) return []
  const forced = forcedAutumnFertiliser(values)
  return values.autumnAllocations
    .filter((draft) => Number(draft.kgNHa) > 0)
    .map((draft) => ({
      cropCode: draft.cropCode,
      kgNHa: Number(draft.kgNHa),
      fertiliserType: forced ?? draft.fertiliserType,
    }))
}

export const autumnAllocationLabel = (
  allocations: AutumnAllocation[],
  cropLabelFor: (cropCode: number) => string,
): string =>
  allocations.length === 0
    ? 'Fra'
    : allocations
        .map(
          ({ cropCode, kgNHa, fertiliserType }) =>
            `${cropLabelFor(cropCode)}: ${formatNumber(kgNHa)} kg N/ha, ${AUTUMN_FERTILISER_LABELS[fertiliserType].toLocaleLowerCase('da-DK')}`,
        )
        .join(' · ')

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
      autumnAllocations: autumnAllocationsOf(values),
      // Konventionel has no ceiling, so an earlier økologisk choice is not kept.
      organicNCeiling:
        values.farmingSystem === 'Økologisk'
          ? values.organicNCeiling
          : DEFAULT_ORGANIC_N_CEILING,
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
  const autumnAllocations = fertiliser.autumnAllocations ?? []
  const isInterval = SOWING_DATE_INTERVALS.some(
    (interval) => interval.date === catchCropSowingDate,
  )
  return {
    ...DEFAULT_SIMULATION_FORM_VALUES,
    name: copiedSimulationName(simulation.name),
    farmingSystem: fertiliser.farmingSystem,
    organicNCeiling: fertiliser.organicNCeiling,
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
    autumnAllocationEnabled: autumnAllocations.length > 0,
    autumnAllocations: autumnAllocations.map((allocation) => ({
      ...allocation,
      kgNHa: String(allocation.kgNHa),
    })),
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
