import { ArrowUpDown, Lock, Sprout } from 'lucide-react'
import { useId, useMemo, useState, type ReactNode } from 'react'
import { mutate } from 'swr'

import {
  fetchSimulationFields,
  isQuotaValueRunning,
  quotaValueKey,
  simulationsKey,
  useQuotaValues,
} from '@/api/hooks'
import { createQuotaTradeSimulation, startQuotaValue } from '@/api/mutations'
import { useOptimizationRunActions } from '@/api/optimization-runs'
import type {
  FieldRecord,
  QuotaTradeRange,
  QuotaValueCurve,
  QuotaValueOutput,
  QuotaValueResult,
  Simulation,
} from '@/api/types'
import { CHOICE_SELECTED_CLASS } from '@/components/farm/choice-styles'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { LoadError } from '@/components/ui/load-error'
import { ProgressBar } from '@/components/ui/progress-bar'
import { Spinner } from '@/components/ui/spinner'
import { formatSigned, formatWholeNumber } from '@/lib/field-domain'
import {
  bestTradeAt,
  checkTradeRange,
  describeComputedAt,
  describeTrade,
  describeTradeInSentence,
  describeTradeRange,
  formatPrice,
  gainPoints,
  gainScale,
  listTrades,
  sellingLimit,
  parsePrice,
  priceThresholds,
  progressFraction,
  quotaYearRows,
  rivalTrades,
  tradableCatchments,
  tradeKind,
  tradeSimulationName,
  type GainPoint,
  type SolvedQuotaPoint,
  type TradableCatchment,
  type TradeKind,
  type TradeRangeCheck,
} from '@/lib/quota-trade'
import { cn } from '@/lib/utils'

const formatKr = (value: number) => `${formatWholeNumber(value)} kr/år`
const formatSignedKr = (value: number) =>
  `${formatSigned(value, formatWholeNumber)} kr/år`

const describeGainRange = (point: GainPoint) =>
  point.gainUpperBound === null ||
  Math.round(point.gainUpperBound) === Math.round(point.gain)
    ? formatSignedKr(point.gain)
    : `${formatSigned(point.gain, formatWholeNumber)} til ${formatSignedKr(point.gainUpperBound)}`

const STATUS_LABELS: Record<string, string> = {
  OPTIMAL: 'Løsningen er bevist tæt på den bedst mulige.',
  FEASIBLE: 'Tidsgrænsen blev nået, så det er den bedste fundne løsning.',
}

const KIND_CHIP: Record<TradeKind, string> = {
  buy: 'bg-success/15 text-success-strong',
  sell: 'bg-warning/15 text-warning-strong',
  none: 'bg-muted text-muted-foreground',
}

const KIND_BAR: Record<TradeKind, string> = {
  buy: 'bg-success',
  sell: 'bg-warning',
  none: 'bg-muted-foreground/40',
}

const KIND_BAND: Record<TradeKind, string> = {
  buy: 'border-success/60 bg-success/15',
  sell: 'border-warning/60 bg-warning/15',
  none: 'border-muted-foreground/40 bg-muted',
}

const GAIN_TEXT = (gain: number) =>
  gain > 0
    ? 'text-success-strong'
    : gain < 0
      ? 'text-destructive'
      : 'text-muted-foreground'

type QuotaTradePanelProps = {
  farmId: string
  simulation: Simulation
  fields: FieldRecord[]
  catchmentLabel: (catchmentId: number | null) => string
  // Shows a simulation created from a trade ("Opret som simulering").
  onOpenSimulation: (simulationId: string) => void
  onError: (message: string | null) => void
}

// Where "Opret som simulering" creates a trade, and what to do afterwards.
type TradeSimulationTarget = {
  farmId: string
  simulationId: string
  // The original simulation's name, which the new one starts with.
  simulationName: string
  // False when the simulation changed after the curve was computed.
  available: boolean
  onOpenSimulation: (simulationId: string) => void
  onError: (message: string | null) => void
}

// A curve is computed from the simulation's latest completed yearly run.
const yearlyRunIsCurrent = (simulation: Simulation) =>
  simulation.result.status === 'completed' &&
  simulation.result.kind === 'yearly' &&
  simulation.result.resultRevision === simulation.revision

type RangeInput = {
  mode: 'default' | 'custom'
  minKg: string
  maxKg: string
  stepKg: string
}

const formatKgInput = (value: number) => String(value).replace('.', ',')

const rangeInputFrom = (range: QuotaTradeRange | null): RangeInput =>
  range
    ? {
        mode: 'custom',
        minKg: formatKgInput(range.minKg),
        maxKg: formatKgInput(range.maxKg),
        stepKg: formatKgInput(range.stepKg),
      }
    : { mode: 'default', minKg: '', maxKg: '', stepKg: '' }

const SuffixField = ({
  id,
  label,
  suffix,
  value,
  onChange,
  invalid = false,
  disabled = false,
  describedBy,
  inputClassName,
}: {
  id: string
  label: string
  suffix: string
  value: string
  onChange: (value: string) => void
  invalid?: boolean
  disabled?: boolean
  describedBy?: string
  inputClassName?: string
}) => (
  <div className="flex flex-col gap-1.5">
    <Label htmlFor={id}>{label}</Label>
    <div
      className={cn(
        'flex h-10 items-center rounded-md border bg-card pr-3 focus-within:ring-2 focus-within:ring-ring/40',
        invalid ? 'border-destructive' : '',
        disabled ? 'opacity-60' : '',
      )}
    >
      <Input
        id={id}
        inputMode="decimal"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        disabled={disabled}
        className={cn(
          'h-9 border-0 bg-transparent text-right text-base font-semibold tabular-nums shadow-none focus-visible:ring-0',
          inputClassName,
        )}
        aria-invalid={invalid}
        aria-describedby={describedBy}
      />
      <span className="text-sm whitespace-nowrap text-muted-foreground">
        {suffix}
      </span>
    </div>
  </div>
)

