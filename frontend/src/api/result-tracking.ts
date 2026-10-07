import type { OptimizationRun } from '@/api/optimization-runs'
import type { SimulationResult } from '@/api/types'

// A new submission or edit invalidates requests already in flight.
export class ResultRequests {
  private sequence = 0
  private latest = new Map<string, number>()
  private pending = new Map<string, number>()

  invalidate(simulationId: string) {
    this.latest.set(simulationId, ++this.sequence)
    this.pending.delete(simulationId)
  }

  version(simulationId: string) {
    return this.latest.get(simulationId)
  }

  begin(simulationId: string, force = false) {
    if (!force && this.pending.has(simulationId)) return undefined
    const ticket = ++this.sequence
    this.latest.set(simulationId, ticket)
    this.pending.set(simulationId, ticket)
    return ticket
  }

  current(simulationId: string, ticket: number) {
    return this.latest.get(simulationId) === ticket
  }

  finish(simulationId: string, ticket: number) {
    if (this.pending.get(simulationId) === ticket)
      this.pending.delete(simulationId)
  }
}

export const shouldAcceptResult = (
  current: OptimizationRun | undefined,
  result: SimulationResult,
  expectedId?: string,
) => {
  if (expectedId && (current?.id !== expectedId || result.runId !== expectedId))
    return false
  if (current?.id !== result.runId) return true
  // Terminal states cannot return to an active state for the same run token.
  if (current.status === 'outdated') return result.status === 'outdated'
  if (current.status === 'succeeded')
    return result.status === 'completed' || result.status === 'outdated'
  if (current.status === 'failed')
    return result.status === 'failed' || result.status === 'outdated'
  return true
}

export const canPollResults = (hidden: boolean, online: boolean) =>
  !hidden && online

type PollEnvironment = {
  window: Pick<
    Window,
    'setInterval' | 'clearInterval' | 'addEventListener' | 'removeEventListener'
  >
  document: Pick<
    Document,
    'hidden' | 'addEventListener' | 'removeEventListener'
  >
  navigator: Pick<Navigator, 'onLine'>
}

export const watchResultPolling = (
  poll: (all: boolean) => void,
  environment: PollEnvironment,
) => {
  const { window: view, document: page, navigator: connection } = environment
  const run = (all: boolean) => {
    if (canPollResults(page.hidden, connection.onLine)) poll(all)
  }
  const focus = () => run(true)
  const timer = view.setInterval(() => run(false), 5000)
  view.addEventListener('focus', focus)
  view.addEventListener('online', focus)
  page.addEventListener('visibilitychange', focus)
  return () => {
    view.clearInterval(timer)
    view.removeEventListener('focus', focus)
    view.removeEventListener('online', focus)
    page.removeEventListener('visibilitychange', focus)
  }
}
