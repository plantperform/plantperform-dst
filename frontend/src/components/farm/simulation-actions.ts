import { useState } from 'react'
import { mutate } from 'swr'

import {
  fetchSimulationFields,
  simulationFieldsKey,
  simulationsKey,
} from '@/api/hooks'
import {
  createSimulation,
  deleteSimulation,
  updateSimulationConstraints,
} from '@/api/mutations'
import { useStartDefaultOptimization } from '@/api/optimization-runs'
import type { CreateSimulationInput, Simulation } from '@/api/types'
import type { FarmViewSelection } from '@/components/farm/types'

const buildCopyInput = (simulation: Simulation): CreateSimulationInput => ({
  name: `${simulation.name} (kopi)`,
  allowedRotationVariants: simulation.rotationVariants,
  allowedNNormPercentages: simulation.nNormPercentages,
  fertiliser: simulation.fertiliser,
  catchCropSowingDate: simulation.catchCropSowingDate,
  catchCropDailyBasis: simulation.catchCropDailyBasis,
})

type SimulationActionsOptions = {
  farmId: string | undefined
  selection: FarmViewSelection
  onSelectionChange: (selection: FarmViewSelection) => void
  onError: (message: string | null) => void
}

export const useSimulationActions = ({
  farmId,
  selection,
  onSelectionChange,
  onError,
}: SimulationActionsOptions) => {
  const [deletingSimulationId, setDeletingSimulationId] = useState<
    string | null
  >(null)
  const [copyingSimulationId, setCopyingSimulationId] = useState<string | null>(
    null,
  )
  const startDefaultRun = useStartDefaultOptimization()

  const removeSimulation = async (simulationId: string) => {
    if (!farmId) return
    setDeletingSimulationId(simulationId)
    try {
      await deleteSimulation(farmId, simulationId)
      await mutate(simulationsKey(farmId))
      await mutate(simulationFieldsKey(farmId, simulationId), undefined, {
        revalidate: false,
      })
      if (selection.kind === 'simulation' && selection.id === simulationId) {
        onSelectionChange({ kind: 'current' })
      }
      onError(null)
    } catch {
      onError('Kunne ikke slette simuleringen.')
    } finally {
      setDeletingSimulationId(null)
    }
  }

  const copySimulation = async (simulation: Simulation) => {
    if (!farmId) return
    setCopyingSimulationId(simulation.id)
    let created: Simulation
    try {
      created = await createSimulation(farmId, buildCopyInput(simulation))
      await mutate(simulationsKey(farmId))
    } catch {
      onError('Kunne ikke kopiere simuleringen.')
      setCopyingSimulationId(null)
      return
    }
    let copyError: string | null = null
    try {
      await updateSimulationConstraints(
        farmId,
        created.id,
        simulation.constraints,
      )
      await mutate(simulationsKey(farmId))
    } catch {
      copyError =
        'Simuleringen blev kopieret, men reglerne kunne ikke kopieres.'
    }
    if (!copyError) {
      try {
        startDefaultRun(
          farmId,
          created.id,
          await fetchSimulationFields(farmId, created.id),
        )
      } catch {
        copyError =
          'Simuleringen blev kopieret, men Optimér kunne ikke startes.'
      }
    }
    onError(copyError)
    onSelectionChange({ kind: 'simulation', id: created.id })
    setCopyingSimulationId(null)
  }

  return {
    copyingSimulationId,
    deletingSimulationId,
    copySimulation,
    removeSimulation,
  }
}
