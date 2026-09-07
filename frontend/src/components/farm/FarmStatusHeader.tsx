import { useMemo } from 'react'

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

const PROGRESS_LEVELS: ReadonlySet<QuotaStatusLevel> = new Set([
  'ok',
  'near',
  'over',
  'partial',
])

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
    <dd className="truncate text-sm font-medium tabular-nums text-foreground">
      {value}
    </dd>
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

const FarmStatusHeaderSkeleton = () => (
  <section
    aria-label="Udledning mod kvote"
    aria-busy="true"
    className="shrink-0 rounded-lg border border-l-4 border-l-muted-foreground/30 bg-card p-4"
  >
    <span className="sr-only">Indlæser udledning</span>
    <div className="space-y-3" aria-hidden="true">
      <div className="h-4 w-2/3 rounded bg-muted motion-safe:animate-pulse" />
      <div className="h-1.5 w-full rounded-full bg-muted motion-safe:animate-pulse" />
      <div className="h-3 w-1/3 rounded bg-muted motion-safe:animate-pulse" />
    </div>
  </section>
)

type FarmStatusHeaderContentProps = {
  farmId: string
  fields: FieldRecord[]
  isSimulationView: boolean
  lastRun: OptimizeSimulationResponse | null
}

const FarmStatusHeaderContent = ({
  farmId,
  fields,
  isSimulationView,
  lastRun,
}: FarmStatusHeaderContentProps) => {
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
  const headerLevel: QuotaStatusLevel = overCatchmentCount > 0 ? 'over' : level
  const style = QUOTA_STATUS_STYLES[headerLevel]
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

  const showProgress = PROGRESS_LEVELS.has(level) && quota.quotaKgn > 0
  const progressPct = showProgress
    ? Math.min(100, (totals.nLoad / quota.quotaKgn) * 100)
    : 0
  const showDetails = catchments.length > 0 || lastRun !== null

  return (
    <section
      aria-label="Udledning mod kvote"
      className={cn(
        'shrink-0 space-y-3 rounded-lg border border-l-4 bg-card p-4',
        style.accent,
      )}
    >
      <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-2">
        <QuotaStatusIndicator
          level={headerLevel}
          badge
          className={cn(
            'min-w-0 flex-1 basis-80 text-sm font-medium',
            style.text,
          )}
        >
          {buildHeadline(totals, level, isSimulationView, overCatchmentNote)}
        </QuotaStatusIndicator>
        <dl className="flex shrink-0 flex-wrap items-center gap-x-5 gap-y-1">
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
      </div>

      {showProgress ? (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
          <div
            aria-hidden="true"
            className="h-1.5 min-w-40 flex-1 overflow-hidden rounded-full bg-muted"
          >
            <div
              className={cn('h-full rounded-full', style.dot)}
              style={{ width: `${progressPct}%` }}
            />
          </div>
          {notes.length > 0 ? (
            <p className="text-xs text-muted-foreground">{notes.join(', ')}</p>
          ) : null}
        </div>
      ) : notes.length > 0 ? (
        <p className="text-xs text-muted-foreground">{notes.join(', ')}</p>
      ) : null}

      {showDetails ? (
        <div className="space-y-2 text-xs">
          {catchments.length > 0 ? (
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-muted-foreground">Pr. kystvandopland</span>
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
            <p className="text-muted-foreground">
              Sidste kørsel: {RUN_STATUS_LABELS[lastRun.status]} - DB2{' '}
              {formatNumber(lastRun.objectiveDb2)} kr, udledning{' '}
              {formatNumber(lastRun.totalNLoadKg)} kg N, udvaskning{' '}
              {formatNumber(lastRun.totalLeachingKg)} kg N,{' '}
              {formatNumber(lastRun.totalFen)} FE
            </p>
          ) : null}
        </div>
      ) : null}
    </section>
  )
}

type FarmStatusHeaderProps = FarmStatusHeaderContentProps & {
  loading: boolean
}

export const FarmStatusHeader = ({
  loading,
  ...props
}: FarmStatusHeaderProps) =>
  loading ? (
    <FarmStatusHeaderSkeleton />
  ) : (
    <FarmStatusHeaderContent {...props} />
  )
