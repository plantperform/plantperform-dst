import { describe, expect, it } from 'vitest'

import { ApiError } from '@/api/client'
import type { RotationDefinition } from '@/api/types'
import {
  MAX_ROTATION_YEARS,
  addYear,
  allowedUndersownAt,
  creationChecklist,
  defaultUndersownCrop,
  definitionInputFromDraft,
  describeRotationOptionsError,
  draftChangeCount,
  draftFromDefinition,
  insertYearAfter,
  isDraftChanged,
  keepAllowedUndersownCrops,
  libraryCropOptions,
  libraryUndersownDefaults,
  moveYear,
  newOwnRotationDraft,
  ownRotationProblem,
  ownVariantOf,
  ownVariantToken,
  removeYear,
  rotationErrorMessage,
  setYearCrop,
  setYearUndersownCrop,
  yearStatus,
  yearsToRecheck,
} from '@/lib/own-rotations'

const WINTER_WHEAT = 11
const SPRING_BARLEY = 1
const SPRING_OATS = 3
const EARLY_SOWING = 9683
const CATCH_CROP = 951

const definition = (
  overrides: Partial<RotationDefinition> = {},
): RotationDefinition => ({
  id: 'own-1',
  name: 'Korn med efterafgrøder',
  farmingSystem: 'Konventionel',
  variants: [
    {
      id: 'variant-1',
      positions: [
        { cropCode: WINTER_WHEAT, allowedUndersownCropCodes: [CATCH_CROP] },
        { cropCode: SPRING_BARLEY, allowedUndersownCropCodes: [] },
      ],
    },
  ],
  revision: 3,
  isStandard: false,
  canCopy: true,
  createdAt: null,
  updatedAt: null,
  ...overrides,
})

describe('libraryCropOptions', () => {
  it('offers only the crops of the library rotations', () => {
    const library = definition({
      id: '12',
      isStandard: true,
      variants: [
        {
          id: 'a',
          positions: [
            { cropCode: SPRING_BARLEY, allowedUndersownCropCodes: [] },
          ],
        },
      ],
    })
    expect(
      libraryCropOptions(
        [
          { code: SPRING_BARLEY, name: 'Vårbyg' },
          { code: SPRING_OATS, name: 'Vårhavre' },
        ],
        [library],
      ),
    ).toEqual([{ code: SPRING_BARLEY, name: 'Vårbyg' }])
  })
})

describe('libraryUndersownDefaults', () => {
  const library = (
    farmingSystem: RotationDefinition['farmingSystem'],
    codes: number[][],
  ) =>
    definition({
      id: `${farmingSystem}-${codes.join()}`,
      isStandard: true,
      farmingSystem,
      variants: codes.map((allowedUndersownCropCodes, index) => ({
        id: String(index),
        positions: [{ cropCode: SPRING_BARLEY, allowedUndersownCropCodes }],
      })),
    })

  it('takes the virkemiddel the library uses most for a crop in its driftsform', () => {
    const defaults = libraryUndersownDefaults([
      library('Konventionel', [[CATCH_CROP], [CATCH_CROP], [CATCH_CROP], []]),
      library('Økologisk', [[EARLY_SOWING], []]),
    ])
    expect(defaultUndersownCrop(defaults, SPRING_BARLEY, 'Konventionel')).toBe(
      CATCH_CROP,
    )
    expect(defaultUndersownCrop(defaults, SPRING_BARLEY, null)).toBe(CATCH_CROP)
    expect(defaultUndersownCrop(defaults, SPRING_OATS, 'Konventionel')).toBe(
      null,
    )
  })

  it('gives no virkemiddel when none is used as often as the most used', () => {
    const defaults = libraryUndersownDefaults([
      library('Økologisk', [[EARLY_SOWING], []]),
    ])
    expect(defaultUndersownCrop(defaults, SPRING_BARLEY, 'Økologisk')).toBe(
      null,
    )
  })
})

