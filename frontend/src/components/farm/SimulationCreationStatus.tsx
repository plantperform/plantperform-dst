import { useState } from 'react'
import { mutate } from 'swr'

import { simulationsKey } from '@/api/hooks'
import { retrySimulationCreation } from '@/api/mutations'
import type { Simulation } from '@/api/types'
import { Button } from '@/components/ui/button'
import { Spinner } from '@/components/ui/spinner'
import {
  creationStatusLabel,
  isSimulationCreating,
} from '@/lib/simulation-creation'

export const SimulationCreationStatus = ({
  farmId,
  simulation,
}: {
  farmId: string
  simulation: Simulation
}) => {
  const [retrying, setRetrying] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [optimizeOnCreate, setOptimizeOnCreate] = useState(false)
  const retry = async () => {
    setRetrying(true)
    setError(null)
    try {
      const accepted = await retrySimulationCreation(farmId, simulation.id, optimizeOnCreate)
      await mutate(
        simulationsKey(farmId),
        (current: Simulation[] = []) =>
          current.map((item) => (item.id === accepted.id ? accepted : item)),
        { revalidate: false },
      )
    } catch {
      setError('Kunne ikke starte oprettelsen igen. Prøv igen.')
    } finally {
      void mutate(simulationsKey(farmId))
      setRetrying(false)
    }
  }
  return (
    <div className="space-y-3 rounded-lg border border-dashed p-4">
      <p role="status" className="flex items-center gap-2 font-medium">
        {isSimulationCreating(simulation) ? <Spinner /> : null}
        {creationStatusLabel(simulation)}
      </p>
      {simulation.creationStatus === 'failed' ? (
        <>
          <p role="alert" className="text-sm text-destructive">
            {error ?? 'Kunne ikke oprette simuleringen.'}
          </p>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={optimizeOnCreate}
              disabled={retrying}
              onChange={(event) => setOptimizeOnCreate(event.target.checked)}
            />
            Optimér, når simuleringen er klar
          </label>
          <Button size="sm" loading={retrying} onClick={() => void retry()}>
            Prøv igen
          </Button>
        </>
      ) : (
        <p className="text-sm text-muted-foreground">
          Du kan lukke siden. Oprettelsen fortsætter, og simuleringen bliver
          klar, når beregningerne er færdige.
        </p>
      )}
    </div>
  )
}
