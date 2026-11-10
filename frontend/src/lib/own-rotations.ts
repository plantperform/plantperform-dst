import { ApiError } from '@/api/client'
import type {
  CropCodeOption,
  FarmingSystem,
  RotationDefinition,
  RotationDefinitionInput,
  RotationDefinitionVariant,
  RotationOptionsError,
} from '@/api/types'
import { formatCount, formatNameList } from '@/lib/economics'
import { formatWholeNumber } from '@/lib/field-domain'

export const MAX_ROTATION_YEARS = 8
const MAX_OWN_ROTATION_COMBINATIONS = 4096
export const MAX_OWN_ROTATIONS_IN_SIMULATION = 50

export type OwnRotationYear = {
  cropCode: number | null
  undersownCropCodes: number[]
  origin?: number
}

type OwnRotationVariantDraft = {
  id: string | null
  years: OwnRotationYear[]
}

export type OwnRotationDraft = {
  name: string
  farmingSystem: FarmingSystem | null
  variants: OwnRotationVariantDraft[]
}

const sortedCodes = (codes: number[]): number[] =>
  Array.from(new Set(codes)).sort((left, right) => left - right)

export const DELETE_ROTATION_DIALOG = {
  description:
    'Sædskiftet slettes for alle, det er delt med, og fjernes fra de simuleringer, hvor det er valgt. Deres resultater bliver forældede.',
  confirmLabel: 'Slet sædskifte',
}

export const copyableLibraryRotationsOf = (
  library: RotationDefinition[],
): RotationDefinition[] => library.filter((definition) => definition.canCopy)

export const libraryCropOptions = (
  crops: CropCodeOption[],
  library: RotationDefinition[],
): CropCodeOption[] => {
  const libraryCodes = new Set(
    library
      .flatMap((definition) => definition.variants)
      .flatMap((variant) =>
        variant.positions.map((position) => position.cropCode),
      ),
  )
  return crops.filter((crop) => libraryCodes.has(crop.code))
}

const emptyYear = (): OwnRotationYear => ({
  cropCode: null,
  undersownCropCodes: [],
})

export const newOwnRotationDraft = (): OwnRotationDraft => ({
  name: '',
  farmingSystem: null,
  variants: [{ id: null, years: [emptyYear()] }],
})

export const draftFromDefinition = (
  definition: RotationDefinition,
): OwnRotationDraft => ({
  name: definition.name,
  farmingSystem: definition.farmingSystem,
  variants: definition.variants.map((variant) => ({
    id: variant.id,
    years: variant.positions.map((position, index) => ({
      cropCode: position.cropCode,
      undersownCropCodes: sortedCodes(position.allowedUndersownCropCodes),
      origin: index,
    })),
  })),
})

export const definitionInputFromDraft = (
  draft: OwnRotationDraft,
): RotationDefinitionInput => ({
  name: draft.name.trim(),
  farmingSystem: draft.farmingSystem,
  variants: draft.variants.map((variant) => ({
    ...(variant.id === null ? {} : { id: variant.id }),
    positions: variant.years.map((year) => {
      if (year.cropCode === null) {
        throw new Error('Every year of a rotation needs a crop')
      }
      return {
        cropCode: year.cropCode,
        allowedUndersownCropCodes: sortedCodes(year.undersownCropCodes),
      }
    }),
  })),
})

const normalizedDraft = (draft: OwnRotationDraft) => ({
  name: draft.name.trim(),
  farmingSystem: draft.farmingSystem,
  variants: draft.variants.map((variant) => ({
    id: variant.id,
    years: variant.years.map((year) => ({
      cropCode: year.cropCode,
      undersownCropCodes: sortedCodes(year.undersownCropCodes),
    })),
  })),
})

export const isDraftChanged = (
  draft: OwnRotationDraft,
  definition: RotationDefinition | null,
): boolean =>
  JSON.stringify(normalizedDraft(draft)) !==
  JSON.stringify(
    normalizedDraft(
      definition ? draftFromDefinition(definition) : newOwnRotationDraft(),
    ),
  )

const updateVariant = (
  draft: OwnRotationDraft,
  variantIndex: number,
  update: (variant: OwnRotationVariantDraft) => OwnRotationVariantDraft,
): OwnRotationDraft => ({
  ...draft,
  variants: draft.variants.map((variant, index) =>
    index === variantIndex ? update(variant) : variant,
  ),
})

const updateYear = (
  draft: OwnRotationDraft,
  variantIndex: number,
  yearIndex: number,
  update: (year: OwnRotationYear) => OwnRotationYear,
): OwnRotationDraft =>
  updateVariant(draft, variantIndex, (variant) => ({
    ...variant,
    years: variant.years.map((year, index) =>
      index === yearIndex ? update(year) : year,
    ),
  }))

