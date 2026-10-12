import type { Simulation } from '@/api/types'

type CreationState = Pick<Simulation, 'creationStatus'>

export function isSimulationReady(simulation: CreationState) {
  return !simulation.creationStatus || simulation.creationStatus === 'done'
}

export function isSimulationCreating(simulation: CreationState) {
  return simulation.creationStatus === 'queued' || simulation.creationStatus === 'running'
}

export function creationStatusLabel(simulation: CreationState): string | null {
  if (simulation.creationStatus === 'failed') return 'Oprettelsen fejlede'
  if (!isSimulationCreating(simulation)) return null
  return 'Opretter simulering…'
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
