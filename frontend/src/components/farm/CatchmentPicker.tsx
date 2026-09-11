import { useMemo } from 'react'
import { Check } from 'lucide-react'

import type { FieldRecord } from '@/api/types'
import {
  catchmentKey,
  useCatchmentOptions,
} from '@/components/farm/catchment-options'
import {
  CHOICE_IDLE_CLASS,
  CHOICE_SELECTED_CLASS,
} from '@/components/farm/choice-styles'
import {
  computeFieldTotals,
  formatFieldCount,
  formatNumber,
  groupFieldsByCatchment,
  type FieldTotals,
} from '@/lib/field-domain'
import { cn } from '@/lib/utils'

type CatchmentRowProps = {
  label: string
  totals: FieldTotals
  colorClass: string
  selected: boolean
  onSelect: () => void
}

const CatchmentRow = ({
  label,
  totals,
  colorClass,
  selected,
  onSelect,
}: CatchmentRowProps) => (
  <button
    type="button"
    aria-pressed={selected}
    onClick={onSelect}
    title={`${formatFieldCount(totals.fieldCount)} · ${formatNumber(totals.areaHa)} ha`}
    className={cn(
      'flex w-full min-w-0 items-center gap-2.5 rounded-md border px-2.5 py-1.5 text-left text-sm leading-snug transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none',
      selected ? cn(CHOICE_SELECTED_CLASS, 'font-semibold') : CHOICE_IDLE_CLASS,
    )}
  >
    <span
      aria-hidden="true"
      className={cn('size-2.5 shrink-0 rounded-full', colorClass)}
    />
    <span className="min-w-0 flex-1">{label}</span>
    {selected ? <Check className="size-4 shrink-0" aria-hidden="true" /> : null}
  </button>
)

type CatchmentPickerProps = {
  farmId: string
  fields: FieldRecord[]
  isSimulationView: boolean
  highlightedKey: string | null
  onHighlightedKeyChange: (key: string | null) => void
}

export const CatchmentPicker = ({
  farmId,
  fields,
  isSimulationView,
  highlightedKey,
  onHighlightedKeyChange,
}: CatchmentPickerProps) => {
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
        ? [
            {
              key,
              label: option.label,
              colorClass: option.colorClass,
              totals: catchmentTotals,
            },
          ]
        : []
    })
  }, [fields, isSimulationView, catchmentOptions])
  const farmTotals = useMemo(
    () => computeFieldTotals(fields, isSimulationView),
    [fields, isSimulationView],
  )

  if (catchments.length === 0) return null

  return (
    <section
      aria-label="Kystvandopland"
      className="w-72 shrink-0 rounded-lg border bg-card p-3"
    >
      <h2 className="mb-2 text-[11px] font-semibold tracking-[0.06em] text-muted-foreground uppercase">
        Kystvandopland
      </h2>
      <div
        role="group"
        aria-label="Vis hele bedriften eller et kystvandopland"
        className="space-y-0.5"
      >
        <CatchmentRow
          label="Hele bedriften"
          totals={farmTotals}
          colorClass="bg-foreground/40"
          selected={highlightedKey === null}
          onSelect={() => onHighlightedKeyChange(null)}
        />
        <div className="my-1.5 border-t" aria-hidden="true" />
        {catchments.map((catchment) => (
          <CatchmentRow
            key={catchment.key}
            label={catchment.label}
            totals={catchment.totals}
            colorClass={catchment.colorClass}
            selected={highlightedKey === catchment.key}
            onSelect={() => onHighlightedKeyChange(catchment.key)}
          />
        ))}
      </div>
    </section>
  )
}
