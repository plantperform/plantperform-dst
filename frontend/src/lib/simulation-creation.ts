import { ApiError } from '@/api/client'
import type { Simulation } from '@/api/types'

type CreationState = Pick<
  Simulation,
  'creationStatus' | 'economicsRecalculationFailed'
>

export function isSimulationReady(simulation: CreationState) {
  return !simulation.creationStatus || simulation.creationStatus === 'done'
}

export function isSimulationCreating(simulation: CreationState) {
  return simulation.creationStatus === 'queued' || simulation.creationStatus === 'running'
}

export function creationStatusLabel(simulation: CreationState): string | null {
  if (simulation.creationStatus === 'failed') {
    return simulation.economicsRecalculationFailed
      ? 'Genberegningen fejlede'
      : 'Oprettelsen fejlede'
  }
  if (!isSimulationCreating(simulation)) return null
  return 'Opretter simulering...'
}

export type CreationRequestIdentity = { requestId: string; input: string }

export function creationRequestIdentity(
  input: unknown,
  previous: CreationRequestIdentity | null,
): CreationRequestIdentity {
  const serialized = JSON.stringify(input)
  return previous?.input === serialized
    ? previous
    : { requestId: crypto.randomUUID(), input: serialized }
}

// The wizard remembers the simulation it saved, so a later Gem updates that one
// instead of creating a second. If it was deleted meanwhile the update finds
// nothing; start over with a new simulation rather than failing every time.
export async function updateOrRecreate<T>({
  update,
  create,
  canRecreate,
  onRecreate,
}: {
  update: () => Promise<T>
  create: () => Promise<T>
  canRecreate: boolean
  onRecreate: () => void
}): Promise<T> {
  try {
    return await update()
  } catch (error) {
    if (!canRecreate || !(error instanceof ApiError) || error.status !== 404) {
      throw error
    }
    onRecreate()
    return create()
  }
}
