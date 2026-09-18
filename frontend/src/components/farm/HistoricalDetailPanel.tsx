import { ApiError } from '@/api/client'
import { useFieldHistoricalDetail } from '@/api/hooks'
import { LoadingSkeleton } from '@/components/farm/LoadingSkeleton'
import { RotationYearsDetail } from '@/components/farm/RotationYearsDetail'
import { LoadError } from '@/components/ui/load-error'
import { REAL_HISTORY_START_CALENDAR_YEAR } from '@/lib/field-domain'

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
  const {
    data: years,
    error,
    isLoading,
    isValidating,
    mutate: retry,
  } = useFieldHistoricalDetail(farmId, fieldId)

  if (isLoading) {
    return <LoadingSkeleton message="Henter beregningsdetaljer..." />
  }

  if (error) {
    return (
      <LoadError
        className="m-4"
        message={
          error instanceof ApiError
            ? `Kunne ikke hente beregningsdetaljer: ${error.message}`
            : 'Kunne ikke hente beregningsdetaljer.'
        }
        onRetry={() => void retry()}
        retrying={isValidating}
      />
    )
  }

  if (!years || years.length === 0) return null

  return (
    <div className="border-t bg-muted/20 p-4">
      <RotationYearsDetail
        years={years}
        areaHa={areaHa}
        retention={retention}
        startCalendarYear={REAL_HISTORY_START_CALENDAR_YEAR}
      />
    </div>
  )
}