export const setYearCrop = (
  draft: OwnRotationDraft,
  variantIndex: number,
  yearIndex: number,
  cropCode: number,
  undersownCropCode: number | null = null,
): OwnRotationDraft =>
  updateYear(draft, variantIndex, yearIndex, (year) =>
    year.cropCode === cropCode
      ? year
      : {
          ...year,
          cropCode,
          undersownCropCodes:
            undersownCropCode === null ? [] : [undersownCropCode],
        },
  )

export const keepAllowedUndersownCrops = (
  draft: OwnRotationDraft,
  variantIndex: number,
  yearIndex: number,
  allowed: ReadonlySet<number>,
): OwnRotationDraft =>
  updateYear(draft, variantIndex, yearIndex, (year) =>
    year.undersownCropCodes.every((code) => allowed.has(code))
      ? year
      : {
          ...year,
          undersownCropCodes: year.undersownCropCodes.filter((code) =>
            allowed.has(code),
          ),
        },
  )

export const setYearUndersownCrop = (
  draft: OwnRotationDraft,
  variantIndex: number,
  yearIndex: number,
  code: number | null,
): OwnRotationDraft =>
  updateYear(draft, variantIndex, yearIndex, (year) => ({
    ...year,
    undersownCropCodes: code === null ? [] : [code],
  }))

export const addYear = (
  draft: OwnRotationDraft,
  variantIndex: number,
): OwnRotationDraft =>
  insertYearAfter(
    draft,
    variantIndex,
    draft.variants[variantIndex].years.length - 1,
  )

export const removeYear = (
  draft: OwnRotationDraft,
  variantIndex: number,
  yearIndex: number,
): OwnRotationDraft =>
  updateVariant(draft, variantIndex, (variant) =>
    variant.years.length <= 1
      ? variant
      : {
          ...variant,
          years: variant.years.filter((_, index) => index !== yearIndex),
        },
  )

export const insertYearAfter = (
  draft: OwnRotationDraft,
  variantIndex: number,
  yearIndex: number,
): OwnRotationDraft =>
  updateVariant(draft, variantIndex, (variant) =>
    variant.years.length >= MAX_ROTATION_YEARS
      ? variant
      : {
          ...variant,
          years: [
            ...variant.years.slice(0, yearIndex + 1),
            emptyYear(),
            ...variant.years.slice(yearIndex + 1),
          ],
        },
  )

export const moveYear = (
  draft: OwnRotationDraft,
  variantIndex: number,
  from: number,
  to: number,
): OwnRotationDraft =>
  updateVariant(draft, variantIndex, (variant) => {
    if (from === to || to < 0 || to >= variant.years.length) return variant
    const years = [...variant.years]
    const [moved] = years.splice(from, 1)
    years.splice(to, 0, moved)
    return { ...variant, years }
  })

export const removeVariant = (
  draft: OwnRotationDraft,
  variantIndex: number,
): OwnRotationDraft =>
  draft.variants.length <= 1
    ? draft
    : {
        ...draft,
        variants: draft.variants.filter((_, index) => index !== variantIndex),
      }

export const nextYearIndex = (yearCount: number, yearIndex: number): number =>
  (yearIndex + 1) % yearCount

type YearPosition = { variantIndex: number; yearIndex: number }

const cropPair = (variant: OwnRotationVariantDraft, yearIndex: number) =>
  `${variant.years[yearIndex].cropCode}>${
    variant.years[nextYearIndex(variant.years.length, yearIndex)].cropCode
  }`

export const yearsToRecheck = (
  before: OwnRotationDraft,
  after: OwnRotationDraft,
): YearPosition[] => {
  const farmingSystemChanged = before.farmingSystem !== after.farmingSystem
  if (
    !farmingSystemChanged &&
    before.variants.length !== after.variants.length
  ) {
    return []
  }
  return after.variants.flatMap((variant, variantIndex) => {
    const previous = before.variants[variantIndex]
    return variant.years.flatMap((year, yearIndex) => {
      if (year.cropCode === null || year.undersownCropCodes.length === 0) {
        return []
      }
      if (farmingSystemChanged) return [{ variantIndex, yearIndex }]
      const kept = previous.years.indexOf(year)
      const from =
        kept !== -1
          ? kept
          : previous.years[yearIndex]?.cropCode === year.cropCode
            ? yearIndex
            : -1
      return from !== -1 &&
        cropPair(previous, from) === cropPair(variant, yearIndex)
        ? []
        : [{ variantIndex, yearIndex }]
    })
  })
}

