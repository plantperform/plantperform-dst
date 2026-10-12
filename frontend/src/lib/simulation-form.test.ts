import { describe, expect, it } from 'vitest'

import type {
  FarmingSystem,
  FertiliserPresetOption,
  RotationCategoryOption,
  Simulation,
} from '@/api/types'
import {
  catchCropSowingLabel,
  combinationCount,
  copiedNNormPercentages,
  CUSTOM_FERTILISER,
  DEFAULT_SIMULATION_FORM_VALUES,
  farmingSystemMismatchCount,
  farmingSystemMismatchMessage,
  isNNormOptionLocked,
  isStepValid,
  nNormPercentagesFor,
  NO_FERTILISER,
  nNormPercentagesLabel,
  selectedCountsByCategory,
  selectedInCategory,
  selectedRotations,
  simulationFormSchema,
  SIMULATION_FORM_STEPS,
  simulationToFormValues,
  toCreateSimulationInput,
  toggleNNormPercentage,
  type SimulationFormValues,
} from '@/lib/simulation-form'

// Brak ("1") is deliberately part of every category, the way the backend
// serves it, so the counting rules can be checked against it.
const BRAK = { rotationVariant: '1', cropSequence: ['Brak'], activeLen: 1 }

const CATEGORIES: RotationCategoryOption[] = [
  {
    category: 'Kvæg',
    croppingSystem: 'Konventionel',
    rotationCount: 3,
    rotations: [
      BRAK,
      {
        rotationVariant: '10',
        cropSequence: ['Vårbyg', 'Kløvergræs'],
        activeLen: 2,
      },
      {
        rotationVariant: '11',
        cropSequence: ['Majs', 'Majs'],
        activeLen: 2,
      },
    ],
  },
  {
    category: 'Plante',
    croppingSystem: 'Konventionel',
    rotationCount: 2,
    rotations: [
      BRAK,
      {
        rotationVariant: '20',
        cropSequence: ['Vinterhvede', 'Vinterraps'],
        activeLen: 2,
      },
    ],
  },
  {
    category: 'Økologisk kvæg',
    croppingSystem: 'Økologisk',
    rotationCount: 2,
    rotations: [
      BRAK,
      {
        rotationVariant: '30',
        cropSequence: ['Kløvergræs', 'Havre'],
        activeLen: 2,
      },
    ],
  },
]

// A form the user has filled in completely, used as the base for the cases
// that only change one field at a time.
const filledValues: SimulationFormValues = {
  ...DEFAULT_SIMULATION_FORM_VALUES,
  name: 'Sædskifte 2026',
  rotationVariants: ['10', '20'],
  nNormPercentages: ['100'],
}

const stepIndex = (id: (typeof SIMULATION_FORM_STEPS)[number]['id']): number =>
  SIMULATION_FORM_STEPS.findIndex((step) => step.id === id)

// The message for one field, or undefined when the field has no issue.
const messageFor = (
  values: SimulationFormValues,
  field: keyof SimulationFormValues,
): string | undefined => {
  const result = simulationFormSchema.safeParse(values)
  if (result.success) return undefined
  return result.error.issues.find((issue) => issue.path[0] === field)?.message
}

