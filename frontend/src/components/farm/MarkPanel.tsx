import { Repeat } from 'lucide-react'
import { useEffect, useState } from 'react'

import { preloadRotationCandidateCatalog } from '@/api/hooks'
import type {
  FieldRecord,
  RotationCandidateYearResult,
  Simulation,
} from '@/api/types'
import { CropYearSwatch } from '@/components/farm/CropYearSwatch'
import { HistoricalDetailPanel } from '@/components/farm/HistoricalDetailPanel'
import { ManualRotationEditor } from '@/components/farm/ManualRotationEditor'
import { QuotaStatusIndicator } from '@/components/farm/QuotaStatusIndicator'
import { RotationDetailPanel } from '@/components/farm/RotationDetailPanel'
import { Button } from '@/components/ui/button'
import { DisclosureButton } from '@/components/ui/disclosure-button'
import { cropGroupColor } from '@/lib/crop-groups'
import {
  CURRENT_CALENDAR_YEAR,
  formatNumber,
  formatQuotaAmount,
  formatWholeNumber,
  getFieldQuotaStatus,
  isFieldCalculated,
  QUOTA_STATUS_STYLES,
  REAL_HISTORY_START_CALENDAR_YEAR,
  ROTATION_START_CALENDAR_YEAR,
  yearNLoadKgHa,
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

const RotationYearRow = ({
  year,
  index,
  startYear,
  isSelected = false,
  selectedStatus,
  selectedValues,
}: {
  year: FieldRecord['cropRotation'][number]
  index: number
  startYear: number
  isSelected?: boolean
  selectedStatus: QuotaStatus
  selectedValues: string | null
}) => {
  const calendarYear = startYear + index
  const hasUdlaeg = year.udlaegNavn !== null
  const color = cropGroupColor(year.afgrodeKode, year.afgrodeNavn)
  const isCurrentYear = calendarYear === CURRENT_CALENDAR_YEAR
  const style = QUOTA_STATUS_STYLES[selectedStatus.level]
  const showRightGroup = hasUdlaeg || (isSelected && selectedValues !== null)
  return (
    <li
      className={cn(
        'motion-safe:transition-colors motion-safe:duration-300',
        isSelected && 'border-l-2 border-l-primary @2xl:border-l-4',
      )}
      aria-current={isSelected ? 'true' : undefined}
    >
      <div
        className={cn(
          'flex flex-wrap items-center gap-x-2.5 gap-y-1 px-1.5 py-1.5 motion-safe:transition-colors motion-safe:duration-300 @2xl:px-3',
          isSelected && cn('rounded-r-md py-2 @2xl:py-2.5', style.surface),
        )}
      >
        <span className="w-9 shrink-0 tabular-nums text-muted-foreground">
          {calendarYear}
        </span>
        <CropYearSwatch color={color} hasUdlaeg={hasUdlaeg} size="14x10" />
        <span className={isCurrentYear || isSelected ? 'font-medium' : undefined}>
          {year.afgrodeNavn}
        </span>
        {isSelected ? (
          <span className="rounded-full bg-primary px-1.5 py-px text-xs font-semibold text-primary-foreground">
            valgt år
          </span>
        ) : null}
        {isCurrentYear ? (
          <span className="rounded-full bg-muted px-1.5 text-xs text-muted-foreground">
            i år
          </span>
        ) : null}
        {showRightGroup ? (
          <span className="ml-auto flex items-center gap-2">
            {hasUdlaeg ? (
              <span className="rounded-full border bg-muted px-2 py-0.5 text-xs text-primary">
                efterafgrøde
              </span>
            ) : null}
            {isSelected && selectedValues !== null ? (
              <span
                className={cn(
                  'hidden rounded-md border bg-card px-3 py-1 text-xs tabular-nums @2xl:inline-block',
                  style.text,
                )}
              >
                {selectedValues}
              </span>
            ) : null}
          </span>
        ) : null}
        {isSelected && selectedValues !== null ? (
          <span className={cn('basis-full pl-11 text-xs tabular-nums @2xl:hidden', style.text)}>
            {selectedValues}
          </span>
        ) : null}
      </div>
    </li>
  )
}

type MarkPanelProps = {
  farmId: string
  field: FieldRecord
  isSimulationView: boolean
  simulationId?: string
  simulation?: Simulation
  selectedYearIndex?: number | null
  onSelectedYearIndexChange?: (index: number | null) => void
  yearValues?: RotationCandidateYearResult[]
  isDetaching: boolean
  onRequestDetach: () => void
  onCalcOpenChange?: (open: boolean) => void
  onError: (message: string | null) => void
}

export const MarkPanel = ({
  farmId,
  field,
  isSimulationView,
  simulationId,
  simulation,
  selectedYearIndex = null,
  onSelectedYearIndexChange,
  yearValues,
  isDetaching,
  onRequestDetach,
  onCalcOpenChange,
  onError,
}: MarkPanelProps) => {
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
    isSimulationView &&
    selectedYearIndex !== null &&
    selectedYearIndex < rotationYearCount
      ? selectedYearIndex
      : null
  const selectedYearValue =
    highlightIndex !== null ? (yearValues?.[highlightIndex] ?? null) : null
  const selectedCalendarYear =
    selectedYearIndex !== null ? rotationStartYear + selectedYearIndex : null
  const yearOutsideRotation =
    selectedCalendarYear !== null && highlightIndex === null
  const selectedValuesText =
    selectedYearValue && selectedCalendarYear !== null
      ? `${selectedCalendarYear}: DB2 ${formatWholeNumber(
          selectedYearValue.dbKrHa * field.areaHa,
        )} kr, udledning ${formatNumber(
          yearNLoadKgHa(selectedYearValue.leachingKgNHa, field.retention) *
            field.areaHa,
        )} kg N`
      : null
  const restartYear = rotationStartYear + field.cropRotation.length

  const metaParts = [
    `${formatNumber(field.areaHa)} ha`,
    field.jbnr !== null ? `JB ${field.jbnr}` : 'JB ukendt',
    field.retention !== null
      ? `Retention ${formatNumber(field.retention)}`
      : 'Retention ukendt',
    field.kystvandId !== null
      ? `Kystvand-id ${field.kystvandId}`
      : 'Kystvand-id ukendt',
  ]

  return (
    <div className="@container flex min-h-0 flex-1 flex-col motion-safe:animate-rise-in">
      <div className="flex-1 space-y-4 overflow-y-auto p-4 @2xl:space-y-5 @2xl:p-6">
        <div className="flex flex-col gap-3 @2xl:flex-row @2xl:items-start @2xl:justify-between @2xl:gap-4 @2xl:border-b @2xl:pb-3">
          <div className="min-w-0">
            <h2 className="truncate font-display text-2xl tracking-tight @2xl:text-3xl">
              Mark {field.name}
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
                : field.fen === 0
                  ? '-'
                  : `${formatNumber(field.fen)} FE`
            }
            detail={
              !calculated
                ? undefined
                : field.fen === 0
                  ? 'ingen grovfoder i sædskiftet'
                  : field.areaHa > 0
                    ? `${formatNumber(field.fen / field.areaHa)} FE/ha`
                    : undefined
            }
            detailItalic={calculated && field.fen === 0}
            muted={!calculated || field.fen === 0}
          />
        </div>

        <div className="rounded-lg border bg-card p-3.5 @2xl:p-4">
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
              <ul className="divide-y text-xs">
                {field.cropRotation.map((year, index) => (
                  <RotationYearRow
                    key={index}
                    year={year}
                    index={index}
                    startYear={rotationStartYear}
                    isSelected={highlightIndex === index}
                    selectedStatus={quotaStatus}
                    selectedValues={selectedValuesText}
                  />
                ))}
              </ul>
              {yearOutsideRotation ? (
                <p className="pt-2 text-xs text-muted-foreground">
                  {selectedCalendarYear} ligger uden for markens sædskifte ({rotationYearCount} år)
                </p>
              ) : null}
              {isSimulationView ? (
                <div className="mt-1 flex items-center gap-2 border-t pt-2 text-xs text-muted-foreground">
                  <Repeat className="size-4" aria-hidden="true" />
                  <span>
                    {restartYear}: forfra med{' '}
                    {field.cropRotation[0].afgrodeNavn}
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
            disabled={isDetaching}
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
