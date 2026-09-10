import { useMemo } from 'react'

import type { FieldRecord } from '@/api/types'
import {
  catchmentKey,
  useCatchmentOptions,
} from '@/components/farm/catchment-options'
import {
  describeUncalculatedCount,
  formatNumber,
  groupFieldsByCatchment,
  QUOTA_STATUS_STYLES,
  totalsQuotaStatusLevel,
  type FieldTotals,
  type QuotaStatusLevel,
} from '@/lib/field-domain'
import { cn } from '@/lib/utils'

const CATCHMENT_STATUS_LABELS: Record<QuotaStatusLevel, string> = {
  ok: 'overholder kvoten',
  near: 'tæt på kvoten',
  over: 'overskrider kvoten',
  uncalculated: 'ikke beregnet',
  noData: 'ingen kvote',
  partial: 'delvist beregnet',
}

const formatCatchmentAmount = (totals: FieldTotals): string => {
  if (totals.calculatedCount === 0) return 'ikke beregnet'
  if (totals.udledningskvoteMarkKgn === 0) {
    return `${formatNumber(totals.nLoad)} kg N, ingen kvote`
  }
  return `${formatNumber(totals.nLoad)} / ${formatNumber(totals.udledningskvoteMarkKgn)} kg N`
}

type CatchmentChipProps = {
  label: string
  totals: FieldTotals
  highlighted: boolean
  onToggle: () => void
}

const CatchmentChip = ({
  label,
  totals,
  highlighted,
  onToggle,
}: CatchmentChipProps) => {
  const level = totalsQuotaStatusLevel(totals)
  const style = QUOTA_STATUS_STYLES[level]
  const amount = formatCatchmentAmount(totals)
  const uncalculatedNote = describeUncalculatedCount(totals)

  return (
    <button
      type="button"
      aria-pressed={highlighted}
      onClick={onToggle}
      title={`${label}: ${amount}${uncalculatedNote ? `, ${uncalculatedNote}` : ''}`}
      className={cn(
        'inline-flex min-w-0 cursor-pointer items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs motion-safe:transition-shadow focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
        style.surface,
        style.text,
        highlighted && 'ring-2 ring-ring',
      )}
    >
      <span
        aria-hidden="true"
        className={cn('size-1.5 shrink-0 rounded-full', style.dot)}
      />
      <span className="max-w-40 truncate font-medium">{label}</span>
      <span className="shrink-0 font-semibold tabular-nums">{amount}</span>
      <span className="sr-only">
        {CATCHMENT_STATUS_LABELS[level]}
        {highlighted ? ', fremhævet på kortet' : ''}
      </span>
    </button>
  )
}

type CatchmentChipsProps = {
  farmId: string
  fields: FieldRecord[]
  isSimulationView: boolean
  highlightedKey: string | null
  onHighlightedKeyChange: (key: string | null) => void
}

export const CatchmentChips = ({
  farmId,
  fields,
  isSimulationView,
  highlightedKey,
  onHighlightedKeyChange,
}: CatchmentChipsProps) => {
  const catchmentOptions = useCatchmentOptions(farmId, fields)

  const catchments = useMemo(() => {
    const totalsByKey = new Map(
      groupFieldsByCatchment(fields, isSimulationView).map((entry) => [
        catchmentKey(entry.kystvandId),
        entry.totals,
      ]),
    )
    return catchmentOptions.flatMap((option) => {
      const key = catchmentKey(option.kystvandId)
      const catchmentTotals = totalsByKey.get(key)
      return catchmentTotals
        ? [{ key, label: option.label, totals: catchmentTotals }]
        : []
    })
  }, [fields, isSimulationView, catchmentOptions])

  if (catchments.length === 0) return null

  return (
    <div
      className="flex min-h-8 min-w-0 shrink-0 items-center gap-2 overflow-x-auto text-xs"
    >
      <span className="shrink-0 font-medium text-muted-foreground">
        Pr. kystvandopland
      </span>
      {catchments.map((catchment) => (
        <CatchmentChip
          key={catchment.key}
          label={catchment.label}
          totals={catchment.totals}
          highlighted={highlightedKey === catchment.key}
          onToggle={() =>
            onHighlightedKeyChange(
              highlightedKey === catchment.key ? null : catchment.key,
            )
          }
        />
      ))}
    </div>
  )
}
