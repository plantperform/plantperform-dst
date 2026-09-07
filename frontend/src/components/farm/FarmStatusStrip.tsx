import { ChevronDown } from 'lucide-react'
import { useId, useMemo, useState } from 'react'

import type { FieldRecord, OptimizeSimulationResponse } from '@/api/types'
import {
  catchmentKey,
  useCatchmentOptions,
} from '@/components/farm/catchment-options'
import { QuotaStatusIndicator } from '@/components/farm/QuotaStatusIndicator'
import {
  computeFieldTotals,
  formatFieldCount,
  formatNumber,
  groupFieldsByCatchment,
  QUOTA_STATUS_STYLES,
  resolveFarmQuota,
  totalsQuotaStatusLevel,
  type FieldTotals,
  type QuotaStatusLevel,
} from '@/lib/field-domain'
import { cn } from '@/lib/utils'

const RUN_STATUS_LABELS: Record<OptimizeSimulationResponse['status'], string> =
  {
    OPTIMAL: 'optimal løsning',
    FEASIBLE: 'brugbar løsning, tidsgrænsen blev nået',
  }

const CATCHMENT_STATUS_LABELS: Record<QuotaStatusLevel, string> = {
  ok: 'overholder kvoten',
  near: 'tæt på kvoten',
  over: 'overskrider kvoten',
  uncalculated: 'ikke beregnet',
  noData: 'ingen kvote',
  partial: 'delvist beregnet',
}

const buildHeadline = (
  totals: FieldTotals,
  level: QuotaStatusLevel,
  isSimulationView: boolean,
  overCatchmentNote: string | null,
): string => {
  if (level === 'noData') {
    return 'Udledningen kan ikke opgøres endnu - ingen udledningsgrænse på markerne'
  }
  if (level === 'uncalculated') {
    return isSimulationView
      ? 'Udledningen kan ikke opgøres endnu - kør Optimér for at beregne markerne'
      : 'Udledningen kan ikke opgøres endnu - markerne er ikke beregnet'
  }
  const quotaKgn = totals.udledningskvoteMarkKgn
  const diff = Math.abs(quotaKgn - totals.nLoad)
  const relation = totals.nLoad > quotaKgn ? 'over' : 'under'
  const headline =
    `Udledning ${formatNumber(totals.nLoad)} af ${formatNumber(quotaKgn)} kg N ` +
    `pr. gennemsnitsår - ${formatNumber(diff)} kg N ${relation} grænsen`
  return overCatchmentNote && relation === 'under'
    ? `${headline} samlet, men ${overCatchmentNote}`
    : headline
}

const formatCatchmentAmount = (totals: FieldTotals): string => {
  if (totals.calculatedCount === 0) return 'ikke beregnet'
  if (totals.udledningskvoteMarkKgn === 0) {
    return `${formatNumber(totals.nLoad)} kg N, ingen kvote`
  }
  return `${formatNumber(totals.nLoad)} / ${formatNumber(totals.udledningskvoteMarkKgn)} kg N`
}

type MetricProps = {
  label: string
  value: string
}

const Metric = ({ label, value }: MetricProps) => (
  <div className="flex min-w-0 items-baseline gap-1.5">
    <dt className="text-xs text-muted-foreground">{label}</dt>
    <dd className="truncate text-sm font-medium text-foreground">{value}</dd>
  </div>
)

type CatchmentChipProps = {
  label: string
  totals: FieldTotals
}

const CatchmentChip = ({ label, totals }: CatchmentChipProps) => {
  const level = totalsQuotaStatusLevel(totals)
  const style = QUOTA_STATUS_STYLES[level]
  const amount = formatCatchmentAmount(totals)
  const uncalculatedNote =
    totals.calculatedCount > 0 && totals.uncalculatedCount > 0
      ? `, ${totals.uncalculatedCount} ikke beregnet`
      : ''

  return (
    <span
      title={`${label}: ${amount}${uncalculatedNote}`}
      className={cn(
        'inline-flex min-w-0 items-center gap-1.5 rounded-full border px-2 py-0.5 text-xs',
        style.surface,
        style.text,
      )}
    >
      <span
        aria-hidden="true"
        className={cn('size-1.5 shrink-0 rounded-full', style.dot)}
      />
      <span className="max-w-[10rem] truncate font-medium">{label}</span>
      <span className="shrink-0 tabular-nums">{amount}</span>
      <span className="sr-only">{CATCHMENT_STATUS_LABELS[level]}</span>
    </span>
  )
}

type FarmStatusStripProps = {
  farmId: string
  fields: FieldRecord[]
  isSimulationView: boolean
  lastRun: OptimizeSimulationResponse | null
}