const INTERVAL_OPTIONS: { value: RangeInput['mode']; label: string }[] = [
  { value: 'default', label: 'Standard' },
  { value: 'custom', label: 'Eget' },
]

const IntervalToggle = ({
  value,
  onChange,
  disabled,
}: {
  value: RangeInput['mode']
  onChange: (value: RangeInput['mode']) => void
  disabled: boolean
}) => {
  const id = useId()
  return (
    <div className="flex flex-col gap-1.5">
      <span id={id} className="text-sm leading-none font-medium">
        Interval for handel
      </span>
      <div
        role="radiogroup"
        aria-labelledby={id}
        className={cn(
          'flex h-10 items-center gap-1 rounded-md border bg-muted/60 p-1',
          disabled ? 'opacity-60' : '',
        )}
      >
        {INTERVAL_OPTIONS.map((option) => (
          <label
            key={option.value}
            className={cn(
              'flex h-full cursor-pointer items-center rounded px-4 text-sm transition-colors has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring/40',
              option.value === value
                ? 'bg-card font-semibold text-primary shadow-xs'
                : 'text-muted-foreground hover:text-foreground',
              disabled ? 'cursor-not-allowed' : '',
            )}
          >
            <input
              type="radio"
              name={id}
              value={option.value}
              checked={option.value === value}
              onChange={() => onChange(option.value)}
              disabled={disabled}
              className="sr-only"
            />
            {option.label}
          </label>
        ))}
      </div>
    </div>
  )
}

const QuotaRangeFields = ({
  id,
  value,
  check,
  disabled,
  onChange,
}: {
  id: string
  value: RangeInput
  check: TradeRangeCheck | null
  disabled: boolean
  onChange: (value: RangeInput) => void
}) => {
  const invalid = check?.kind === 'invalid'
  const field = (
    key: 'minKg' | 'maxKg' | 'stepKg',
    label: string,
    suffix: string,
  ) => (
    <SuffixField
      id={`${id}-${key}`}
      label={label}
      suffix={suffix}
      value={value[key]}
      onChange={(entered) => onChange({ ...value, [key]: entered })}
      invalid={invalid}
      disabled={disabled}
      describedBy={`${id}-help`}
      inputClassName="w-14"
    />
  )
  return (
    <div className="flex flex-wrap items-end gap-x-3 gap-y-3">
      {field('minKg', 'Fra', 'kg N/år')}
      {field('maxKg', 'Til', 'kg N/år')}
      {field('stepKg', 'Afstand', 'kg')}
    </div>
  )
}

const QuotaRangeHelp = ({
  id,
  check,
}: {
  id: string
  check: TradeRangeCheck
}) => (
  <div id={`${id}-help`} className="flex flex-col gap-2">
    {check?.kind === 'invalid' ? (
      <p className="text-xs text-destructive">{check.message}</p>
    ) : null}
    {check?.kind === 'ok' ? (
      <>
        <p className="text-xs text-muted-foreground">
          {check.trades.length} handler beregnes ud over ingen handel
        </p>
        <ul className="flex flex-wrap gap-1.5">
          {[...check.trades, 0]
            .sort((a, b) => a - b)
            .map((trade) => (
              <li
                key={trade}
                className={cn(
                  'rounded-full px-2.5 py-0.5 text-xs font-semibold tabular-nums',
                  KIND_CHIP[tradeKind(trade)],
                )}
              >
                {formatSigned(trade, formatWholeNumber)}
              </li>
            ))}
        </ul>
        <p className="text-xs text-muted-foreground">
          Køb ud over det, bedriften kan udnytte, og salg af mere end kvoten
          springes over.
        </p>
      </>
    ) : null}
  </div>
)

const CatchmentStatus = ({
  result,
}: {
  result: QuotaValueResult | undefined
}) => {
  if (!result) return null
  if (result.status === 'queued')
    return <span className="text-xs text-muted-foreground">I kø</span>
  if (result.status === 'in_progress')
    return (
      <span className="flex items-center gap-1 text-xs text-primary">
        <Spinner className="size-3" />
        Beregner
      </span>
    )
  if (result.status === 'failed')
    return <span className="text-xs text-destructive">Fejlede</span>
  if (result.outdated)
    return <span className="text-xs text-warning-strong">Forældet</span>
  return result.finishedAt ? (
    <span className="text-xs text-muted-foreground">
      {describeComputedAt(result.finishedAt)}
    </span>
  ) : null
}

const fieldCountText = (count: number) =>
  count === 1 ? '1 kvotegivende mark' : `${count} kvotegivende marker`