describe('editing a draft', () => {
  it('gives a new crop its standard virkemiddel and drops one that does not fit', () => {
    const draft = draftFromDefinition(definition())
    const changed = setYearCrop(draft, 0, 0, SPRING_OATS, EARLY_SOWING)
    expect(changed.variants[0].years[0].undersownCropCodes).toEqual([
      EARLY_SOWING,
    ])
    expect(
      setYearCrop(draft, 0, 0, SPRING_OATS).variants[0].years[0]
        .undersownCropCodes,
    ).toEqual([])
    const checked = keepAllowedUndersownCrops(
      changed,
      0,
      0,
      new Set([CATCH_CROP]),
    )
    expect(checked.variants[0].years[0].undersownCropCodes).toEqual([])
  })

  it('rechecks the virkemidler of a year whose crop or next crop changes', () => {
    const saved = draftFromDefinition(definition())
    expect(
      yearsToRecheck(saved, setYearCrop(saved, 0, 1, SPRING_OATS)),
    ).toEqual([{ variantIndex: 0, yearIndex: 0 }])
    expect(
      yearsToRecheck(saved, setYearUndersownCrop(saved, 0, 0, EARLY_SOWING)),
    ).toEqual([])
    expect(
      yearsToRecheck(saved, { ...saved, farmingSystem: 'Økologisk' }),
    ).toEqual([{ variantIndex: 0, yearIndex: 0 }])
  })

  it('moves a year and puts a new one in after another', () => {
    const draft = draftFromDefinition(definition())
    const moved = moveYear(draft, 0, 1, 0)
    expect(moved.variants[0].years.map((year) => year.cropCode)).toEqual([
      SPRING_BARLEY,
      WINTER_WHEAT,
    ])
    const inserted = insertYearAfter(draft, 0, 0)
    expect(inserted.variants[0].years.map((year) => year.cropCode)).toEqual([
      WINTER_WHEAT,
      null,
      SPRING_BARLEY,
    ])
  })

  it('keeps between one and eight years', () => {
    const oneYear = newOwnRotationDraft()
    expect(removeYear(oneYear, 0, 0).variants[0].years).toHaveLength(1)
    let full = oneYear
    for (let year = 0; year < MAX_ROTATION_YEARS + 2; year += 1) {
      full = addYear(full, 0)
    }
    expect(full.variants[0].years).toHaveLength(MAX_ROTATION_YEARS)
  })

  it('is changed only when a year gets another virkemiddel', () => {
    const stored = definition()
    const draft = draftFromDefinition(stored)
    expect(isDraftChanged(draft, stored)).toBe(false)
    expect(
      isDraftChanged(setYearUndersownCrop(draft, 0, 0, CATCH_CROP), stored),
    ).toBe(false)
    expect(
      isDraftChanged(setYearUndersownCrop(draft, 0, 0, null), stored),
    ).toBe(true)
  })
})

describe('changes that are not saved', () => {
  const saved = draftFromDefinition(definition())

  it('marks a year as changed when it moves or gets other virkemidler', () => {
    const edited = setYearUndersownCrop(saved, 0, 1, CATCH_CROP)
    expect(
      edited.variants[0].years.map((_, index) =>
        yearStatus(saved, edited.variants[0], index),
      ),
    ).toEqual(['saved', 'changed'])
    const moved = moveYear(saved, 0, 0, 1)
    expect(
      moved.variants[0].years.map((_, index) =>
        yearStatus(saved, moved.variants[0], index),
      ),
    ).toEqual(['changed', 'changed'])
    expect(draftChangeCount(moved, saved)).toBe(2)
  })

  it('marks an inserted year as new and counts a removed year', () => {
    const inserted = insertYearAfter(saved, 0, 1)
    expect(yearStatus(saved, inserted.variants[0], 2)).toBe('new')
    expect(draftChangeCount(inserted, saved)).toBe(1)
    const removed = removeYear(saved, 0, 1)
    expect(draftChangeCount(removed, saved)).toBe(1)
    expect(draftChangeCount({ ...saved, name: 'Nyt navn' }, saved)).toBe(1)
  })

  it('lists what is missing before a new rotation can be created', () => {
    const named = { ...newOwnRotationDraft(), name: 'Korn' }
    expect(creationChecklist(addYear(named, 0))).toEqual([
      { label: 'Navn', done: true },
      { label: 'Driftsform', done: false },
      { label: 'Afgrøde i hvert år', done: false },
    ])
    expect(creationChecklist(named)[2].label).toBe('Afgrøde i hvert år')
    expect(creationChecklist(named, true)[0]).toEqual({
      label: 'Navn',
      done: false,
    })
    const firstYearChosen = setYearCrop(addYear(named, 0), 0, 0, WINTER_WHEAT)
    expect(creationChecklist(firstYearChosen)[2].label).toBe('Afgrøde i 2. år')
  })
})

