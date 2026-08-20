import { useSimulationFieldCandidateDetail } from '@/api/hooks'
import { RotationYearsDetail } from '@/components/farm/RotationYearsDetail'

type RotationDetailPanelProps = {
  farmId: string
  simulationId: string
  fieldId: string
}

export const RotationDetailPanel = ({
  farmId,
  simulationId,
  fieldId,
}: RotationDetailPanelProps) => {
  const {
    data: detail,
    error,
    isLoading,
  } = useSimulationFieldCandidateDetail(farmId, simulationId, fieldId)

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
      <RotationYearsDetail years={years} />
    </div>
  )
}