describe('step schemas', () => {
  it('accepts a completely filled form', () => {
    expect(simulationFormSchema.safeParse(filledValues).success).toBe(true)
    for (let index = 0; index < SIMULATION_FORM_STEPS.length; index += 1) {
      expect(isStepValid(index, filledValues)).toBe(true)
    }
  })

  it('accepts the default dyrkningspraksis values', () => {
    expect(
      isStepValid(stepIndex('practice'), DEFAULT_SIMULATION_FORM_VALUES),
    ).toBe(true)
  })

  it('requires a name', () => {
    expect(messageFor({ ...filledValues, name: '   ' }, 'name')).toBe(
      'Giv simuleringen et navn',
    )
    expect(isStepValid(stepIndex('basics'), { ...filledValues, name: '' })).toBe(
      false,
    )
  })

  it('requires at least one rotation', () => {
    expect(
      messageFor({ ...filledValues, rotationVariants: [] }, 'rotationVariants'),
    ).toBe('Vælg mindst ét sædskifte')
  })

  it('requires 100 % and at most two lower N-norm levels', () => {
    expect(
      messageFor({ ...filledValues, nNormPercentages: ['80'] }, 'nNormPercentages'),
    ).toBe('100 % skal altid være med')
    expect(
      messageFor(
        { ...filledValues, nNormPercentages: ['100', '90', '80', '70'] },
        'nNormPercentages',
      ),
    ).toBe('Vælg højst to niveauer under 100 %')
    expect(
      messageFor(
        { ...filledValues, nNormPercentages: ['100', '90', '80'] },
        'nNormPercentages',
      ),
    ).toBeUndefined()
  })

  it('starts with 100 % selected', () => {
    expect(DEFAULT_SIMULATION_FORM_VALUES.nNormPercentages).toEqual(['100'])
  })

  it('keeps the steps independent of each other', () => {
    const withoutName = { ...filledValues, name: '' }
    expect(isStepValid(stepIndex('basics'), withoutName)).toBe(false)
    expect(isStepValid(stepIndex('rotations'), withoutName)).toBe(true)
  })
})

describe('fertiliser validation', () => {
  it('ignores the number fields when no fertiliser type is chosen', () => {
    const values: SimulationFormValues = {
      ...filledValues,
      fertiliserChoice: NO_FERTILISER,
      orgMineralN: '',
      mineralSharePct: '-5',
      nContentKgPerTon: 'ikke et tal',
    }
    expect(isStepValid(stepIndex('nitrogen'), values)).toBe(true)
  })

  it('validates the number fields once a fertiliser type is chosen', () => {
    const values: SimulationFormValues = {
      ...filledValues,
      fertiliserChoice: CUSTOM_FERTILISER,
      orgMineralN: '',
      mineralSharePct: '-5',
      nContentKgPerTon: 'ikke et tal',
    }
    expect(messageFor(values, 'orgMineralN')).toBe('Udfyld feltet')
    expect(messageFor(values, 'mineralSharePct')).toBe(
      'Mineralsk andel skal være større end 0 og højst 100 %',
    )
    expect(messageFor(values, 'nContentKgPerTon')).toBe('Angiv et tal')
  })

  it('rejects an empty field instead of falling back to the default', () => {
    const withFertiliser = {
      ...filledValues,
      fertiliserChoice: 'Kvæggylle',
    }
    for (const field of [
      'orgMineralN',
      'mineralSharePct',
      'nContentKgPerTon',
    ] as const) {
      expect(messageFor({ ...withFertiliser, [field]: '' }, field)).toBe(
        'Udfyld feltet',
      )
      expect(messageFor({ ...withFertiliser, [field]: '  ' }, field)).toBe(
        'Udfyld feltet',
      )
    }
  })

  it('accepts the values at the edges of the allowed ranges', () => {
    const values: SimulationFormValues = {
      ...filledValues,
      fertiliserChoice: 'Kvæggylle',
      orgMineralN: '0',
      mineralSharePct: '100',
      nContentKgPerTon: '0.1',
    }
    expect(isStepValid(stepIndex('nitrogen'), values)).toBe(true)
    expect(
      messageFor({ ...values, mineralSharePct: '0' }, 'mineralSharePct'),
    ).toBe('Mineralsk andel skal være større end 0 og højst 100 %')
    expect(
      messageFor({ ...values, mineralSharePct: '101' }, 'mineralSharePct'),
    ).toBe('Mineralsk andel skal være større end 0 og højst 100 %')
    expect(messageFor({ ...values, orgMineralN: '-1' }, 'orgMineralN')).toBe(
      'Skal være 0 eller mere',
    )
    expect(
      messageFor({ ...values, nContentKgPerTon: '0' }, 'nContentKgPerTon'),
    ).toBe('Angiv et N-indhold større end 0')
  })
})