export const FarmStatusStrip = ({
  farmId,
  fields,
  isSimulationView,
  lastRun,
}: FarmStatusStripProps) => {
  const [open, setOpen] = useState(false)
  const [openedForRun, setOpenedForRun] =
    useState<OptimizeSimulationResponse | null>(null)
  const detailsId = useId()
  if (lastRun && lastRun !== openedForRun) {
    setOpenedForRun(lastRun)
    setOpen(true)
  }
  const catchmentOptions = useCatchmentOptions(farmId, fields)

  const totals = useMemo(
    () => computeFieldTotals(fields, isSimulationView),
    [fields, isSimulationView],
  )
  const catchments = useMemo(() => {
    const totalsByKey = new Map(
      groupFieldsByCatchment(fields, isSimulationView).map((entry) => [
        catchmentKey(entry.kystvandId),
        entry.totals,
      ]),
    )
    return catchmentOptions.flatMap((option) => {
      const catchmentTotals = totalsByKey.get(catchmentKey(option.kystvandId))
      return catchmentTotals
        ? [
            {
              key: catchmentKey(option.kystvandId),
              label: option.label,
              totals: catchmentTotals,
            },
          ]
        : []
    })
  }, [fields, isSimulationView, catchmentOptions])

  const level = totalsQuotaStatusLevel(totals)
  const overCatchmentCount = catchments.filter(
    (catchment) => totalsQuotaStatusLevel(catchment.totals) === 'over',
  ).length
  const stripLevel: QuotaStatusLevel = overCatchmentCount > 0 ? 'over' : level
  const style = QUOTA_STATUS_STYLES[stripLevel]
  const quota = resolveFarmQuota(totals.udledningskvoteMarkKgn)
  const calculated = totals.calculatedCount > 0

  const overCatchmentNote =
    overCatchmentCount > 0 && catchments.length > 1
      ? `${overCatchmentCount} af ${catchments.length} oplande over grænsen`
      : null

  const notes: string[] = []
  if (level !== 'noData' && level !== 'uncalculated') notes.push(quota.basis)
  if (calculated && totals.uncalculatedCount > 0) {
    notes.push(`${totals.uncalculatedCount} ikke beregnet`)
  }
  if (overCatchmentNote && level === 'over') notes.push(overCatchmentNote)

  return (
    <section
      aria-label="Udledning mod kvote"
      className={cn('shrink-0 border-b', style.surface)}
    >
      <button
        type="button"
        aria-expanded={open}
        aria-controls={detailsId}
        onClick={() => setOpen((current) => !current)}
        className={cn(
          'flex w-full items-center gap-3 px-3 py-2 text-left text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring',
          style.text,
        )}
      >
        <QuotaStatusIndicator
          level={stripLevel}
          badge
          className="min-w-0 flex-1"
        >
          {buildHeadline(totals, level, isSimulationView, overCatchmentNote)}
          {notes.length > 0 ? (
            <span className="ml-1 text-xs opacity-80">
              ({notes.join(', ')})
            </span>
          ) : null}
        </QuotaStatusIndicator>
        <span className="hidden shrink-0 text-xs sm:inline">Nøgletal</span>
        <ChevronDown
          className={cn(
            'size-4 shrink-0 transition-transform',
            open && 'rotate-180',
          )}
          aria-hidden="true"
        />
      </button>

      <div
        id={detailsId}
        hidden={!open}
        className="space-y-2 border-t bg-background/70 px-3 py-2"
      >
        <dl className="flex flex-wrap items-center gap-x-5 gap-y-1">
          <Metric label="Marker" value={formatFieldCount(totals.fieldCount)} />
          <Metric label="Areal" value={`${formatNumber(totals.areaHa)} ha`} />
          <Metric
            label="DB2"
            value={
              calculated ? `${formatNumber(totals.db2)} kr` : 'Ikke beregnet'
            }
          />
          <Metric
            label="Udvaskning"
            value={
              calculated
                ? `${formatNumber(totals.leaching)} kg N`
                : 'Ikke beregnet'
            }
          />
          <Metric
            label="Foderenheder"
            value={
              calculated ? `${formatNumber(totals.fen)} FE` : 'Ikke beregnet'
            }
          />
        </dl>

        {catchments.length > 0 ? (
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs text-muted-foreground">
              Pr. kystvandopland
            </span>
            {catchments.map((catchment) => (
              <CatchmentChip
                key={catchment.key}
                label={catchment.label}
                totals={catchment.totals}
              />
            ))}
          </div>
        ) : null}

        {lastRun ? (
          <p className="text-xs text-muted-foreground">
            Sidste kørsel: {RUN_STATUS_LABELS[lastRun.status]} - DB2{' '}
            {formatNumber(lastRun.objectiveDb2)} kr, udledning{' '}
            {formatNumber(lastRun.totalNLoadKg)} kg N, udvaskning{' '}
            {formatNumber(lastRun.totalLeachingKg)} kg N,{' '}
            {formatNumber(lastRun.totalFen)} FE
          </p>
        ) : null}
      </div>
    </section>
  )
}
