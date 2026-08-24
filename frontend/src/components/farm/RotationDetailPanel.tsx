import { useEffect, useRef } from 'react'
import { mutate } from 'swr'

import {
  simulationFieldCandidateDetailKey,
  useSimulationFieldCandidateDetail,
} from '@/api/hooks'
import { RotationYearsDetail } from '@/components/farm/RotationYearsDetail'

type RotationDetailPanelProps = {
  farmId: string
  simulationId: string
  fieldId: string
  // Markens AKTUELLE tildelte kandidat (fra den allerede-friske markliste) —
  // panelet kan stå åbent hen over en Optimér-/Års-optimering-kørsel, og
  // SWR genindlæser kun candidate-detail ved (gen)mount, ikke automatisk når
  // marken får en ny tildeling undervejs. Skift i denne værdi er signalet om
  // at genindlæse — uden at skulle revalidere ALLE tidligere-åbnede panelers
  // nøgler på én gang (det var netop den byge af 422'ere, der blev rettet).
  rotationId: string | null
  areaHa: number
}

export const RotationDetailPanel = ({
  farmId,
  simulationId,
  fieldId,
  rotationId,
  areaHa,
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
    return (
      <div className="p-4 text-sm text-muted-foreground">
        Henter beregningsdetaljer...
      </div>
    )
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

  return (
    <div className="border-t bg-muted/20 p-4">
      <RotationYearsDetail years={years} areaHa={areaHa} />
    </div>
  )
}
