export type RequestProgress = {
  done: number
  total: number
}

export const createRequestProgress = () => {
  const running = new Map<string, RequestProgress>()
  const listeners = new Set<() => void>()
  const notify = () => {
    for (const listener of listeners) listener()
  }
  return {
    start: (key: string, total: number, done = 0) => {
      running.set(key, { done, total })
      notify()
    },
    advance: (key: string) => {
      const current = running.get(key)
      if (!current) return
      running.set(key, { ...current, done: current.done + 1 })
      notify()
    },
    finish: (key: string) => {
      running.delete(key)
    },
    get: (key: string): RequestProgress | undefined => running.get(key),
    subscribe: (listener: () => void) => {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
  }
}

export const combineProgress = (
  progresses: RequestProgress[],
): RequestProgress =>
  progresses.reduce(
    (sum, progress) => ({
      done: sum.done + progress.done,
      total: sum.total + progress.total,
    }),
    { done: 0, total: 0 },
  )
