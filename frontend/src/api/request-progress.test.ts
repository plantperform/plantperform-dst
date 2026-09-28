import { describe, expect, it } from 'vitest'

import { combineProgress, createRequestProgress } from '@/api/request-progress'

describe('createRequestProgress', () => {
  it('counts the finished requests of a running key', () => {
    const progress = createRequestProgress()
    progress.start('a', 3, 1)
    expect(progress.get('a')).toEqual({ done: 1, total: 3 })
    progress.advance('a')
    expect(progress.get('a')).toEqual({ done: 2, total: 3 })
    expect(progress.get('b')).toBeUndefined()
  })

  it('tells subscribers about each step until they unsubscribe', () => {
    const progress = createRequestProgress()
    let calls = 0
    const unsubscribe = progress.subscribe(() => {
      calls += 1
    })
    progress.start('a', 2)
    progress.advance('a')
    expect(calls).toBe(2)
    unsubscribe()
    progress.advance('a')
    expect(calls).toBe(2)
  })

  it('keeps the same snapshot for a key until it changes', () => {
    const progress = createRequestProgress()
    progress.start('a', 2)
    progress.start('b', 2)
    const before = progress.get('a')
    progress.advance('b')
    expect(progress.get('a')).toBe(before)
  })

  it('drops a finished key without telling subscribers', () => {
    const progress = createRequestProgress()
    progress.start('a', 1)
    progress.advance('a')
    let calls = 0
    progress.subscribe(() => {
      calls += 1
    })
    progress.finish('a')
    expect(progress.get('a')).toBeUndefined()
    expect(calls).toBe(0)
  })

  it('ignores steps for a key that is not running', () => {
    const progress = createRequestProgress()
    let calls = 0
    progress.subscribe(() => {
      calls += 1
    })
    progress.advance('a')
    expect(progress.get('a')).toBeUndefined()
    expect(calls).toBe(0)
  })
})

describe('combineProgress', () => {
  it('adds up the progress of several columns', () => {
    expect(
      combineProgress([
        { done: 25, total: 25 },
        { done: 12, total: 25 },
        { done: 0, total: 20 },
      ]),
    ).toEqual({ done: 37, total: 70 })
  })

  it('is empty without columns', () => {
    expect(combineProgress([])).toEqual({ done: 0, total: 0 })
  })
})