describe('farming system mismatch warning', () => {
  it('counts rotations that only exist under the other driftsform', () => {
    expect(
      farmingSystemMismatchCount(CATEGORIES, ['10', '30'], 'Konventionel'),
    ).toBe(1)
    expect(
      farmingSystemMismatchCount(CATEGORIES, ['10', '30'], 'Økologisk'),
    ).toBe(1)
  })

  it('never counts brak, which belongs to every category', () => {
    expect(farmingSystemMismatchCount(CATEGORIES, ['1'], 'Konventionel')).toBe(0)
    expect(farmingSystemMismatchCount(CATEGORIES, ['1'], 'Økologisk')).toBe(0)
  })

  it('says nothing when every rotation matches', () => {
    expect(
      farmingSystemMismatchCount(CATEGORIES, ['10', '20'], 'Konventionel'),
    ).toBe(0)
  })

  it('names the other driftsform in the warning', () => {
    expect(farmingSystemMismatchMessage(2, 'Konventionel')).toBe(
      'Du har valgt 2 økologiske sædskifter til en konventionel simulering.',
    )
    expect(farmingSystemMismatchMessage(1, 'Økologisk')).toBe(
      'Du har valgt 1 konventionelle sædskifter til en økologisk simulering.',
    )
  })
})

describe('counting selected rotations', () => {
  it('counts a rotation once per category it appears in', () => {
    expect(selectedInCategory(CATEGORIES[0], ['1', '10'])).toBe(2)
    expect(selectedInCategory(CATEGORIES[1], ['1', '10'])).toBe(1)
  })

  it('reports brak under every category that offers it', () => {
    expect(selectedCountsByCategory(CATEGORIES, ['1'])).toEqual([
      { category: 'Kvæg', count: 1 },
      { category: 'Plante', count: 1 },
      { category: 'Økologisk kvæg', count: 1 },
    ])
  })

  it('leaves out categories with nothing selected', () => {
    expect(selectedCountsByCategory(CATEGORIES, ['20'])).toEqual([
      { category: 'Plante', count: 1 },
    ])
  })

  it('lists each selected rotation once, in selection order', () => {
    expect(
      selectedRotations(CATEGORIES, ['20', '1', '10']).map(
        (rotation) => rotation.rotationVariant,
      ),
    ).toEqual(['20', '1', '10'])
  })

  it('ignores a selected variant that no category offers', () => {
    expect(selectedRotations(CATEGORIES, ['10', '999'])).toHaveLength(1)
  })
})

describe('candidate count', () => {
  it('multiplies rotations, N-norm levels and fields', () => {
    expect(
      combinationCount(
        { rotationVariants: ['10', '20', '1'], nNormPercentages: ['80', '100'] },
        12,
      ),
    ).toBe(72)
  })

  it('is zero while one of the three is empty', () => {
    expect(
      combinationCount(
        { rotationVariants: [], nNormPercentages: ['100'] },
        12,
      ),
    ).toBe(0)
    expect(
      combinationCount({ rotationVariants: ['10'], nNormPercentages: [] }, 12),
    ).toBe(0)
    expect(
      combinationCount(
        { rotationVariants: ['10'], nNormPercentages: ['100'] },
        0,
      ),
    ).toBe(0)
  })
})