export type YearStatus = 'saved' | 'changed' | 'new'

const sameCodes = (left: number[], right: number[]): boolean =>
  sortedCodes(left).join() === sortedCodes(right).join()

const savedVariantOf = (
  saved: OwnRotationDraft,
  variant: OwnRotationVariantDraft,
): OwnRotationVariantDraft | undefined =>
  variant.id === null
    ? undefined
    : saved.variants.find((candidate) => candidate.id === variant.id)

export const yearStatus = (
  saved: OwnRotationDraft,
  variant: OwnRotationVariantDraft,
  yearIndex: number,
): YearStatus => {
  const year = variant.years[yearIndex]
  const before =
    year.origin === undefined
      ? undefined
      : savedVariantOf(saved, variant)?.years[year.origin]
  if (before === undefined) return 'new'
  return year.origin === yearIndex &&
    year.cropCode === before.cropCode &&
    sameCodes(year.undersownCropCodes, before.undersownCropCodes)
    ? 'saved'
    : 'changed'
}

export const draftChangeCount = (
  draft: OwnRotationDraft,
  saved: OwnRotationDraft,
): number => {
  const variantChanges = draft.variants.reduce((count, variant) => {
    const before = savedVariantOf(saved, variant)
    const kept = new Set(variant.years.map((year) => year.origin))
    const removed = before
      ? before.years.filter((_, index) => !kept.has(index)).length
      : 0
    const changed = variant.years.filter(
      (_, index) => yearStatus(saved, variant, index) !== 'saved',
    ).length
    return count + changed + removed
  }, 0)
  const removedVariants = saved.variants.filter(
    (variant) => !draft.variants.some((current) => current.id === variant.id),
  ).length
  return (
    (draft.name.trim() === saved.name.trim() ? 0 : 1) +
    (draft.farmingSystem === saved.farmingSystem ? 0 : 1) +
    variantChanges +
    removedVariants
  )
}

export const describeChangeCount = (count: number): string =>
  `${formatCount(count, 'ændring', 'ændringer')}, der ikke er gemt.`

export const describeLostChanges = (
  draft: OwnRotationDraft,
  saved: OwnRotationDraft,
): string | null => {
  const count = draftChangeCount(draft, saved)
  if (count === 0) return null
  const variant = draft.variants[0]
  const years =
    draft.variants.length === 1
      ? variant.years.flatMap((_, index) =>
          yearStatus(saved, variant, index) === 'saved' ? [] : [index + 1],
        )
      : []
  if (years.length === count) {
    return years.length === 1
      ? `Din ændring i ${years[0]}. år går tabt.`
      : `Dine ændringer i ${formatNameList(years.map((year) => `${year}.`))} år går tabt.`
  }
  return count === 1 ? 'Din ændring går tabt.' : 'Dine ændringer går tabt.'
}

export const describeRemovedUndersown = (
  count: number,
  reason: string,
): string =>
  `${formatCount(count, 'virkemiddel', 'virkemidler')} blev fjernet, fordi ${reason}.`

export const describeUndersownFit = (
  count: number,
  cropName: string,
  nextCropName: string | null,
  farmingSystem: FarmingSystem | null,
): string =>
  [
    `${formatCount(count, 'virkemiddel', 'virkemidler')} passer`,
    ` til ${cropName}`,
    nextCropName ? ` før ${nextCropName}` : '',
    farmingSystem ? ` i ${farmingSystem.toLowerCase()} drift` : '',
  ].join('')

const dayFormat = new Intl.DateTimeFormat('da-DK', {
  day: 'numeric',
  month: 'long',
})

const timeFormat = new Intl.DateTimeFormat('da-DK', {
  hour: '2-digit',
  minute: '2-digit',
})

const describeDay = (iso: string): string => dayFormat.format(new Date(iso))

export const describeSavedAt = (iso: string): string =>
  `Sidst gemt ${describeDay(iso)} kl. ${timeFormat.format(new Date(iso))}`

export type CreationStep = { label: string; done: boolean }

export const creationChecklist = (
  draft: OwnRotationDraft,
  nameTaken = false,
): CreationStep[] => {
  const missing = draft.variants.flatMap((variant) =>
    variant.years.flatMap((year, index) =>
      year.cropCode === null ? [index] : [],
    ),
  )
  return [
    { label: 'Navn', done: draft.name.trim() !== '' && !nameTaken },
    { label: 'Driftsform', done: draft.farmingSystem !== null },
    {
      label:
        missing.length === 1 &&
        draft.variants.length === 1 &&
        draft.variants[0].years.length > 1
          ? `Afgrøde i ${missing[0] + 1}. år`
          : 'Afgrøde i hvert år',
      done: missing.length === 0,
    },
  ]
}

