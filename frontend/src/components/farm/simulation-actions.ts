import { useRef, useState } from 'react'
import { mutate } from 'swr'

import {
  simulationViewKey,
  simulationsKey,
  useRotationNNormPercentages,
} from '@/api/hooks'
import { createSimulation, deleteSimulation } from '@/api/mutations'
import type { CreateSimulationInput, Simulation } from '@/api/types'
import { DEFAULT_OPTIMIZATION_SETTINGS, optimizationSettingsInput } from '@/lib/simulation-settings'
import type { FarmViewSelection } from '@/components/farm/types'
import { STANDARD_PROFILE_ID } from '@/lib/economics-profiles'
import {
  copiedNNormPercentages,
  copiedSimulationName,
  lacksOrganicFertiliser,
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
  optimizationSettings: optimizationSettingsInput(simulation.optimizationSettings ?? DEFAULT_OPTIMIZATION_SETTINGS),
  precisionFarming: simulation.precisionFarming,
  earlySowing: simulation.earlySowing,
  intermediateCrop: simulation.intermediateCrop,
  economicsModuleId: simulation.economicsModuleId ?? STANDARD_PROFILE_ID,
  allowedRotationVariants: simulation.rotationVariants,
  allowedNNormPercentages: copiedNNormPercentages(
    simulation.nNormPercentages,
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
    const selected =
      selection.kind === 'simulation' && selection.id === simulationId
    setDeletingSimulationId(simulationId)
    try {
      await deleteSimulation(farmId, simulationId)
      await mutate(simulationsKey(farmId))
      await mutate(simulationViewKey(farmId, simulationId), undefined, {
        revalidate: false,
      })
      if (selected) onSelectionChange({ kind: 'current' })
      onError(null)
    } catch {
      onError('Kunne ikke slette simuleringen.')
    }
    setDeletingSimulationId(null)
  }

  const copySimulation = async (simulation: Simulation) => {
    if (!farmId || !isSimulationReady(simulation)) return
    if (lacksOrganicFertiliser(simulation.fertiliser)) {
      onError(
        'Simuleringen kan ikke kopieres, fordi økologisk kræver organisk gødning. Vælg en gødning under Ret grundlag først.',
      )
      return
    }
    const nNormPercentages =
      offeredNNormPercentages ?? simulation.nNormPercentages
    const previousRequest = copyRequests.current.get(simulation.id) ?? null
    setCopyingSimulationId(simulation.id)
    try {
      const input = buildCopyInput(simulation, nNormPercentages)
      const identity = creationRequestIdentity(input, previousRequest)
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
    }
    setCopyingSimulationId(null)
  }

  return {
    copyingSimulationId,
    deletingSimulationId,
    copySimulation,
    removeSimulation,
  }
}