const CatchmentCard = ({
  catchment,
  name,
  result,
  price,
  selected,
  onSelect,
}: {
  catchment: TradableCatchment
  name: string
  result: QuotaValueResult | undefined
  price: number | null
  selected: boolean
  onSelect: () => void
}) => {
  const best =
    result?.status === 'completed' && result.output && price !== null
      ? bestTradeAt(result.output, price)
      : null
  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={onSelect}
      className={cn(
        'flex w-full flex-col gap-1 rounded-lg border bg-card px-3 py-2.5 text-left text-sm transition-colors',
        selected ? CHOICE_SELECTED_CLASS : 'hover:bg-muted/40',
      )}
    >
      <span className="flex items-baseline justify-between gap-2">
        <span className="font-semibold">{name}</span>
        {catchment.lockedCount === catchment.fieldCount ? null : (
          <CatchmentStatus result={result} />
        )}
      </span>
      <span className="text-xs tabular-nums text-muted-foreground">
        Kvote {formatWholeNumber(catchment.quotaKgN)} kg N ·{' '}
        {fieldCountText(catchment.fieldCount)}
      </span>
      {best ? (
        <span className="flex items-center justify-between gap-2">
          <span
            className={cn(
              'rounded-full px-2 py-0.5 text-xs font-semibold',
              KIND_CHIP[tradeKind(best.tradeKg)],
            )}
          >
            {describeTrade(best.tradeKg)}
          </span>
          {best.tradeKg !== 0 ? (
            <span
              className={cn('font-semibold tabular-nums', GAIN_TEXT(best.gain))}
            >
              {formatSignedKr(best.gain)}
            </span>
          ) : null}
        </span>
      ) : catchment.lockedCount === catchment.fieldCount ? (
        <span className="flex items-center gap-1 text-xs text-warning-strong">
          <Lock aria-hidden className="size-3" />
          Alle marker er låst
        </span>
      ) : !result ? (
        <span className="text-xs text-muted-foreground">
          Ikke beregnet endnu
        </span>
      ) : null}
    </button>
  )
}

