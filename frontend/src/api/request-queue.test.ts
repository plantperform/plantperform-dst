import { describe, expect, it } from 'vitest'

import { createRequestQueue } from '@/api/request-queue'

const deferred = <T>() => {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((onResolve) => {
    resolve = onResolve
  })
  return { promise, resolve }
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0))

describe('createRequestQueue', () => {
  it('runs no more requests at a time than the limit and starts the rest in order', async () => {
    const queue = createRequestQueue(2)
    const requests = [
      deferred<string>(),
      deferred<string>(),
      deferred<string>(),
      deferred<string>(),
    ]
    const started: number[] = []
    const results = requests.map((request, index) =>
      queue(() => {
        started.push(index)
        return request.promise
      }),
    )

    await settle()
    expect(started).toEqual([0, 1])

    requests[1].resolve('b')
    await settle()
    expect(started).toEqual([0, 1, 2])

    requests[0].resolve('a')
    requests[2].resolve('c')
    await settle()
    expect(started).toEqual([0, 1, 2, 3])

    requests[3].resolve('d')
    expect(await Promise.all(results)).toEqual(['a', 'b', 'c', 'd'])
  })

  it('starts the next request when one fails', async () => {
    const queue = createRequestQueue(1)
    const failing = queue(() => Promise.reject(new Error('offline')))
    const next = queue(() => Promise.resolve('ok'))

    await expect(failing).rejects.toThrow('offline')
    expect(await next).toBe('ok')
  })
})
