import { useFieldHistoricalDetail } from '@/api/hooks'
import { RotationYearsDetail } from '@/components/farm/RotationYearsDetail'

type HistoricalDetailPanelProps = {
  farmId: string
  fieldId: string
  areaHa: number
  retention: number | null
}

export const HistoricalDetailPanel = ({
  farmId,
  fieldId,
  areaHa,
  retention,
}: HistoricalDetailPanelProps) => {
  const { data: years, error, isLoading } = useFieldHistoricalDetail(farmId, fieldId)

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

  if (!years || years.length === 0) return null

  return (
    <div className="border-t bg-muted/20 p-4">
      <RotationYearsDetail years={years} areaHa={areaHa} retention={retention} />
    </div>
  )
}