export const libraryUndersownDefaults = (
  library: RotationDefinition[],
): Map<string, number> => {
  const counts = new Map<string, Map<number, number>>()
  const count = (key: string, code: number) => {
    const codes = counts.get(key) ?? new Map<number, number>()
    codes.set(code, (codes.get(code) ?? 0) + 1)
    counts.set(key, codes)
  }
  for (const definition of library) {
    for (const variant of definition.variants) {
      for (const position of variant.positions) {
        const code = position.allowedUndersownCropCodes[0] ?? 0
        count(`${definition.farmingSystem ?? ''}:${position.cropCode}`, code)
        if (definition.farmingSystem !== null) {
          count(`:${position.cropCode}`, code)
        }
      }
    }
  }
  const defaults = new Map<string, number>()
  for (const [key, codes] of counts) {
    const [code] = [...codes].sort(
      ([leftCode, left], [rightCode, right]) =>
        right - left || leftCode - rightCode,
    )[0]
    if (code !== 0) defaults.set(key, code)
  }
  return defaults
}

export const defaultUndersownCrop = (
  defaults: Map<string, number>,
  cropCode: number,
  farmingSystem: FarmingSystem | null,
): number | null => defaults.get(`${farmingSystem ?? ''}:${cropCode}`) ?? null

export const describeYearCount = (count: number): string => `${count} år`

const errorCode = (detail: unknown): string | null =>
  typeof detail === 'object' &&
  detail !== null &&
  'code' in detail &&
  typeof detail.code === 'string'
    ? detail.code
    : null

const codeProblem = (code: string): string => {
  switch (code) {
    case 'TOO_MANY_CUSTOM_CANDIDATES':
      return `Dine egne sædskifter giver for mange kombinationer, højst ${formatWholeNumber(MAX_OWN_ROTATION_COMBINATIONS)} med de valgte N-normniveauer. Vælg færre egne sædskifter eller N-normniveauer, eller fjern nogle virkemidler.`
    case 'ROTATION_DELETED':
      return 'Et af de valgte egne sædskifter findes ikke længere. Vælg sædskifterne igen.'
    case 'ROTATION_VARIANT_UNAVAILABLE':
      return 'Det egne sædskifte er rettet, så udgaven på marken findes ikke længere. Vælg sædskiftet igen.'
    case 'UDLAEG_NOT_PERMITTED':
      return 'Det egne sædskifte tillader ikke det virkemiddel i dette år.'
    default:
      return 'Et eget sædskifte kan ikke bruges, som det er nu.'
  }
}

export const ownRotationProblem = (
  status: number,
  detail: unknown,
): string | null => {
  const code = errorCode(detail)
  if (status === 404) {
    return code === 'ROTATION_NOT_FOUND'
      ? 'Et af de valgte egne sædskifter findes ikke længere, eller det er ikke delt med dig. Vælg sædskifterne igen.'
      : null
  }
  return status === 422 && code !== null ? codeProblem(code) : null
}

export const ownRotationErrorText = (error: unknown): string | null =>
  error instanceof ApiError
    ? ownRotationProblem(error.status, error.detail)
    : null

export const rotationErrorMessage = (
  error: unknown,
  fallback: string,
): string =>
  ownRotationErrorText(error) ??
  (error instanceof Error ? error.message : fallback)

export const describeRotationOptionsError = (
  error: RotationOptionsError,
): string =>
  `Et eget sædskifte i simuleringen er rettet, siden den blev regnet. ${codeProblem(
    error.code,
  )} Tallene er fra sidste kørsel.`

export const ownVariantToken = (variant: RotationDefinitionVariant): string =>
  `${variant.id}~${variant.positions
    .map((position) => position.allowedUndersownCropCodes[0] ?? 0)
    .join('-')}`

export const ownVariantOf = (
  group: Pick<RotationDefinition, 'variants'>,
  token: string,
): RotationDefinitionVariant | undefined =>
  group.variants.find((variant) => token.startsWith(`${variant.id}~`))

export const allowedUndersownAt = (
  variant: RotationDefinitionVariant,
  startYear: number,
  yearIndex: number,
): number[] => {
  const length = variant.positions.length
  const index = (((startYear - 1 + yearIndex) % length) + length) % length
  return variant.positions[index].allowedUndersownCropCodes
}

export const definitionCropNames = (
  definition: RotationDefinition,
  cropNames: Map<number, string>,
): string[] =>
  (definition.variants[0]?.positions ?? []).map(
    (position) =>
      cropNames.get(position.cropCode) ?? `Afgrøde ${position.cropCode}`,
  )
