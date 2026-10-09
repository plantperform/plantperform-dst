import { useRef, useState } from 'react'
import { mutate } from 'swr'

import {
  simulationFieldsKey,
  simulationsKey,
  useRotationNNormPercentages,
} from '@/api/hooks'
import { createSimulation, deleteSimulation } from '@/api/mutations'
import type { CreateSimulationInput, Simulation } from '@/api/types'
import type { FarmViewSelection } from '@/components/farm/types'
import {
  copiedNNormPercentages,
  copiedSimulationName,
} from '@/lib/simulation-form'
import {
  creationRequestIdentity,
  isSimulationReady,
  type CreationRequestIdentity,
} from '@/lib/simulation-creation'

const buildCopyInput = (
  simulation: Simulation,
  offeredNNormPercentages: string[],
): CreateSimulationInput => ({
  name: copiedSimulationName(simulation.name),
  constraints: simulation.constraints,
  optimizeOnCreate: true,
  precisionFarming: simulation.precisionFarming,
  earlySowing: simulation.earlySowing,
  intermediateCrop: simulation.intermediateCrop,
  allowedRotationVariants: simulation.rotationVariants,
  allowedNNormPercentages: copiedNNormPercentages(
    simulation.nNormPercentages,
    simulation.fertiliser.farmingSystem,
    offeredNNormPercentages,
  ),
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
  const copyRequests = useRef(new Map<string, CreationRequestIdentity>())
  const { data: offeredNNormPercentages } = useRotationNNormPercentages(farmId)

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
    if (!farmId || !isSimulationReady(simulation)) return
    setCopyingSimulationId(simulation.id)
    try {
      const input = buildCopyInput(
        simulation,
        offeredNNormPercentages ?? simulation.nNormPercentages,
      )
      const identity = creationRequestIdentity(
        input,
        copyRequests.current.get(simulation.id) ?? null,
      )
      copyRequests.current.set(simulation.id, identity)
      const created = await createSimulation(farmId, {
        ...input,
        requestId: identity.requestId,
      })
      copyRequests.current.delete(simulation.id)
      await mutate(
        simulationsKey(farmId),
        (current: Simulation[] = []) => [
          ...current.filter((item) => item.id !== created.id),
          created,
        ],
        { revalidate: false },
      )
      void mutate(simulationsKey(farmId))
      onError(null)
      onSelectionChange({ kind: 'simulation', id: created.id })
    } catch {
      void mutate(simulationsKey(farmId))
      onError('Kunne ikke starte kopieringen af simuleringen. Prøv igen.')
    } finally {
      setCopyingSimulationId(null)
    }
  }

  return {
    copyingSimulationId,
    deletingSimulationId,
    copySimulation,
    removeSimulation,
  }
}