describe('N-norm levels', () => {
  it('never lets 100 % be removed', () => {
    expect(toggleNNormPercentage(['100', '80'], '100', 'Konventionel')).toEqual([
      '100',
      '80',
    ])
    expect(isNNormOptionLocked(['100'], '100', 'Konventionel')).toBe(true)
  })

  it('allows at most two levels below 100 %', () => {
    const two = toggleNNormPercentage(
      toggleNNormPercentage(['100'], '90', 'Konventionel'),
      '70',
      'Konventionel',
    )
    expect(two).toEqual(['100', '90', '70'])
    expect(toggleNNormPercentage(two, '50', 'Konventionel')).toEqual(two)
    expect(isNNormOptionLocked(two, '50', 'Konventionel')).toBe(true)
    expect(isNNormOptionLocked(two, '90', 'Konventionel')).toBe(false)
    expect(toggleNNormPercentage(two, '90', 'Konventionel')).toEqual(['100', '70'])
  })

  it('locks an økologisk simulation to 100 %', () => {
    expect(isNNormOptionLocked(['100'], '80', 'Økologisk')).toBe(true)
    expect(toggleNNormPercentage(['100'], '80', 'Økologisk')).toEqual(['100'])
    expect(nNormPercentagesFor(['100', '80'], 'Økologisk')).toEqual(['100'])
  })

  it('keeps 100 % first when the driftsform changes', () => {
    expect(nNormPercentagesFor(['80'], 'Konventionel')).toEqual(['100', '80'])
  })

  it('gives a copy 100 % and the two highest levels still offered', () => {
    const offered = ['50', '60', '70', '80', '90', '100']
    expect(
      copiedNNormPercentages(['30', '60', '80', '90'], 'Konventionel', offered),
    ).toEqual(['100', '90', '80'])
    expect(
      copiedNNormPercentages(['100', '80'], 'Økologisk', offered),
    ).toEqual(['100'])
  })

  it('sends only 100 % for an økologisk simulation', () => {
    expect(
      toCreateSimulationInput({
        ...filledValues,
        farmingSystem: 'Økologisk',
        nNormPercentages: ['100', '80'],
      }).allowedNNormPercentages,
    ).toEqual(['100'])
  })
})

describe('summary labels', () => {
  it('lists the N-norm levels from low to high', () => {
    expect(nNormPercentagesLabel(['100', '85', '95'])).toBe('85 %, 95 %, 100 %')
  })

  it('names the sowing interval or the daily basis of the catch crop', () => {
    expect(catchCropSowingLabel('24/8', false)).toBe(
      '21.-24. august (42%) · trappesats §37',
    )
    expect(catchCropSowingLabel('22/8', true)).toBe('22/8 · dagsbasis §38')
  })
})

describe('toCreateSimulationInput', () => {
  it('sends the typed numbers and the trimmed name', () => {
    const values: SimulationFormValues = {
      ...filledValues,
      name: '  Sædskifte 2026  ',
      fertiliserChoice: 'Kvæggylle',
      orgMineralN: '42.5',
      mineralSharePct: '70',
      onlyOrganic: true,
      nContentKgPerTon: '5',
    }
    expect(toCreateSimulationInput(values)).toEqual({
      name: 'Sædskifte 2026',
      optimizeOnCreate: true,
      allowedRotationVariants: ['10', '20'],
      allowedNNormPercentages: ['100'],
      fertiliser: {
        farmingSystem: 'Konventionel',
        orgMineralN: 42.5,
        mineralSharePct: 70,
        onlyOrganic: true,
        nContentKgPerTon: 5,
      },
      catchCropSowingDate: '20/8',
      catchCropDailyBasis: false,
      precisionFarming: false,
      earlySowing: true,
      intermediateCrop: true,
    })
  })

  it('sends the neutral fertiliser numbers when no type is chosen', () => {
    const values: SimulationFormValues = {
      ...filledValues,
      fertiliserChoice: NO_FERTILISER,
      // Left over from a draft where a fertiliser type was chosen.
      orgMineralN: '42.5',
      mineralSharePct: '70',
      nContentKgPerTon: '5',
    }
    expect(toCreateSimulationInput(values).fertiliser).toEqual({
      farmingSystem: 'Konventionel',
      orgMineralN: 0,
      mineralSharePct: 100,
      onlyOrganic: false,
      nContentKgPerTon: 6,
    })
  })

  it('forces onlyOrganic for an økologisk simulering', () => {
    const farmingSystem: FarmingSystem = 'Økologisk'
    const values: SimulationFormValues = {
      ...filledValues,
      farmingSystem,
      fertiliserChoice: 'Kvæggylle',
      orgMineralN: '30',
      mineralSharePct: '50',
      onlyOrganic: false,
    }
    const { fertiliser } = toCreateSimulationInput(values)
    expect(fertiliser?.farmingSystem).toBe('Økologisk')
    expect(fertiliser?.onlyOrganic).toBe(true)
  })

  it('sends the chosen sowing date for the interval and the daily basis', () => {
    expect(
      toCreateSimulationInput({
        ...filledValues,
        catchCropDailyBasis: false,
        catchCropSowingInterval: '28/8',
        catchCropSowingDate: '3/9',
      }).catchCropSowingDate,
    ).toBe('28/8')
    expect(
      toCreateSimulationInput({
        ...filledValues,
        catchCropDailyBasis: true,
        catchCropSowingInterval: '28/8',
        catchCropSowingDate: '3/9',
      }).catchCropSowingDate,
    ).toBe('3/9')
  })
})