describe('definitionInputFromDraft', () => {
  it('keeps the variant ids so the candidates keep their identity', () => {
    expect(definitionInputFromDraft(draftFromDefinition(definition()))).toEqual(
      {
        name: 'Korn med efterafgrøder',
        farmingSystem: 'Konventionel',
        variants: [
          {
            id: 'variant-1',
            positions: [
              {
                cropCode: WINTER_WHEAT,
                allowedUndersownCropCodes: [CATCH_CROP],
              },
              { cropCode: SPRING_BARLEY, allowedUndersownCropCodes: [] },
            ],
          },
        ],
      },
    )
  })

  it('sends a new variant without an id', () => {
    const draft = setYearCrop(
      { ...newOwnRotationDraft(), name: ' Nyt ', farmingSystem: 'Økologisk' },
      0,
      0,
      SPRING_OATS,
    )
    expect(definitionInputFromDraft(draft)).toEqual({
      name: 'Nyt',
      farmingSystem: 'Økologisk',
      variants: [
        {
          positions: [{ cropCode: SPRING_OATS, allowedUndersownCropCodes: [] }],
        },
      ],
    })
  })
})

describe('ownRotationProblem', () => {
  it('explains when the own rotations give too many combinations', () => {
    expect(
      ownRotationProblem(422, {
        code: 'TOO_MANY_CUSTOM_CANDIDATES',
        message: 'At most 4096 custom candidates are allowed',
      }),
    ).toBe(
      'Dine egne sædskifter giver for mange kombinationer, højst 4.096 med de valgte N-normniveauer. Vælg færre egne sædskifter eller N-normniveauer, eller fjern nogle virkemidler.',
    )
    expect(
      ownRotationProblem(422, {
        code: 'INVALID_ROTATION',
        message: 'Invalid hovedafgrøde',
      }),
    ).toBe('Et eget sædskifte kan ikke bruges, som det er nu.')
    expect(
      ownRotationProblem(422, 'Standard rotations are read-only'),
    ).toBeNull()
  })

  it('explains a selected rotation that is gone or not shared', () => {
    expect(
      ownRotationProblem(404, {
        code: 'ROTATION_NOT_FOUND',
        message: 'Rotation group not found',
      }),
    ).toBe(
      'Et af de valgte egne sædskifter findes ikke længere, eller det er ikke delt med dig. Vælg sædskifterne igen.',
    )
    expect(ownRotationProblem(404, 'Farm not found')).toBeNull()
  })

  it('falls back to the error message or a fixed text', () => {
    const deleted = new ApiError(422, 'A selected rotation no longer exists', {
      code: 'ROTATION_DELETED',
      message: 'A selected rotation no longer exists',
    })
    expect(rotationErrorMessage(deleted, 'Prøv igen.')).toBe(
      'Et af de valgte egne sædskifter findes ikke længere. Vælg sædskifterne igen.',
    )
    expect(rotationErrorMessage(new Error('Netværksfejl'), 'Prøv igen.')).toBe(
      'Netværksfejl',
    )
    expect(rotationErrorMessage('ukendt', 'Prøv igen.')).toBe('Prøv igen.')
  })

  it('tells a saved simulation why it cannot be optimized again', () => {
    expect(
      describeRotationOptionsError({
        code: 'ROTATION_DELETED',
        message: 'A selected rotation no longer exists',
      }),
    ).toBe(
      'Et eget sædskifte i simuleringen er rettet, siden den blev regnet. Et af de valgte egne sædskifter findes ikke længere. Vælg sædskifterne igen. Tallene er fra sidste kørsel.',
    )
  })
})

describe('editing a field with an own rotation', () => {
  const variant = definition().variants[0]

  it('starts a field on the variant with its virkemidler', () => {
    expect(ownVariantToken(variant)).toBe('variant-1~951-0')
    expect(ownVariantOf(definition(), 'variant-1~951-0')).toEqual(variant)
  })

  it('offers the virkemiddel of the year the field is in, also when shifted', () => {
    expect(allowedUndersownAt(variant, 1, 0)).toEqual([CATCH_CROP])
    expect(allowedUndersownAt(variant, 2, 0)).toEqual([])
    expect(allowedUndersownAt(variant, 0, 0)).toEqual([])
  })
})
