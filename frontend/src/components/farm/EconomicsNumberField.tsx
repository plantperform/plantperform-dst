import { Minus, Plus } from 'lucide-react'
import { useId, useRef, useState } from 'react'

import { Button } from '@/components/ui/button'
import { FieldError } from '@/components/ui/field-error'
import {
  formatEconomicsNumber,
  formatYieldPct,
  parseEconomicsInput,
  parseYieldPctInput,
  stepYieldPct,
  YIELD_PCT_STEP,
  type EconomicsInput,
} from '@/lib/economics'
import { cn } from '@/lib/utils'

type EconomicsNumberFieldProps = {
  value: number
  label: string
  customised: boolean
  emptyValue?: number
  format?: (value: number) => string
  parse?: (text: string) => EconomicsInput
  onCommit: (value: number) => void
}

export const EconomicsNumberField = ({
  value,
  label,
  customised,
  emptyValue,
  format = formatEconomicsNumber,
  parse = parseEconomicsInput,
  onCommit,
}: EconomicsNumberFieldProps) => {
  const errorId = useId()
  const [draft, setDraft] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [shownValue, setShownValue] = useState(value)
  const cancelling = useRef(false)

  if (value !== shownValue) {
    setShownValue(value)
    setDraft(null)
    setError(null)
  }

  const commit = () => {
    if (draft === null) return
    const parsed =
      emptyValue !== undefined && draft.trim() === ''
        ? { value: emptyValue }
        : parse(draft)
    if ('error' in parsed) {
      setError(parsed.error)
      return
    }
    setDraft(null)
    if (parsed.value !== value) onCommit(parsed.value)
  }

  return (
    <span className="inline-flex flex-col items-end gap-0.5">
      <input
        inputMode="decimal"
        autoComplete="off"
        aria-label={label}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? errorId : undefined}
        className={cn(
          'h-7 w-[4.5rem] rounded-full border px-2.5 text-right text-[13px] text-foreground tabular-nums outline-none transition-colors hover:border-primary focus:border-primary focus:ring-[3px] focus:ring-primary/15 aria-invalid:border-destructive',
          customised ? 'border-amber-300 bg-amber-100' : 'bg-card',
        )}
        value={draft ?? format(value)}
        onFocus={(event) => event.currentTarget.select()}
        onChange={(event) => {
          setDraft(event.target.value)
          setError(null)
        }}
        onBlur={() => {
          if (cancelling.current) cancelling.current = false
          else commit()
        }}
        onKeyDown={(event) => {
          if (event.key === 'Enter') event.currentTarget.blur()
          if (event.key !== 'Escape') return
          cancelling.current = true
          setDraft(null)
          setError(null)
          event.currentTarget.blur()
        }}
      />
      <FieldError id={errorId} message={error} />
    </span>
  )
}

type YieldPctFieldProps = {
  pct: number
  cropName: string
  onCommit: (pct: number) => void
}

export const YieldPctField = ({
  pct,
  cropName,
  onCommit,
}: YieldPctFieldProps) => (
  <div className="flex items-start justify-end gap-1.5 leading-7">
    <Button
      type="button"
      variant="outline"
      size="icon"
      className="size-7 rounded-full"
      aria-label={`Sænk udbyttet for ${cropName} ${YIELD_PCT_STEP} %`}
      onClick={() => onCommit(stepYieldPct(pct, -1))}
    >
      <Minus className="size-3.5" aria-hidden="true" />
    </Button>
    <EconomicsNumberField
      value={pct}
      label={`Udbytte i forhold til normen for ${cropName} i %`}
      customised={pct !== 0}
      format={formatYieldPct}
      parse={parseYieldPctInput}
      onCommit={onCommit}
    />
    <span className="text-muted-foreground">%</span>
    <Button
      type="button"
      variant="outline"
      size="icon"
      className="size-7 rounded-full"
      aria-label={`Hæv udbyttet for ${cropName} ${YIELD_PCT_STEP} %`}
      onClick={() => onCommit(stepYieldPct(pct, 1))}
    >
      <Plus className="size-3.5" aria-hidden="true" />
    </Button>
  </div>
)
