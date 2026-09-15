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

const ROW_CLASS =
  'flex w-full min-w-0 cursor-pointer gap-2 rounded-md border px-2.5 text-left transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none'

const describeTotals = (totals: FieldTotals) =>
  `${formatFieldCount(totals.fieldCount)} · ${formatNumber(totals.areaHa)} ha`

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
    title={describeTotals(totals)}
    className={cn(
      ROW_CLASS,
      'items-start py-[7px]',
      selected ? CHOICE_SELECTED_CLASS : CHOICE_IDLE_CLASS,
    )}
  >
    <span
      aria-hidden="true"
      className={cn('mt-[5px] size-[7px] shrink-0 rounded-[2px]', colorClass)}
    />
    <span className="min-w-0 flex-1 text-[13px] leading-4 font-medium text-pretty">
      {label}
    </span>
    {selected ? (
      <Check
        className="mt-px size-3.5 shrink-0 text-primary"
        strokeWidth={2.5}
        aria-hidden="true"
      />
    ) : null}
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
        catchmentKey(entry.catchmentId),
        entry.totals,
      ]),
    )
    return catchmentOptions.flatMap((option) => {
      const key = catchmentKey(option.catchmentId)
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

  const wholeFarmSelected = highlightedKey === null

  return (
    <section
      aria-label="Kystvandopland"
      className="flex w-58 shrink-0 flex-col rounded-2xl border bg-card px-3.5 pt-3.5 pb-3"
    >
      <h2 className="mb-2.5 text-[11px] font-semibold tracking-[0.07em] text-muted-foreground uppercase">
        Kystvandopland
      </h2>
      <div
        role="group"
        aria-label="Vis hele bedriften eller et kystvandopland"
        className="flex min-h-0 flex-1 flex-col"
      >
        <button
          type="button"
          aria-pressed={wholeFarmSelected}
          onClick={() => onHighlightedKeyChange(null)}
          title={describeTotals(farmTotals)}
          className={cn(
            ROW_CLASS,
            'items-center py-2',
            wholeFarmSelected ? CHOICE_SELECTED_CLASS : 'hover:bg-muted',
          )}
        >
          <span
            aria-hidden="true"
            className="size-[7px] shrink-0 rounded-full bg-muted-foreground"
          />
          <span className="flex-1 text-[13px] font-semibold">
            Hele bedriften
          </span>
          {wholeFarmSelected ? (
            <Check
              className="size-3.5 shrink-0 text-primary"
              strokeWidth={2.5}
              aria-hidden="true"
            />
          ) : null}
        </button>
        <div className="my-1.5 h-px bg-muted" aria-hidden="true" />
        <div className="relative min-h-24 flex-1">
          <div className="absolute inset-0 -mr-1.5 flex flex-col gap-0.5 overflow-y-auto pr-1.5">
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
        </div>
      </div>
    </section>
  )
}