export const QuotaTradePanel = ({
  farmId,
  simulation,
  fields,
  catchmentLabel,
  onOpenSimulation,
  onError,
}: QuotaTradePanelProps) => {
  const priceId = useId()
  const {
    data: results,
    error,
    isLoading,
    mutate: reload,
  } = useQuotaValues(farmId, simulation.id)
  const catchments = useMemo(() => tradableCatchments(fields), [fields])
  const [chosenCatchmentId, setChosenCatchmentId] = useState<number | null>(
    null,
  )
  const [priceInput, setPriceInput] = useState<string | null>(null)
  const [rangeInput, setRangeInput] = useState<RangeInput | null>(null)
  const [starting, setStarting] = useState(false)
  const [startError, setStartError] = useState<string | null>(null)

  const catchment =
    catchments.find((option) => option.catchmentId === chosenCatchmentId) ??
    catchments[0]
  const resultFor = (catchmentId: number) =>
    results?.find((result) => result.catchmentId === catchmentId)
  const result = catchment ? resultFor(catchment.catchmentId) : undefined

  const latest = (results ?? []).reduce<QuotaValueResult | null>(
    (newest, other) =>
      newest === null || (other.queuedAt ?? '') > (newest.queuedAt ?? '')
        ? other
        : newest,
    null,
  )
  const storedPrice = latest?.priceKrPerKg ?? null
  const shownPriceInput =
    priceInput ??
    (storedPrice === null ? '' : String(storedPrice).replace('.', ','))
  const price = parsePrice(shownPriceInput)
  const shownRange = rangeInput ?? rangeInputFrom(result?.tradeRange ?? null)
  const rangeEmpty =
    shownRange.minKg.trim() === '' &&
    shownRange.maxKg.trim() === '' &&
    shownRange.stepKg.trim() === ''
  const rangeCheck =
    shownRange.mode === 'custom' && !rangeEmpty
      ? checkTradeRange(shownRange.minKg, shownRange.maxKg, shownRange.stepKg)
      : null
  const rangeReady = shownRange.mode === 'default' || rangeCheck?.kind === 'ok'
  const running = result ? isQuotaValueRunning(result) : false
  const canCompute = yearlyRunIsCurrent(simulation)
  const several = catchments.length > 1
  const canStart =
    canCompute && price !== null && rangeReady && !running && !starting

  const start = async () => {
    if (price === null || !catchment) return
    setStarting(true)
    setStartError(null)
    try {
      const started = await startQuotaValue(farmId, simulation.id, {
        expectedRevision: simulation.revision,
        runId: crypto.randomUUID(),
        catchmentId: catchment.catchmentId,
        priceKrPerKg: price,
        tradeRange: rangeCheck?.kind === 'ok' ? rangeCheck.range : null,
      })
      await mutate(
        quotaValueKey(farmId, simulation.id),
        (current: QuotaValueResult[] | undefined) => [
          ...(current ?? []).filter(
            (other) => other.catchmentId !== started.catchmentId,
          ),
          started,
        ],
        { revalidate: false },
      )
    } catch (caught) {
      setStartError(
        caught instanceof Error
          ? caught.message
          : 'Beregningen kunne ikke startes.',
      )
    } finally {
      setStarting(false)
    }
  }

  if (isLoading) {
    return (
      <p
        role="status"
        className="flex items-center gap-2 p-4 text-sm text-muted-foreground"
      >
        <Spinner />
        Henter kvotehandel…
      </p>
    )
  }
  if (error) {
    return (
      <LoadError
        message="Kunne ikke hente kvotehandel."
        onRetry={() => void reload()}
        retrying={false}
      />
    )
  }

  const computeButton = (
    <Button onClick={() => void start()} disabled={!canStart}>
      {starting ? <Spinner /> : null}
      {result?.status === 'completed' || result?.status === 'failed'
        ? 'Beregn igen'
        : 'Beregn kvoteværdi'}
    </Button>
  )

  const priceInvalid = shownPriceInput !== '' && price === null

  const custom = shownRange.mode === 'custom'
  const form = (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-end gap-x-4 gap-y-3">
        <SuffixField
          id={priceId}
          label="Kvotepris"
          suffix="kr/kg N pr. år"
          value={shownPriceInput}
          onChange={setPriceInput}
          invalid={priceInvalid}
          describedBy={`${priceId}-help`}
          inputClassName="w-24"
        />
        <IntervalToggle
          value={shownRange.mode}
          onChange={(mode) => setRangeInput({ ...shownRange, mode })}
          disabled={running || starting}
        />
        <div className="grid">
          <div
            className={cn('col-start-1 row-start-1', custom ? '' : 'invisible')}
          >
            <QuotaRangeFields
              id={`${priceId}-range`}
              value={shownRange}
              check={rangeCheck}
              disabled={running || starting || !custom}
              onChange={setRangeInput}
            />
          </div>
          <div
            className={cn(
              'col-start-1 row-start-1 flex flex-col justify-end gap-1.5',
              custom ? 'invisible' : '',
            )}
          >
            <span className="text-sm leading-none font-medium">Handler</span>
            <span className="flex h-10 items-center rounded-md border border-dashed px-3 text-sm text-muted-foreground">
              Op til 25 % af kvoten til hver side
            </span>
          </div>
        </div>
        {computeButton}
      </div>
      <div className="flex flex-wrap gap-x-1 text-xs">
        <p
          id={`${priceId}-help`}
          className={
            priceInvalid ? 'text-destructive' : 'text-muted-foreground'
          }
        >
          {priceInvalid
            ? 'Skriv prisen som et tal, fx 35 eller 37,5.'
            : 'Den pris, du kan købe eller sælge kvote til.'}
        </p>
        {custom && rangeCheck === null ? (
          <p id={`${priceId}-range-help`} className="text-muted-foreground">
            Negative tal er salg. Fx fra -100 til 150 med 50 kg imellem.
          </p>
        ) : null}
      </div>
      {custom && rangeCheck !== null ? (
        <QuotaRangeHelp id={`${priceId}-range`} check={rangeCheck} />
      ) : null}
      {startError ? (
        <p className="text-sm text-destructive">{startError}</p>
      ) : null}
    </div>
  )

  const allLocked =
    catchment !== undefined && catchment.lockedCount === catchment.fieldCount

  const facts = catchment
    ? [
        {
          icon: Sprout,
          title: 'Kun oplandets marker',
          text:
            catchment.lockedCount > 0
              ? `${catchment.fieldCount - catchment.lockedCount} af de ${fieldCountText(catchment.fieldCount)} regnes igennem igen. ${catchment.lockedCount} er låst.`
              : `De ${fieldCountText(catchment.fieldCount)} regnes igennem igen.`,
        },
        {
          icon: ArrowUpDown,
          title: 'Mere og mindre kvote',
          text: 'Hver handel er en ny optimering af planen.',
        },
        {
          icon: Lock,
          title: 'Resten står fast',
          text: 'Resten af bedriften beholder sin plan, og loftet under Grænser gælder ikke.',
        },
      ]
    : []

  return (
    <section
      aria-label="Kvotehandel"
      className="flex min-h-[28rem] flex-1 flex-col overflow-y-auto rounded-lg border bg-card"
    >
      <header className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 border-b px-4 py-2.5">
        <h2 className="font-display text-lg">Kvotehandel</h2>
        <p className="text-sm text-muted-foreground">
          Hvad er det værd at købe eller sælge kvote i hvert kystvandopland?
          Resten af bedriften beholder sin plan.
        </p>
      </header>
      {!canCompute ? (
        <p className="border-b bg-muted/40 px-4 py-2.5 text-sm text-muted-foreground">
          Kvoteværdien beregnes ud fra en optimering med loft hvert år. Optimer
          simuleringen med Loft hvert år, og kom tilbage hertil.
        </p>
      ) : null}
      {catchments.length === 0 ? (
        <p className="p-5 text-sm text-muted-foreground">
          Simuleringen har ingen kystvandoplande med kvotegivende marker, så der
          er ingen kvote at handle med.
        </p>
      ) : (
        <div className="grid flex-1 md:grid-cols-[18rem_minmax(0,1fr)]">
          <aside className="flex flex-col gap-2 border-b p-3 md:border-r md:border-b-0">
            <h3 className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
              Kystvandoplande
            </h3>
            {catchments.map((option) => (
              <CatchmentCard
                key={option.catchmentId}
                catchment={option}
                name={catchmentLabel(option.catchmentId)}
                result={resultFor(option.catchmentId)}
                price={price}
                selected={option.catchmentId === catchment?.catchmentId}
                onSelect={() => setChosenCatchmentId(option.catchmentId)}
              />
            ))}
            <p className="mt-1 text-xs text-muted-foreground">
              Hvert opland beregnes for sig, et ad gangen. Ændrer du prisen,
              opdateres svaret uden en ny beregning.
            </p>
          </aside>
          {catchment && (!result || allLocked) ? (
            <div className="flex min-w-0 flex-col items-center bg-muted/30 p-5 md:p-8">
              <div className="flex w-full max-w-3xl flex-col gap-6 rounded-xl border bg-card p-6 shadow-sm">
                <div className="flex flex-col gap-2">
                  <h3 className="font-display text-2xl">
                    {catchmentLabel(catchment.catchmentId)}
                  </h3>
                  <div className="flex flex-wrap gap-2">
                    <span className="rounded-full bg-secondary px-3 py-1 text-xs font-medium text-secondary-foreground tabular-nums">
                      Kvote {formatWholeNumber(catchment.quotaKgN)} kg N
                    </span>
                    <span className="rounded-full bg-secondary px-3 py-1 text-xs font-medium text-secondary-foreground tabular-nums">
                      {fieldCountText(catchment.fieldCount)}
                    </span>
                  </div>
                </div>
                {allLocked ? (
                  <div className="flex gap-3 rounded-lg bg-warning/10 p-4 text-sm text-warning-strong">
                    <Lock aria-hidden className="mt-0.5 size-4 shrink-0" />
                    <div className="flex flex-col gap-1">
                      <span className="font-semibold">
                        Alle {fieldCountText(catchment.fieldCount)} er låst
                      </span>
                      <span>
                        Så kan planen ikke ændres, og der er ingen kvoteværdi at
                        beregne. Lås nogle af markerne op under Regler, og kom
                        tilbage hertil.
                      </span>
                    </div>
                  </div>
                ) : (
                  <ul className="grid gap-3 sm:grid-cols-3">
                    {facts.map(({ icon: Icon, title, text }) => (
                      <li
                        key={title}
                        className="flex gap-3 rounded-lg bg-muted/50 p-3 text-sm"
                      >
                        <Icon
                          aria-hidden
                          className="mt-0.5 size-4 shrink-0 text-primary"
                        />
                        <span className="flex flex-col gap-0.5">
                          <span className="font-medium">{title}</span>
                          <span className="text-xs text-muted-foreground">
                            {text}
                          </span>
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
                {allLocked ? null : <div className="border-t pt-5">{form}</div>}
              </div>
            </div>
          ) : catchment && result && isQuotaValueRunning(result) ? (
            <div className="flex min-w-0 flex-col items-center bg-muted/30 p-5 md:p-8">
              <QuotaTradeRunning
                result={result}
                name={catchmentLabel(catchment.catchmentId)}
              />
            </div>
          ) : catchment ? (
            <div className="@container flex min-w-0 flex-col gap-3 p-4">
              <div className="flex min-w-0 flex-wrap items-baseline gap-x-3 gap-y-0.5">
                <h3 className="font-display text-lg">
                  {catchmentLabel(catchment.catchmentId)}
                </h3>
                <p className="text-xs tabular-nums text-muted-foreground">
                  Kvote {formatWholeNumber(catchment.quotaKgN)} kg N ·{' '}
                  {fieldCountText(catchment.fieldCount)} · regnes ud fra kvoten,
                  loftet under Grænser gælder ikke
                </p>
              </div>
              <div className="w-fit max-w-full rounded-lg border bg-muted/30 p-3">
                {form}
              </div>
              <QuotaTradeStatus result={result} canCompute={canCompute} />
              {result?.status === 'completed' &&
              result.output &&
              price !== null ? (
                <QuotaCurveView
                  key={catchment.catchmentId}
                  curve={result.output.curve}
                  output={result.output}
                  price={price}
                  tradeRange={result.tradeRange}
                  target={{
                    farmId,
                    simulationId: simulation.id,
                    simulationName: simulation.name,
                    available: !result.outdated,
                    onOpenSimulation,
                    onError,
                  }}
                  catchmentName={
                    several ? catchmentLabel(catchment.catchmentId) : null
                  }
                />
              ) : null}
              {result?.status === 'completed' && price === null ? (
                <p className="text-sm text-muted-foreground">
                  Skriv en kvotepris øverst for at se, hvad det betaler sig at
                  handle.
                </p>
              ) : null}
            </div>
          ) : null}
        </div>
      )}
    </section>
  )
}

const QuotaTradeRunning = ({
  result,
  name,
}: {
  result: QuotaValueResult
  name: string
}) => {
  const steps = result.progress ?? []
  const started = result.status !== 'queued' && steps.length > 0
  return (
    <div
      role="status"
      className="flex w-full max-w-3xl flex-col gap-4 rounded-xl border bg-card p-6 shadow-sm"
    >
      <div className="flex flex-col gap-1">
        <h3 className="font-display text-2xl">{name}</h3>
        <p className="text-sm text-muted-foreground">
          {result.status === 'queued'
            ? 'Venter på, at det forrige opland bliver færdigt …'
            : 'Beregner kvoteværdien …'}
        </p>
      </div>
      <ProgressBar
        className="h-2"
        valuePct={
          started
            ? Math.max(4, Math.round(progressFraction(steps) * 100))
            : undefined
        }
      />
    </div>
  )
}

const QuotaTradeStatus = ({
  result,
  canCompute,
}: {
  result: QuotaValueResult | undefined
  canCompute: boolean
}) => {
  if (result?.status === 'failed') {
    return (
      <p className="text-sm text-destructive">
        {result.error?.message ?? 'Beregningen fejlede.'}
      </p>
    )
  }
  if (result?.status === 'completed' && result.outdated) {
    return (
      <p className="rounded-lg bg-warning/10 px-3 py-2 text-sm text-warning-strong">
        Simuleringen eller optimeringen er ændret siden beregningen.{' '}
        {canCompute ? 'Beregn igen for at se den aktuelle værdi.' : ''}
      </p>
    )
  }
  return null
}

const AnswerCell = ({
  label,
  children,
}: {
  label: string
  children: ReactNode
}) => (
  <div className="flex flex-col gap-1 border-t border-l p-3">
    <span className="text-xs text-muted-foreground">{label}</span>
    {children}
  </div>
)

const QuotaAnswer = ({
  curve,
  best,
  rivals,
  price,
}: {
  curve: QuotaValueCurve
  best: GainPoint
  rivals: GainPoint[]
  price: number
}) => {
  const { buyBelow, sellAbove } = useMemo(() => priceThresholds(curve), [curve])
  const limit = sellingLimit(curve)
  return (
    <div className="overflow-hidden rounded-lg border">
      <div className="-mt-px -ml-px grid @2xl:grid-cols-[minmax(0,1.5fr)_repeat(3,minmax(0,1fr))] @5xl:grid-cols-2">
        <div
          className={cn(
            'flex flex-col gap-1 border-t border-l p-3',
            best.tradeKg === 0
              ? 'bg-muted/40'
              : KIND_CHIP[tradeKind(best.tradeKg)],
          )}
        >
          <span className="text-xs opacity-80">
            Bedst ved {formatPrice(price)} kr/kg N
          </span>
          <span className="font-display text-xl text-foreground">
            {describeTrade(best.tradeKg)}
          </span>
          {best.tradeKg !== 0 ? (
            <span className="text-sm">
              <span
                className={cn(
                  'font-semibold tabular-nums',
                  GAIN_TEXT(best.gain),
                )}
              >
                {formatSignedKr(best.gain)}
              </span>{' '}
              <span className="text-muted-foreground">
                i forhold til ingen handel
              </span>
            </span>
          ) : null}
          {rivals.length > 0 ? (
            <span className="text-xs text-muted-foreground">
              Inden for optimeringens usikkerhed kan{' '}
              {listTrades(rivals.map((rival) => rival.tradeKg))} også være
              bedst.
            </span>
          ) : null}
        </div>
        <AnswerCell label="Køb betaler sig">
          {buyBelow ? (
            <>
              <span className="font-semibold tabular-nums">
                under {formatPrice(buyBelow.priceKrPerKg)} kr
              </span>
              <span className="text-xs text-muted-foreground">
                pr. kg N, {describeTradeInSentence(buyBelow.tradeKg)}
              </span>
            </>
          ) : (
            <span className="text-sm text-muted-foreground">
              Ved ingen af de beregnede priser
            </span>
          )}
        </AnswerCell>
        <AnswerCell label="Salg betaler sig">
          {sellAbove ? (
            <>
              <span className="font-semibold tabular-nums">
                over {formatPrice(sellAbove.priceKrPerKg)} kr
              </span>
              <span className="text-xs text-muted-foreground">
                pr. kg N, {describeTradeInSentence(sellAbove.tradeKg)}
              </span>
            </>
          ) : (
            <span className="text-sm text-muted-foreground">
              Planen kan ikke klare sig med mindre kvote
            </span>
          )}
        </AnswerCell>
        <AnswerCell label="Grænser">
          <span className="text-sm leading-relaxed">
            Højst{' '}
            <b className="tabular-nums">
              {formatWholeNumber(curve.unconstrainedTradeKg)} kg
            </b>{' '}
            kan udnyttes
            <br />
            {limit?.kind === 'proven' && limit.lowestKg === 0
              ? 'Der kan ikke sælges'
              : null}
            {limit?.kind === 'proven' && limit.lowestKg !== 0 ? (
              <>
                Højst{' '}
                <b className="tabular-nums">
                  {formatWholeNumber(Math.abs(limit.lowestKg))} kg
                </b>{' '}
                kan sælges
              </>
            ) : null}
            {limit?.kind === 'undetermined'
              ? `Salg over ${formatWholeNumber(Math.abs(limit.lowestKg))} kg kunne ikke afgøres`
              : null}
          </span>
        </AnswerCell>
      </div>
    </div>
  )
}

const MANY_POINTS = 12

const barLabel = (tradeKg: number, many: boolean) =>
  many
    ? formatSigned(tradeKg, formatWholeNumber)
    : tradeKg > 0
      ? `Køb ${formatWholeNumber(tradeKg)}`
      : tradeKg < 0
        ? `Salg ${formatWholeNumber(-tradeKg)}`
        : 'Ingen'

const QuotaGainBars = ({
  points,
  bestKg,
  selectedKg,
  onSelect,
}: {
  points: GainPoint[]
  bestKg: number
  selectedKg: number
  onSelect: (tradeKg: number) => void
}) => {
  const scale = gainScale(points)
  const span = scale.max - scale.min
  const at = (value: number) => ((value - scale.min) / span) * 100
  const many = points.length > MANY_POINTS
  return (
    <div className="flex flex-col gap-1">
      <div className="relative mt-4 ml-14 h-44">
        {scale.ticks.map((tick) => (
          <div
            key={tick}
            className={cn(
              'absolute inset-x-0 border-t',
              tick === 0 ? 'border-foreground/60' : 'border-border/70',
            )}
            style={{ bottom: `${at(tick)}%` }}
          >
            <span className="absolute -left-14 w-12 -translate-y-1/2 text-right text-[11px] tabular-nums text-muted-foreground">
              {formatWholeNumber(tick)}
            </span>
          </div>
        ))}
        <div className="absolute inset-0 flex">
          {points.map((point) => {
            const kind = tradeKind(point.tradeKg)
            const top = Math.max(point.gain, point.gainUpperBound ?? point.gain)
            const selected = point.tradeKg === selectedKg
            const best = point.tradeKg === bestKg
            return (
              <button
                key={point.tradeKg}
                type="button"
                aria-pressed={selected}
                aria-label={`${describeTrade(point.tradeKg)}: ${describeGainRange(point)}`}
                onClick={() => onSelect(point.tradeKg)}
                className="group relative flex-1 rounded-sm hover:bg-muted/40 focus-visible:bg-muted/40 focus-visible:outline-none"
              >
                {point.gainUpperBound !== null &&
                point.gainUpperBound > point.gain ? (
                  <span
                    className={cn(
                      'absolute left-1/2 w-[56%] max-w-14 -translate-x-1/2 border border-dashed',
                      KIND_BAND[kind],
                    )}
                    style={{
                      bottom: `${at(point.gain)}%`,
                      height: `${at(point.gainUpperBound) - at(point.gain)}%`,
                    }}
                  />
                ) : null}
                <span
                  className={cn(
                    'absolute left-1/2 w-[56%] max-w-14 -translate-x-1/2',
                    KIND_BAR[kind],
                    selected ? 'ring-2 ring-foreground ring-offset-1' : '',
                  )}
                  style={{
                    bottom: `${at(Math.min(0, point.gain))}%`,
                    height: `max(2px, ${Math.abs(at(point.gain) - at(0))}%)`,
                  }}
                />
                {!many || best || selected ? (
                  <span
                    className={cn(
                      'absolute left-1/2 -translate-x-1/2 pb-1 text-[11px] whitespace-nowrap tabular-nums',
                      best ? 'font-bold' : '',
                    )}
                    style={{ bottom: `${at(Math.max(0, top))}%` }}
                  >
                    {formatSigned(point.gain, formatWholeNumber)}
                  </span>
                ) : null}
              </button>
            )
          })}
        </div>
      </div>
      <div className="ml-14 flex">
        {points.map((point) => (
          <span
            key={point.tradeKg}
            className={cn(
              'flex-1 text-center text-xs tabular-nums',
              point.tradeKg === selectedKg ? 'font-semibold' : '',
            )}
          >
            {barLabel(point.tradeKg, many)}
          </span>
        ))}
      </div>
      <span className="ml-14 text-center text-[11px] text-muted-foreground">
        Handel, kg N pr. år
      </span>
    </div>
  )
}

const QuotaCurveView = ({
  curve,
  output,
  price,
  tradeRange,
  target,
  catchmentName,
}: {
  curve: QuotaValueCurve
  output: QuotaValueOutput
  price: number
  tradeRange: QuotaTradeRange | null
  target: TradeSimulationTarget
  // Named in a created simulation's name only when the farm has several.
  catchmentName: string | null
}) => {
  const points = useMemo(
    () => gainPoints(curve, output.baseDb2, price),
    [curve, output.baseDb2, price],
  )
  const best = bestTradeAt(output, price)
  const [selectedKg, setSelectedKg] = useState<number | null>(null)
  const selected =
    points.find((point) => point.tradeKg === selectedKg) ?? best ?? points[0]
  const hasBounds = points.some(
    (point) =>
      point.gainUpperBound !== null &&
      Math.round(point.gainUpperBound) !== Math.round(point.gain),
  )
  const rivals = best && hasBounds ? rivalTrades(points, best) : []

  if (!selected || !best) {
    return (
      <p className="text-sm text-muted-foreground">Ingen løsninger at vise.</p>
    )
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-4 @5xl:grid-cols-[minmax(0,28rem)_minmax(0,1fr)] @5xl:items-start">
        <QuotaAnswer curve={curve} best={best} rivals={rivals} price={price} />
        <div className="flex min-w-0 flex-col gap-2">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h4 className="text-sm font-semibold">
              Gevinst ved hver handel, kr/år
            </h4>
            <span className="text-xs text-muted-foreground">
              {hasBounds ? 'Stiplet: optimeringens usikkerhed. ' : ''}Klik en
              søjle for at se handlen.
              {tradeRange ? ` Interval ${describeTradeRange(tradeRange)}.` : ''}
            </span>
          </div>
          <QuotaGainBars
            points={points}
            bestKg={best.tradeKg}
            selectedKg={selected.tradeKg}
            onSelect={setSelectedKg}
          />
        </div>
      </div>
      <QuotaPointDetails
        point={selected}
        output={output}
        quotaKgN={curve.quotaKgN}
        price={price}
        create={
          <CreateTradeSimulationButton
            target={target}
            catchmentId={curve.catchmentId}
            catchmentName={catchmentName}
            point={selected.point}
            priceKrPerKg={price}
          />
        }
      />
    </div>
  )
}

const CreateTradeSimulationButton = ({
  target,
  catchmentId,
  catchmentName,
  point,
  priceKrPerKg,
}: {
  target: TradeSimulationTarget
  catchmentId: number
  catchmentName: string | null
  point: SolvedQuotaPoint
  // The price the trade was chosen at, shown in the new simulation's name.
  priceKrPerKg: number
}) => {
  const { startRun } = useOptimizationRunActions()
  const [creating, setCreating] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const name = tradeSimulationName({
    originalName: target.simulationName,
    tradeKg: point.tradeKg,
    catchmentName,
    priceKrPerKg,
  })

  const create = async () => {
    setCreating(true)
    setError(null)
    try {
      const created = await createQuotaTradeSimulation(
        target.farmId,
        target.simulationId,
        { catchmentId, tradeKg: point.tradeKg, name, priceKrPerKg },
      )
      await mutate(simulationsKey(target.farmId))
      const simulationId = created.simulation.id
      // The marker are locked to the trade's plan and the kvotehandel is its
      // saved setting, so this run only fills in the result.
      startRun({
        kind: 'yearly',
        input: {},
        farmId: target.farmId,
        simulationId,
        fieldsBefore: await fetchSimulationFields(target.farmId, simulationId),
      })
      target.onError(
        created.unmatchedFields.length > 0
          ? `Simuleringen er oprettet, men disse marker kunne ikke gives handlens sædskifte: ${created.unmatchedFields.join(', ')}.`
          : null,
      )
      target.onOpenSimulation(simulationId)
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : 'Simuleringen kunne ikke oprettes.',
      )
    } finally {
      setCreating(false)
    }
  }

  return (
    <div className="flex max-w-xs flex-col items-start gap-1">
      <Button
        size="sm"
        onClick={() => void create()}
        disabled={!target.available || creating}
        title={`Opretter "${name}"`}
      >
        {creating ? <Spinner /> : null}
        Opret som simulering
      </Button>
      <span className="text-xs text-muted-foreground">
        {!target.available
          ? 'Simuleringen er ændret siden beregningen. Beregn igen for at oprette handlen.'
          : `Kvotehandel til ${formatPrice(priceKrPerKg)} kr/kg N, og markerne låses til handlens sædskifter.`}
      </span>
      {error ? <span className="text-xs text-destructive">{error}</span> : null}
    </div>
  )
}

const DetailFigure = ({
  label,
  children,
  className,
}: {
  label: string
  children: ReactNode
  className?: string
}) => (
  <div className="flex flex-col gap-0.5">
    <span className="text-[11px] text-muted-foreground">{label}</span>
    <span className={cn('text-sm tabular-nums', className)}>{children}</span>
  </div>
)

const QuotaPointDetails = ({
  point,
  output,
  quotaKgN,
  price,
  create,
}: {
  point: GainPoint
  output: QuotaValueOutput
  quotaKgN: number
  price: number
  create: ReactNode
}) => {
  const { tradeKg } = point
  const solved = point.point
  const rows = quotaYearRows(solved, quotaKgN)
  return (
    <div className="flex flex-col gap-3 border-t pt-3">
      <div className="flex flex-wrap items-start gap-x-10 gap-y-3">
        <div className="flex flex-wrap gap-x-7 gap-y-3">
          <DetailFigure label="Valgt handel" className="font-semibold">
            {describeTrade(tradeKg)}
          </DetailFigure>
          <DetailFigure label="DB2 fra afgrøder">
            {formatKr(solved.db2)}
          </DetailFigure>
          <DetailFigure
            label={
              tradeKg > 0
                ? 'Køb af kvote'
                : tradeKg < 0
                  ? 'Salg af kvote'
                  : 'Handel'
            }
          >
            {formatSignedKr(-price * tradeKg)}
          </DetailFigure>
          <DetailFigure
            label="Gevinst"
            className={cn('font-semibold', GAIN_TEXT(point.gain))}
          >
            {describeGainRange(point)}
          </DetailFigure>
        </div>
        {create}
      </div>
      <p className="text-xs text-muted-foreground">
        {solved.solutionFromTradeKg !== null
          ? `Optimeringen fandt ikke en bedre plan inden for tidsgrænsen end planen ved ${describeTradeInSentence(solved.solutionFromTradeKg)}, som også holder sig inden for denne kvote. Værdien er derfor en nedre grænse.`
          : (STATUS_LABELS[solved.status] ?? solved.status)}
      </p>
      <details className="group rounded-lg border">
        <summary className="cursor-pointer px-3 py-2 text-sm font-medium text-primary">
          Vis år for år
        </summary>
        <div className="overflow-x-auto px-3 pb-3">
          <table className="w-full text-xs tabular-nums">
            <caption className="mb-1 text-left text-muted-foreground">
              Udledning i oplandet og foderenheder på bedriften pr. år
            </caption>
            <thead>
              <tr className="border-b text-muted-foreground">
                <th className="py-1 text-left font-normal">År</th>
                <th className="py-1 text-right font-normal">Udledning, kg N</th>
                <th className="py-1 text-right font-normal">
                  Kvote efter handel, kg N
                </th>
                <th className="py-1 text-right font-normal">FE</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.year}>
                  <td className="py-0.5">{row.year}</td>
                  <td className="py-0.5 text-right">
                    {formatWholeNumber(row.nLoad)}
                  </td>
                  <td className="py-0.5 text-right">
                    {formatWholeNumber(row.quotaAfterTrade)}
                  </td>
                  <td className="py-0.5 text-right">
                    {formatWholeNumber(row.feedUnits)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {output.minFeedUnits !== null || output.maxFeedUnits !== null ? (
            <p className="mt-2 text-xs text-muted-foreground">
              FE-krav pr. år:{' '}
              {output.minFeedUnits !== null
                ? `mindst ${formatWholeNumber(output.minFeedUnits)}`
                : ''}
              {output.minFeedUnits !== null && output.maxFeedUnits !== null
                ? ', '
                : ''}
              {output.maxFeedUnits !== null
                ? `højst ${formatWholeNumber(output.maxFeedUnits)}`
                : ''}
            </p>
          ) : null}
        </div>
      </details>
    </div>
  )
}
