export const createRequestQueue = (limit: number) => {
  let running = 0
  const waiting: (() => void)[] = []
  return async <T>(request: () => Promise<T>): Promise<T> => {
    if (running < limit) {
      running += 1
    } else {
      await new Promise<void>((resolve) => {
        waiting.push(resolve)
      })
    }
    try {
      return await request()
    } finally {
      const next = waiting.shift()
      if (next) {
        next()
      } else {
        running -= 1
      }
    }
  }
}
