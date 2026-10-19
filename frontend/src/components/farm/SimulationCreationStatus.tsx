import { useState } from 'react'
import { mutate } from 'swr'

import { retrySimulationEconomics } from '@/api/economics'
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
  const recalculationFailed = simulation.economicsRecalculationFailed === true
  const retry = async () => {
    setRetrying(true)
    setError(null)
    try {
      const accepted = recalculationFailed
        ? await retrySimulationEconomics(farmId, simulation.id)
        : await retrySimulationCreation(farmId, simulation.id)
      await mutate(
        simulationsKey(farmId),
        (current: Simulation[] = []) =>
          current.map((item) => (item.id === accepted.id ? accepted : item)),
        { revalidate: false },
      )
    } catch {
      setError(
        recalculationFailed
          ? 'Kunne ikke genberegne økonomien. Prøv igen.'
          : 'Kunne ikke starte oprettelsen igen. Prøv igen.',
      )
    } finally {
      void mutate(simulationsKey(farmId))
      setRetrying(false)
    }
  }
  return (
    <div className="space-y-3 rounded-lg border border-dashed p-4">
      {simulation.creationStatus === 'failed' ? (
        <>
          <p role="alert" className="text-sm text-destructive">
            {error ??
              (recalculationFailed
                ? 'Kunne ikke genberegne økonomien.'
                : 'Kunne ikke oprette simuleringen.')}
          </p>

          <Button size="sm" loading={retrying} onClick={() => void retry()}>
            {recalculationFailed ? 'Genberegn igen' : 'Åbn indstillinger'}
          </Button>
        </>
      ) : (
        <>
          <p role="status" className="flex items-center gap-2 font-medium">
            {isSimulationCreating(simulation) ? <Spinner /> : null}
            {creationStatusLabel(simulation)}
          </p>
          <p className="text-sm text-muted-foreground">
            Du kan lukke siden. Oprettelsen fortsætter, og simuleringen bliver
            klar, når beregningerne er færdige.
          </p>
        </>
      )}
    </div>
  )
}
