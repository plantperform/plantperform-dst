import { useEffect, useRef } from 'react'
import { mutate } from 'swr'

import {
  simulationFieldCandidateDetailKey,
  useSimulationFieldCandidateDetail,
} from '@/api/hooks'
import { LoadingSkeleton } from '@/components/farm/LoadingSkeleton'
import { RotationYearsDetail } from '@/components/farm/RotationYearsDetail'

type RotationDetailPanelProps = {
  farmId: string
  simulationId: string
  fieldId: string
  // The mark's CURRENT assigned candidate (from the already-fresh mark list).
  // The panel can remain open during an "Optimér" or "Års-optimering" run, and
  // SWR reloads candidate detail only on mount/remount, not automatically when
  // the mark receives a new assignment. A change in this value triggers the
  // reload without revalidating all previously opened panels' keys at once
  // (which was the source of the fixed burst of 422 responses).
  rotationId: string | null
  areaHa: number
  retention: number | null
  selectedYearIndex?: number
  onSelectedYearIndexChange?: (index: number) => void
}

export const RotationDetailPanel = ({
  farmId,
  simulationId,
  fieldId,
  rotationId,
  areaHa,
  retention,
  selectedYearIndex,
  onSelectedYearIndexChange,
}: RotationDetailPanelProps) => {
  const {
    data: detail,
    error,
    isLoading,
  } = useSimulationFieldCandidateDetail(farmId, simulationId, fieldId)

  const previousRotationId = useRef(rotationId)
  useEffect(() => {
    if (previousRotationId.current !== rotationId) {
      previousRotationId.current = rotationId
      void mutate(simulationFieldCandidateDetailKey(farmId, simulationId, fieldId))
    }
  }, [rotationId, farmId, simulationId, fieldId])

  if (isLoading) {
    return <LoadingSkeleton message="Henter beregningsdetaljer..." />
  }

  if (error) {
    return (
      <div className="p-4 text-sm text-red-700">
        Kunne ikke hente beregningsdetaljer: {error.message}
      </div>
    )
  }

  if (!detail) return null

  const years = detail.years.slice(0, detail.activeLen)
  const highlightIndex =
    selectedYearIndex !== undefined && selectedYearIndex < years.length
      ? selectedYearIndex
      : undefined

  return (
    <div className="border-t bg-muted/20 p-4">
      <RotationYearsDetail
        years={years}
        areaHa={areaHa}
        retention={retention}
        selectedYearIndex={highlightIndex}
        onSelectedYearIndexChange={onSelectedYearIndexChange}
      />
    </div>
  )
}
