import { ChevronRight, Lock, LockOpen, Repeat, X } from 'lucide-react'
import { useEffect, useState } from 'react'

import { preloadRotationCandidateCatalog } from '@/api/hooks'
import type { FieldRecord, Simulation } from '@/api/types'
import { CropYearSwatch } from '@/components/farm/CropYearSwatch'
import { ManualRotationEditor } from '@/components/farm/ManualRotationEditor'
import { RotationDetailPanel } from '@/components/farm/RotationDetailPanel'
import { Button } from '@/components/ui/button'
import {
  CROP_YEAR_FALLBACK_COLOR,
  CURRENT_CALENDAR_YEAR,
  formatNumber,
  formatQuotaAmount,
  getFieldQuotaStatus,
  isFieldCalculated,
  QUOTA_WARNING_LEVEL_COLORS,
  ROTATION_START_CALENDAR_YEAR,
  type QuotaStatus,
  type QuotaStatusLevel,
} from '@/lib/field-domain'

const STATUS_CARD_STYLES: Record<
  QuotaStatusLevel,
  { bg: string; border: string; text: string }
> = {
  ok: { bg: '#f0fdf4', border: '#bbf7d0', text: '#166534' },
  near: QUOTA_WARNING_LEVEL_COLORS.near,
  over: QUOTA_WARNING_LEVEL_COLORS.over,
  uncalculated: { bg: '#f9fafb', border: '#e5e7eb', text: '#4b5563' },
  noData: { bg: '#f9fafb', border: '#e5e7eb', text: '#4b5563' },
  partial: { bg: '#f9fafb', border: '#e5e7eb', text: '#4b5563' },
}

const buildStatusMessage = (status: QuotaStatus): string => {
  if (status.level === 'uncalculated') return 'Ikke beregnet endnu - kør Optimér'
  if (status.level === 'noData') return 'Ingen kvote sat for denne mark'

  const amount = formatQuotaAmount(status)
  const pct =
    status.quotaKgn > 0 ? Math.round((status.nLoad / status.quotaKgn) * 100) : 0

  if (status.level === 'near') return `${amount} - tæt på markens kvote (${pct}%)`
  if (status.level === 'over') return `${amount} - over markens kvote (${pct}%)`
  return `${amount} - ${pct}% af markens kvote`
}

const QuotaStatusCard = ({ status }: { status: QuotaStatus }) => {
  const style = STATUS_CARD_STYLES[status.level]
  return (
    <div
      className="rounded-lg border px-3 py-2.5 text-sm"
      style={{
        backgroundColor: style.bg,
        borderColor: style.border,
        color: style.text,
      }}
    >
      {buildStatusMessage(status)}
    </div>
  )
}

const MetricCard = ({
  label,
  value,
  caption,
  muted = false,
}: {
  label: string
  value: string
  caption?: string
  muted?: boolean
}) => (
  <div className="rounded-xl border p-3">
    <div className="text-[11.5px] font-medium uppercase tracking-wide text-muted-foreground">
      {label}
    </div>
    <div
      className={`mt-1 text-sm ${muted ? 'text-muted-foreground' : 'font-semibold'}`}
    >
      {value}
    </div>
    {caption ? (
      <div className="mt-0.5 text-xs text-muted-foreground">{caption}</div>
    ) : null}
  </div>
)

const RotationYearRow = ({
  year,
  index,
  cropColorMap,
}: {
  year: FieldRecord['cropRotation'][number]
  index: number
  cropColorMap: Map<number, string>
}) => {
  const calendarYear = ROTATION_START_CALENDAR_YEAR + index
  const hasUdlaeg = year.udlaegNavn !== null
  const color = cropColorMap.get(year.afgrodeKode) ?? CROP_YEAR_FALLBACK_COLOR
  const isCurrentYear = calendarYear === CURRENT_CALENDAR_YEAR
  return (
    <li className="flex items-center gap-2.5">
      <span className="w-9 shrink-0 text-xs text-muted-foreground">
        {calendarYear}
      </span>
      <CropYearSwatch color={color} hasUdlaeg={hasUdlaeg} size="14x10" />
      <span className={`text-sm ${isCurrentYear ? 'font-medium' : ''}`}>
        {year.afgrodeNavn}
      </span>
      {isCurrentYear ? (
        <span className="rounded-full bg-muted px-1.5 text-[11px] text-muted-foreground">
          i år
        </span>
      ) : null}
      {hasUdlaeg ? (
        <span
          className="rounded-full px-2 py-0.5 text-xs"
          style={{ backgroundColor: '#e7edda', color: '#0f4a24' }}
        >
          efterafgrøde
        </span>
      ) : null}
    </li>
  )
}

