import { useEffect, useState } from 'react'

import { preloadRotationCandidateCatalog } from '@/api/hooks'
import type {
  FieldRecord,
  RotationCandidateYearResult,
  Simulation,
} from '@/api/types'
import { CropGroupTile } from '@/components/farm/CropGroupTile'
import { FieldYearStrip } from '@/components/farm/FieldYearStrip'
import { HistoricalDetailPanel } from '@/components/farm/HistoricalDetailPanel'
import { ManualRotationEditor } from '@/components/farm/ManualRotationEditor'
import { QuotaStatusIndicator } from '@/components/farm/QuotaStatusIndicator'
import { RotationDetailPanel } from '@/components/farm/RotationDetailPanel'
import { Button } from '@/components/ui/button'
import { DisclosureButton } from '@/components/ui/disclosure-button'
import { cropGroupFor } from '@/lib/crop-groups'
import {
  fieldTitle,
  formatNumber,
  formatQuotaAmount,
  getFieldQuotaStatus,
  isFieldCalculated,
  QUOTA_STATUS_STYLES,
  REAL_HISTORY_START_CALENDAR_YEAR,
  ROTATION_START_CALENDAR_YEAR,
  type QuotaStatus,
} from '@/lib/field-domain'
import { cn } from '@/lib/utils'

const buildStatusMessage = (
  status: QuotaStatus,
  isSimulationView: boolean,
): string => {
  if (status.level === 'uncalculated') {
    return isSimulationView
      ? 'Ikke beregnet endnu - kør Optimér'
      : 'Ingen beregnet udledning for markens historik'
  }
  if (status.level === 'noData') return 'Ingen kvote sat for denne mark'
  if (status.level === 'excluded') return 'Indgår ikke i beregningen'

  const amount = formatQuotaAmount(status.nLoad, status.quotaKgn)
  const pct =
    status.quotaKgn > 0 ? Math.round((status.nLoad / status.quotaKgn) * 100) : 0

  if (status.level === 'near') return `${amount} - tæt på markens kvote (${pct}%)`
  if (status.level === 'over') return `${amount} - over markens kvote (${pct}%)`
  return `${amount} - ${pct}% af markens kvote`
}

const QuotaStatusPill = ({
  status,
  isSimulationView,
  className,
}: {
  status: QuotaStatus
  isSimulationView: boolean
  className?: string
}) => {
  const style = QUOTA_STATUS_STYLES[status.level]
  return (
    <QuotaStatusIndicator
      level={status.level}
      className={cn(
        'rounded-full border px-3.5 py-2.5 text-xs font-medium @2xl:px-4 @2xl:py-2',
        style.surface,
        style.text,
        className,
      )}
    >
      {buildStatusMessage(status, isSimulationView)}
    </QuotaStatusIndicator>
  )
}

const PrimaryMetricCard = ({
  label,
  value,
  unit,
  muted = false,
}: {
  label: string
  value: string
  unit?: string
  muted?: boolean
}) => (
  <div className="rounded-lg border bg-card p-3 @2xl:border-2 @2xl:border-primary/20 @2xl:p-4">
    <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground @2xl:text-primary">
      {label}
    </div>
    <div
      className={cn(
        'mt-1 leading-tight tabular-nums',
        muted
          ? 'text-sm font-medium text-muted-foreground'
          : 'text-lg font-bold text-foreground @2xl:text-2xl',
      )}
    >
      {value}
    </div>
    {unit ? (
      <div className="mt-0.5 text-xs text-muted-foreground">{unit}</div>
    ) : null}
  </div>
)

const SupportMetricCard = ({
  label,
  value,
  detail,
  detailItalic = false,
  muted = false,
}: {
  label: string
  value: string
  detail?: string
  detailItalic?: boolean
  muted?: boolean
}) => (
  <div className="rounded-lg border bg-card px-3 py-2 @2xl:p-4 @2xl:opacity-90">
    <div className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
      {label}
    </div>
    <div
      className={cn(
        'mt-0.5 text-sm tabular-nums @2xl:mt-1 @2xl:text-lg',
        muted ? 'font-medium text-muted-foreground' : 'font-semibold',
      )}
    >
      {value}
      {detail ? (
        <span
          className={cn(
            'ml-1 text-xs font-normal text-muted-foreground',
            detailItalic && 'italic',
          )}
        >
          ({detail})
        </span>
      ) : null}
    </div>
  </div>
)

type FieldPanelProps = {
  farmId: string
  field: FieldRecord
  isSimulationView: boolean
  simulationId?: string
  simulation?: Simulation
  selectedYearIndex?: number | null
  onSelectedYearIndexChange?: (index: number | null) => void
  yearValues?: RotationCandidateYearResult[]
  yearValuesLoading?: boolean
  isDetaching: boolean
  onRequestDetach: () => void
  onCalcOpenChange?: (open: boolean) => void
  onError: (message: string | null) => void
}