describe('simulationToFormValues', () => {
  const kvaeggylle: FertiliserPresetOption = {
    name: 'Kvæggylle',
    fertiliser: {
      farmingSystem: 'Konventionel',
      orgMineralN: 30,
      mineralSharePct: 50,
      onlyOrganic: false,
      nContentKgPerTon: 5,
    },
  }
  const simulation: Simulation = {
    id: 'sim-1',
    farmId: 'farm-1',
    name: 'Test2',
    createdAt: '2026-09-30T10:00:00Z',
    revision: 0,
    result: {} as Simulation['result'],
    constraints: {} as Simulation['constraints'],
    rotationVariants: ['10', '20'],
    nNormPercentages: ['95', '85'],
    fertiliser: kvaeggylle.fertiliser,
    catchCropSowingDate: '28/8',
    catchCropDailyBasis: false,
    precisionFarming: true,
    earlySowing: false,
    intermediateCrop: true,
  }
  const offered = ['50', '60', '70', '80', '85', '90', '95', '100']

  it('fills the form so the copy gets the same grundlag', () => {
    const values = simulationToFormValues(simulation, [kvaeggylle], offered)
    expect(values.fertiliserChoice).toBe('Kvæggylle')
    expect(toCreateSimulationInput(values)).toEqual({
      name: 'Test2 (kopi)',
      optimizeOnCreate: true,
      allowedRotationVariants: ['10', '20'],
      allowedNNormPercentages: ['100', '95', '85'],
      fertiliser: kvaeggylle.fertiliser,
      catchCropSowingDate: '28/8',
      catchCropDailyBasis: false,
      precisionFarming: true,
      earlySowing: false,
      intermediateCrop: true,
    })
  })

  it('brings older N-norm levels in line with a new simulation', () => {
    const values = simulationToFormValues(
      { ...simulation, nNormPercentages: ['30', '60', '80', '90'] },
      [kvaeggylle],
      offered,
    )
    expect(values.nNormPercentages).toEqual(['100', '90', '80'])
  })

  it('reads the fertiliser type from its numbers', () => {
    const withFertiliser = (orgMineralN: number, mineralSharePct: number) =>
      simulationToFormValues(
        {
          ...simulation,
          fertiliser: { ...simulation.fertiliser, orgMineralN, mineralSharePct },
        },
        [kvaeggylle],
        offered,
      ).fertiliserChoice
    expect(withFertiliser(0, 100)).toBe(NO_FERTILISER)
    expect(withFertiliser(30, 50)).toBe('Kvæggylle')
    expect(withFertiliser(31, 50)).toBe(CUSTOM_FERTILISER)
  })

  it('keeps a sowing date on the daily basis', () => {
    const values = simulationToFormValues(
      { ...simulation, catchCropDailyBasis: true, catchCropSowingDate: '3/9' },
      [kvaeggylle],
      offered,
    )
    expect(values.catchCropSowingDate).toBe('3/9')
    expect(toCreateSimulationInput(values).catchCropSowingDate).toBe('3/9')
  })
})

describe('optimize on create', () => {
  it('is on by default and is persisted in the creation payload', () => {
    expect(DEFAULT_SIMULATION_FORM_VALUES.optimizeOnCreate).toBe(true)
    expect(toCreateSimulationInput(filledValues).optimizeOnCreate).toBe(true)
    expect(toCreateSimulationInput({ ...filledValues, optimizeOnCreate: false }).optimizeOnCreate).toBe(false)
  })

  it('accepts both choices on the confirm step', () => {
    expect(
      isStepValid(stepIndex('confirm'), {
        ...filledValues,
        optimizeOnCreate: false,
      }),
    ).toBe(true)
  })
})
