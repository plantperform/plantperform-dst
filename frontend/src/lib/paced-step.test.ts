import { describe, expect, it } from 'vitest'

import {
  advancePacedStep,
  restPacedStep,
  startPacedStep,
} from '@/lib/paced-step'

describe('advancePacedStep', () => {
  it('holds a step that has not rested, even when the work is done', () => {
    const start = startPacedStep('a')

    expect(advancePacedStep(start, 'a', 3)).toBe(start)
  })

  it('moves one step at a time once the step has rested', () => {
    const rested = restPacedStep(startPacedStep('a'))

    expect(advancePacedStep(rested, 'a', 3)).toEqual({
      key: 'a',
      step: 1,
      rested: false,
    })
  })

  it('waits on a rested step until the work reaches the next one', () => {
    const rested = restPacedStep(startPacedStep('a'))

    expect(advancePacedStep(rested, 'a', 0)).toBe(rested)
    expect(advancePacedStep(rested, 'a', 1).step).toBe(1)
  })

  it('starts over when the key changes', () => {
    const shown = { key: 'a', step: 3, rested: true }

    expect(advancePacedStep(shown, 'b', 3)).toEqual(startPacedStep('b'))
  })
})