export const FieldPanel = ({
  farmId,
  field,
  isSimulationView,
  simulationId,
  simulation,
  selectedYearIndex = null,
  onSelectedYearIndexChange,
  yearValues,
  yearValuesLoading = false,
  isDetaching,
  onRequestDetach,
  onCalcOpenChange,
  onError,
}: FieldPanelProps) => {
  const [calcOpen, setCalcOpen] = useState(false)
  const [manualEditorOpen, setManualEditorOpen] = useState(false)

  useEffect(() => {
    onCalcOpenChange?.(calcOpen)
    return () => onCalcOpenChange?.(false)
  }, [calcOpen, onCalcOpenChange])

  useEffect(() => {
    if (!isSimulationView || !simulationId) return
    preloadRotationCandidateCatalog(farmId)
  }, [farmId, isSimulationView, simulationId])

  const calculated = isFieldCalculated(field, isSimulationView)
  const rotationStartYear = isSimulationView
    ? ROTATION_START_CALENDAR_YEAR
    : REAL_HISTORY_START_CALENDAR_YEAR
  const quotaStatus = getFieldQuotaStatus(field, isSimulationView)
  const canShowCalcSection =
    !isSimulationView || (Boolean(simulationId) && field.rotationId !== null)
  const canEditRotation = isSimulationView && Boolean(simulationId)
  const rotationYearCount = yearValues?.length ?? field.cropRotation.length
  const highlightIndex =
    selectedYearIndex !== null && selectedYearIndex < rotationYearCount
      ? selectedYearIndex
      : null
  const hasYearValues = yearValues !== undefined && yearValues.length > 0
  const selectedCalendarYear =
    selectedYearIndex !== null ? rotationStartYear + selectedYearIndex : null
  const yearOutsideRotation =
    selectedCalendarYear !== null && highlightIndex === null
  const restartYear = rotationStartYear + field.cropRotation.length
  const firstYear = field.cropRotation[0]

  const metaParts = [
    `${formatNumber(field.areaHa)} ha`,
    field.soilTypeNumber !== null ? `JB ${field.soilTypeNumber}` : 'JB ukendt',
    field.retention !== null
      ? `Retention ${formatNumber(field.retention)}`
      : 'Retention ukendt',
    field.catchmentId !== null
      ? `Kystvand-id ${field.catchmentId}`
      : 'Kystvand-id ukendt',
  ]

  return (
    <div className="@container flex min-h-0 flex-1 flex-col motion-safe:animate-rise-in">
      <div className="flex-1 space-y-4 overflow-y-auto p-4 @2xl:space-y-5 @2xl:p-6">
        <div className="flex flex-col gap-3 @2xl:flex-row @2xl:items-start @2xl:justify-between @2xl:gap-4 @2xl:border-b @2xl:pb-3">
          <div className="min-w-0">
            <h2 className="truncate font-display text-2xl tracking-tight @2xl:text-3xl">
              {fieldTitle(field)}
            </h2>
            <div className="mt-1 flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
              {metaParts.map((part, index) => (
                <span key={index} className="flex items-center gap-x-2">
                  {index > 0 ? (
                    <span className="size-1 rounded-full bg-border" aria-hidden="true" />
                  ) : null}
                  {part}
                </span>
              ))}
            </div>
          </div>
          <QuotaStatusPill
            status={quotaStatus}
            isSimulationView={isSimulationView}
            className="@2xl:shrink-0"
          />
        </div>

        <div className="grid grid-cols-2 gap-x-2 gap-y-4 @2xl:grid-cols-4 @2xl:gap-3">
          <PrimaryMetricCard
            label="DB2"
            value={calculated ? `${formatNumber(field.db2)} kr` : 'Ikke beregnet'}
            unit={
              calculated && field.areaHa > 0
                ? `${formatNumber(field.db2 / field.areaHa)} kr/ha`
                : undefined
            }
            muted={!calculated}
          />
          <PrimaryMetricCard
            label="Udledning"
            value={
              calculated ? `${formatNumber(field.nLoad)} kg N` : 'Ikke beregnet'
            }
            unit={
              calculated && field.areaHa > 0
                ? `${formatNumber(field.nLoad / field.areaHa)} kg N/ha`
                : undefined
            }
            muted={!calculated}
          />
          <SupportMetricCard
            label="Udvaskning"
            value={
              calculated
                ? `${formatNumber(field.leaching)} kg N`
                : 'Ikke beregnet'
            }
            detail={
              calculated && field.areaHa > 0
                ? `${formatNumber(field.leaching / field.areaHa)} kg N/ha`
                : undefined
            }
            muted={!calculated}
          />
          <SupportMetricCard
            label="Foderenheder"
            value={
              !calculated
                ? 'Ikke beregnet'
                : field.feedUnits === 0
                  ? '-'
                  : `${formatNumber(field.feedUnits)} FE`
            }
            detail={
              !calculated
                ? undefined
                : field.feedUnits === 0
                  ? 'ingen grovfoder i sædskiftet'
                  : field.areaHa > 0
                    ? `${formatNumber(field.feedUnits / field.areaHa)} FE/ha`
                    : undefined
            }
            detailItalic={calculated && field.feedUnits === 0}
            muted={!calculated || field.feedUnits === 0}
          />
        </div>

        <div className="@container rounded-lg border bg-card p-3.5 @2xl:p-4">
          <div className="border-b pb-2">
            <h3 className="text-sm font-semibold">
              {isSimulationView ? 'Sædskifte år for år' : 'Afgrødehistorik år for år'}
            </h3>
            {field.cropRotation.length > 0 ? (
              <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">
                {isSimulationView
                  ? `Marken følger en fast plan på ${field.cropRotation.length} år, der gentager sig. Markens tal er gennemsnittet over planens år.`
                  : 'Markens registrerede afgrøder de seneste år, fra markregistret.'}
              </p>
            ) : null}
          </div>
          {field.cropRotation.length === 0 ? (
            <p className="pt-2 text-sm text-muted-foreground">
              {isSimulationView ? 'Intet sædskifte endnu' : 'Ingen afgrødehistorik endnu'}
            </p>
          ) : (
            <>
              <FieldYearStrip
                field={field}
                yearValues={yearValues}
                startYear={rotationStartYear}
                selectedIndex={highlightIndex}
                onSelect={onSelectedYearIndexChange}
              />
              {yearOutsideRotation ? (
                <p className="pt-2 text-xs text-muted-foreground">
                  {selectedCalendarYear} ligger uden for markens sædskifte ({rotationYearCount} år)
                </p>
              ) : null}
              {!hasYearValues && !yearValuesLoading ? (
                <p className="pt-2 text-xs text-muted-foreground">
                  {isSimulationView
                    ? 'Ikke beregnet endnu - kør Optimér for tal pr. år'
                    : 'Ingen beregnet udledning for markens historik'}
                </p>
              ) : null}
              {isSimulationView ? (
                <div className="mt-2 flex items-center gap-1.5 border-t pt-2 text-xs leading-4 text-muted-foreground tabular-nums">
                  <CropGroupTile
                    group={cropGroupFor(firstYear.cropCode, firstYear.cropName)}
                    hasUndersownCrop={firstYear.undersownCropName !== null}
                  />
                  <span>
                    {restartYear}: forfra med {firstYear.cropName}
                  </span>
                </div>
              ) : null}
            </>
          )}
        </div>

        {canShowCalcSection ? (
          <div className="rounded-lg border bg-card">
            <div className={cn(calcOpen && 'rounded-t-lg border-b bg-background')}>
              <DisclosureButton
                open={calcOpen}
                onToggle={() => setCalcOpen((current) => !current)}
                label="Sådan er tallene beregnet"
                hint="Vis detaljer"
                hintAlign="end"
                className={cn(
                  'w-full px-3.5 py-2.5 @2xl:px-4',
                  calcOpen ? 'rounded-t-lg @2xl:py-3' : 'rounded-lg',
                )}
              />
            </div>
            {calcOpen ? (
              <div className="motion-safe:animate-rise-in">
                {isSimulationView ? (
                  <RotationDetailPanel
                    farmId={farmId}
                    simulationId={simulationId as string}
                    fieldId={field.id}
                    rotationId={field.rotationId}
                    areaHa={field.areaHa}
                    retention={field.retention}
                    selectedYearIndex={highlightIndex ?? undefined}
                    onSelectedYearIndexChange={
                      selectedCalendarYear !== null && onSelectedYearIndexChange
                        ? onSelectedYearIndexChange
                        : undefined
                    }
                  />
                ) : (
                  <HistoricalDetailPanel
                    farmId={farmId}
                    fieldId={field.id}
                    areaHa={field.areaHa}
                    retention={field.retention}
                  />
                )}
              </div>
            ) : null}
          </div>
        ) : null}
      </div>

      <div className="border-t bg-background p-4 @2xl:flex @2xl:justify-end @2xl:px-6">
        {isSimulationView ? (
          <Button
            variant="outline"
            size="sm"
            className="w-full @2xl:w-auto @2xl:px-5"
            disabled={!canEditRotation || field.rotationId === null}
            onClick={() => setManualEditorOpen(true)}
            title={
              !canEditRotation
                ? 'Opret en simulering for at redigere sædskifter.'
                : field.rotationId === null
                  ? 'Kør Optimér for denne mark, før du kan redigere manuelt.'
                  : undefined
            }
          >
            Rediger sædskifte
          </Button>
        ) : (
          <Button
            variant="destructive"
            size="sm"
            className="w-full @2xl:w-auto @2xl:px-5"
            onClick={onRequestDetach}
            loading={isDetaching}
          >
            {isDetaching ? 'Fjerner...' : 'Fjern mark'}
          </Button>
        )}
      </div>

      {isSimulationView && simulationId && simulation && manualEditorOpen ? (
        <ManualRotationEditor
          farmId={farmId}
          simulationId={simulationId}
          simulation={simulation}
          field={field}
          open
          onOpenChange={setManualEditorOpen}
          onError={onError}
        />
      ) : null}
    </div>
  )
}