type MarkPanelProps = {
  farmId: string
  field: FieldRecord
  isSimulationView: boolean
  simulationId?: string
  simulation?: Simulation
  cropColorMap: Map<number, string>
  isLocked: boolean
  isLockingInProgress: boolean
  onToggleLock: () => void
  isDetaching: boolean
  onRequestDetach: () => void
  onClose: () => void
  onError: (message: string | null) => void
}

export const MarkPanel = ({
  farmId,
  field,
  isSimulationView,
  simulationId,
  simulation,
  cropColorMap,
  isLocked,
  isLockingInProgress,
  onToggleLock,
  isDetaching,
  onRequestDetach,
  onClose,
  onError,
}: MarkPanelProps) => {
  const [calcOpen, setCalcOpen] = useState(false)
  const [manualEditorOpen, setManualEditorOpen] = useState(false)

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      if (event.defaultPrevented) return
      onClose()
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [onClose])

  useEffect(() => {
    if (!isSimulationView || !simulationId) return
    preloadRotationCandidateCatalog(farmId)
  }, [farmId, isSimulationView, simulationId])

  const calculated = isFieldCalculated(field, isSimulationView)
  const quotaStatus = getFieldQuotaStatus(field, isSimulationView)
  const canShowCalcSection =
    isSimulationView && Boolean(simulationId) && field.rotationId !== null
  const canEditRotation = isSimulationView && Boolean(simulationId)

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
    <div
      className="fixed inset-y-0 right-0 z-40 flex flex-col border-l bg-white"
      style={{
        boxShadow: '-18px 0 40px rgba(27,43,34,0.12)',
        width: calcOpen ? 'min(950px, 90vw)' : '460px',
        transition: 'width 250ms ease',
      }}
      role="complementary"
      aria-label={`Markdetaljer: ${field.name}`}
    >
      <div className="flex items-start justify-between gap-3 border-b p-4">
        <div className="min-w-0">
          <h2 className="truncate text-[19px] font-semibold">
            Mark {field.name}
          </h2>
          <div className="mt-1 flex flex-wrap items-center text-[12.5px] text-muted-foreground">
            {metaParts.map((part, index) => (
              <span
                key={index}
                className={index > 0 ? 'ml-2 border-l pl-2' : undefined}
              >
                {part}
              </span>
            ))}
          </div>
        </div>
        <Button
          variant="ghost"
          size="sm"
          className="h-8 w-8 shrink-0 p-0 text-muted-foreground"
          onClick={onClose}
          aria-label="Luk"
        >
          <X className="h-4 w-4" aria-hidden="true" />
        </Button>
      </div>

      <div className="flex-1 space-y-4 overflow-y-auto p-4">
        <div className={calcOpen ? 'space-y-4' : 'max-w-[416px] space-y-4'}>
          <QuotaStatusCard status={quotaStatus} />

          <div className={`grid gap-3 ${calcOpen ? 'grid-cols-4' : 'grid-cols-2'}`}>
            <MetricCard
              label="DB2"
              value={calculated ? `${formatNumber(field.db2)} kr` : 'Ikke beregnet'}
              caption={
                calculated && field.areaHa > 0
                  ? `${formatNumber(field.db2 / field.areaHa)} kr/ha`
                  : undefined
              }
              muted={!calculated}
            />
            <MetricCard
              label="Udledning"
              value={
                calculated ? `${formatNumber(field.nLoad)} kg N` : 'Ikke beregnet'
              }
              caption={
                calculated && field.areaHa > 0
                  ? `${formatNumber(field.nLoad / field.areaHa)} kg N/ha`
                  : undefined
              }
              muted={!calculated}
            />
            <MetricCard
              label="Udvaskning"
              value={
                calculated
                  ? `${formatNumber(field.leaching)} kg N`
                  : 'Ikke beregnet'
              }
              caption={
                calculated && field.areaHa > 0
                  ? `${formatNumber(field.leaching / field.areaHa)} kg N/ha`
                  : undefined
              }
              muted={!calculated}
            />
            <MetricCard
              label="Foderenheder"
              value={
                !calculated
                  ? 'Ikke beregnet'
                  : field.fen === 0
                    ? '-'
                    : `${formatNumber(field.fen)} FE`
              }
              caption={
                !calculated
                  ? undefined
                  : field.fen === 0
                    ? 'ingen grovfoder i sædskiftet'
                    : field.areaHa > 0
                      ? `${formatNumber(field.fen / field.areaHa)} FE/ha`
                      : undefined
              }
              muted={!calculated || field.fen === 0}
            />
          </div>

          <div className="space-y-2">
            <h3 className="text-sm font-semibold">Sædskifte år for år</h3>
            {field.cropRotation.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                Intet sædskifte endnu
              </p>
            ) : (
              (() => {
                const columns = calcOpen ? 2 : 1
                const columnSize = Math.ceil(field.cropRotation.length / columns)
                const columnLists = Array.from({ length: columns }, (_, columnIndex) => (
                  <ul key={columnIndex} className="space-y-1.5">
                    {field.cropRotation
                      .slice(columnIndex * columnSize, (columnIndex + 1) * columnSize)
                      .map((year, index) => {
                        const actualIndex = columnIndex * columnSize + index
                        return (
                          <RotationYearRow
                            key={actualIndex}
                            year={year}
                            index={actualIndex}
                            cropColorMap={cropColorMap}
                          />
                        )
                      })}
                  </ul>
                ))
                const restartYear = ROTATION_START_CALENDAR_YEAR + field.cropRotation.length
                return (
                  <>
                    <p className="text-xs text-muted-foreground">
                      Marken følger en fast plan på {field.cropRotation.length} år,
                      der gentager sig. Markens tal er gennemsnittet over planens år.
                    </p>
                    {columns === 2 ? (
                      <div className="grid grid-cols-2 gap-x-8">
                        {columnLists}
                      </div>
                    ) : (
                      columnLists[0]
                    )}
                    <div className="mt-2 flex items-center gap-2 text-xs text-muted-foreground">
                      <Repeat className="h-3.5 w-3.5" aria-hidden="true" />
                      <span>
                        {restartYear}: forfra med{' '}
                        {field.cropRotation[0].afgrodeNavn}
                      </span>
                    </div>
                  </>
                )
              })()
            )}
          </div>
        </div>

        {canShowCalcSection ? (
          <div className="rounded-lg border">
            <button
              type="button"
              className="flex w-full items-center justify-between gap-2 px-3 py-2.5 text-left"
              onClick={() => setCalcOpen((current) => !current)}
              aria-expanded={calcOpen}
            >
              <span className="flex items-center gap-2 text-sm font-medium">
                <ChevronRight
                  className={`h-4 w-4 text-muted-foreground transition-transform ${
                    calcOpen ? 'rotate-90' : ''
                  }`}
                  aria-hidden="true"
                />
                Sådan er tallene beregnet
              </span>
            </button>
            {calcOpen ? (
              <div className="border-t">
                <RotationDetailPanel
                  farmId={farmId}
                  simulationId={simulationId as string}
                  fieldId={field.id}
                  rotationId={field.rotationId}
                  areaHa={field.areaHa}
                  retention={field.retention}
                />
              </div>
            ) : null}
          </div>
        ) : null}
      </div>

      <div className="border-t px-4 py-3" style={{ backgroundColor: '#fbfcf8' }}>
        {isSimulationView ? (
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
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
            {canEditRotation ? (
              <Button
                size="sm"
                variant="ghost"
                onClick={onToggleLock}
                disabled={field.rotationId === null || isLockingInProgress}
                aria-label={isLocked ? 'Lås op' : 'Lås'}
                className={
                  isLocked
                    ? 'h-9 w-9 p-0 bg-amber-100 text-amber-700'
                    : 'h-9 w-9 p-0 text-muted-foreground'
                }
                title={
                  isLocked
                    ? 'Marken er låst til det valgte sædskifte - Optimér ændrer den ikke. Klik for at låse op.'
                    : 'Marken er ikke låst - Optimér kan frit ændre den. Klik for at låse.'
                }
              >
                {isLocked ? (
                  <Lock className="h-4 w-4" aria-hidden="true" />
                ) : (
                  <LockOpen className="h-4 w-4" aria-hidden="true" />
                )}
              </Button>
            ) : null}
          </div>
        ) : (
          <Button
            variant="destructive"
            size="sm"
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
          cropColorMap={cropColorMap}
          open
          onOpenChange={setManualEditorOpen}
          onError={onError}
        />
      ) : null}
    </div>
  )
}
