import { Chart } from '@tanstack/charts/react'
import { Check, Circle, Minus } from 'lucide-react'
import { useEffect, useId, useMemo, useState, type ReactNode } from 'react'
import { mutate } from 'swr'

import {
  fetchSimulationFields,
  quotaValueKey,
  simulationsKey,
  useQuotaValue,
} from '@/api/hooks'
import { createQuotaTradeSimulation, startQuotaValue } from '@/api/mutations'
import { useOptimizationRunActions } from '@/api/optimization-runs'
import type {
  QuotaProgressStep,
  QuotaTradeRange,
  QuotaValueCurve,
  QuotaValueOutput,
  QuotaValueResult,
  Simulation,
} from '@/api/types'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { LoadError } from '@/components/ui/load-error'
import { SegmentedControl } from '@/components/ui/segmented-control'
import { Spinner } from '@/components/ui/spinner'
import { formatSigned, formatWholeNumber } from '@/lib/field-domain'
import {
  bestTrade,
  checkTradeRange,
  describeTrade,
  describeTradeRange,
  formatElapsed,
  gainPoints,
  interactionCheck,
  sellingLimit,
  parsePrice,
  priceThresholds,
  progressCount,
  progressLabel,
  quotaYearRows,
  rivalTrades,
  tradeSimulationName,
  type GainPoint,
  type SolvedQuotaPoint,
  type TradeRangeCheck,
} from '@/lib/quota-trade'
import { quotaGainChart, type QuotaGainDatum } from '@/lib/quota-trade-chart'
import { cn } from '@/lib/utils'

const CHART_HEIGHT = 260
const CAPTION_CLASS = 'text-[11px] text-muted-foreground'

const formatKr = (value: number) => `${formatWholeNumber(value)} kr/år`
const formatSignedKr = (value: number) =>
  `${formatSigned(value, formatWholeNumber)} kr/år`
const formatTradeTick = (tradeKg: number) =>
  formatSigned(tradeKg, formatWholeNumber)

const describeGainRange = (point: GainPoint) =>
  point.gainUpperBound === null
    ? formatSignedKr(point.gain)
    : `${formatSigned(point.gain, formatWholeNumber)} til ${formatSignedKr(point.gainUpperBound)}`

const listTrades = (points: GainPoint[]) => {
  const names = points.map((point) =>
    describeTrade(point.tradeKg).toLowerCase(),
  )
  return names.length > 1
    ? `${names.slice(0, -1).join(', ')} og ${names[names.length - 1]}`
    : names[0]
}

const STATUS_LABELS: Record<string, string> = {
  OPTIMAL: 'Løsningen er bevist tæt på den bedst mulige',
  FEASIBLE: 'Tidsgrænsen nået, bedste fundne løsning',
}

type QuotaTradePanelProps = {
  farmId: string
  simulation: Simulation
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
  // False when the scenario changed after the curve was computed.
  available: boolean
  onOpenSimulation: (simulationId: string) => void
  onError: (message: string | null) => void
}

// A curve is computed from the scenario's latest completed Års-optimering.
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

const QuotaRangeFields = ({
  value,
  check,
  disabled,
  onChange,
}: {
  value: RangeInput
  check: TradeRangeCheck | null
  disabled: boolean
  onChange: (value: RangeInput) => void
}) => {
  const id = useId()
  const field = (
    key: 'minKg' | 'maxKg' | 'stepKg',
    label: string,
    placeholder: string,
  ) => (
    <div className="flex flex-col gap-1">
      <Label htmlFor={`${id}-${key}`}>{label}</Label>
      <Input
        id={`${id}-${key}`}
        inputMode="decimal"
        value={value[key]}
        onChange={(event) => onChange({ ...value, [key]: event.target.value })}
        placeholder={placeholder}
        disabled={disabled}
        className="h-9 w-24"
        aria-invalid={check?.kind === 'invalid'}
      />
    </div>
  )
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-col gap-1">
        <span className="text-sm font-medium">Interval for handel</span>
        <SegmentedControl
          aria-label="Interval for handel"
          value={value.mode}
          options={[
            { value: 'default', label: 'Standard' },
            { value: 'custom', label: 'Eget interval' },
          ]}
          onValueChange={(mode) => onChange({ ...value, mode })}
          disabled={disabled}
          labelClassName="inline"
          className="w-fit"
        />
      </div>
      {value.mode === 'default' ? (
        <p className="text-xs text-muted-foreground">
          25 % af oplandets loft til hver side af ingen handel, med 3 handler
          til hver side.
        </p>
      ) : (
        <>
          <div className="flex flex-wrap items-end gap-3">
            {field('minKg', 'Fra, kg N/år', '-100')}
            {field('maxKg', 'Til, kg N/år', '150')}
            {field('stepKg', 'Afstand, kg', '50')}
          </div>
          {check?.kind === 'invalid' ? (
            <p className="text-sm text-destructive">{check.message}</p>
          ) : null}
          {check?.kind === 'ok' ? (
            <p className="text-xs text-muted-foreground">
              {check.trades.length} handler ud over ingen handel:{' '}
              {check.trades
                .map((trade) => formatSigned(trade, formatWholeNumber))
                .join(', ')}{' '}
              kg N/år. Negativ er salg. Køb ud over det, bedriften kan udnytte,
              og salg under et tomt loft beregnes ikke; salget stopper, hvor
              planen ikke længere kan overholde de øvrige krav.
            </p>
          ) : null}
        </>
      )}
    </div>
  )
}

export const QuotaTradePanel = ({
  farmId,
  simulation,
  catchmentLabel,
  onOpenSimulation,
  onError,
}: QuotaTradePanelProps) => {
  const priceId = useId()
  const {
    data: result,
    error,
    isLoading,
    mutate: reload,
  } = useQuotaValue(farmId, simulation.id)
  const [priceInput, setPriceInput] = useState<string | null>(null)
  const [rangeInput, setRangeInput] = useState<RangeInput | null>(null)
  const [starting, setStarting] = useState(false)
  const [startError, setStartError] = useState<string | null>(null)

  const storedPrice = result?.priceKrPerKg ?? null
  const shownPriceInput =
    priceInput ??
    (storedPrice === null ? '' : String(storedPrice).replace('.', ','))
  const price = parsePrice(shownPriceInput)
  const shownRange = rangeInput ?? rangeInputFrom(result?.tradeRange ?? null)
  const rangeCheck =
    shownRange.mode === 'custom'
      ? checkTradeRange(shownRange.minKg, shownRange.maxKg, shownRange.stepKg)
      : null
  const rangeReady = rangeCheck === null || rangeCheck.kind === 'ok'
  const running =
    result?.status === 'queued' || result?.status === 'in_progress'
  const canCompute = yearlyRunIsCurrent(simulation)

  const start = async () => {
    if (price === null) return
    setStarting(true)
    setStartError(null)
    try {
      const started = await startQuotaValue(farmId, simulation.id, {
        expectedRevision: simulation.revision,
        runId: crypto.randomUUID(),
        priceKrPerKg: price,
        tradeRange: rangeCheck?.kind === 'ok' ? rangeCheck.range : null,
      })
      await mutate(quotaValueKey(farmId, simulation.id), started, {
        revalidate: false,
      })
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

  return (
    <section
      aria-label="Kvotehandel"
      className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto rounded-lg border bg-card p-4"
    >
      <div className="flex flex-wrap items-end gap-3">
        <div className="flex flex-col gap-1">
          <Label htmlFor={priceId}>Kvotepris</Label>
          <div className="flex items-center gap-2">
            <Input
              id={priceId}
              inputMode="decimal"
              value={shownPriceInput}
              onChange={(event) => setPriceInput(event.target.value)}
              placeholder="35"
              className="h-9 w-28"
              aria-invalid={shownPriceInput !== '' && price === null}
            />
            <span className="text-sm text-muted-foreground">
              kr pr. kg N pr. år
            </span>
          </div>
        </div>
        <Button
          size="sm"
          onClick={() => void start()}
          disabled={
            !canCompute || price === null || !rangeReady || running || starting
          }
        >
          {starting ? <Spinner /> : null}
          {result?.status === 'completed'
            ? 'Beregn kurven igen'
            : 'Beregn kvoteværdi'}
        </Button>
      </div>
      <QuotaRangeFields
        value={shownRange}
        check={rangeCheck}
        disabled={running || starting}
        onChange={setRangeInput}
      />
      {result?.status === 'completed' && result.output && !result.outdated ? (
        <p className="text-xs text-muted-foreground">
          Kurven er gemt
          {result.tradeRange
            ? ` for intervallet ${describeTradeRange(result.tradeRange)}`
            : ''}
          . Ændrer du prisen, opdateres gevinsten med det samme uden en ny
          beregning.
        </p>
      ) : null}
      {shownPriceInput !== '' && price === null ? (
        <p className="text-sm text-destructive">
          Skriv prisen som et tal, fx 35 eller 37,5.
        </p>
      ) : null}
      {startError ? (
        <p className="text-sm text-destructive">{startError}</p>
      ) : null}
      <QuotaTradeStatus
        result={result}
        canCompute={canCompute}
        catchmentLabel={catchmentLabel}
      />
      {result?.status === 'completed' && result.output && price !== null ? (
        <QuotaTradeResult
          output={result.output}
          price={price}
          catchmentLabel={catchmentLabel}
          target={{
            farmId,
            simulationId: simulation.id,
            simulationName: simulation.name,
            available: !result.outdated,
            onOpenSimulation,
            onError,
          }}
        />
      ) : null}
    </section>
  )
}

const STEP_ICON_CLASS = 'size-4 shrink-0'

const StepIcon = ({ state }: { state: QuotaProgressStep['state'] }) => {
  if (state === 'running') return <Spinner />
  if (state === 'done')
    return <Check aria-hidden className={cn(STEP_ICON_CLASS, 'text-primary')} />
  if (state === 'skipped')
    return (
      <Minus
        aria-hidden
        className={cn(STEP_ICON_CLASS, 'text-muted-foreground')}
      />
    )
  return (
    <Circle
      aria-hidden
      className={cn(STEP_ICON_CLASS, 'text-muted-foreground/50')}
    />
  )
}

const STEP_STATE_LABELS: Record<QuotaProgressStep['state'], string> = {
  pending: 'venter',
  running: 'i gang',
  done: 'færdig',
  skipped: 'ikke nødvendig',
}

const useSecondsSince = (start: string | null) => {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!start) return
    const timer = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(timer)
  }, [start])
  return start ? (now - Date.parse(start)) / 1000 : null
}

const QuotaTradeProgress = ({
  result,
  catchmentLabel,
}: {
  result: QuotaValueResult
  catchmentLabel: (catchmentId: number | null) => string
}) => {
  const elapsed = useSecondsSince(result.startedAt)
  const steps = result.progress ?? []
  const catchments = new Set(
    steps.map((step) => step.catchmentId).filter((id) => id !== null),
  )
  return (
    <div
      role="status"
      className="flex flex-col gap-2 rounded-lg border p-3 text-sm"
    >
      <p className="flex items-center gap-2 font-medium">
        {steps.length === 0 ? <Spinner /> : null}
        {result.status === 'queued'
          ? 'Venter på at beregningen starter …'
          : `Beregner kvoteværdien … ${elapsed !== null ? formatElapsed(elapsed) : ''}`}
      </p>
      {steps.length > 0 ? (
        <ol className="flex flex-col gap-1">
          {steps.map((step) => (
            <li
              key={`${step.key}-${step.catchmentId ?? 'all'}`}
              className={cn(
                'flex items-center gap-2',
                step.state === 'pending' || step.state === 'skipped'
                  ? 'text-muted-foreground'
                  : '',
              )}
            >
              <StepIcon state={step.state} />
              <span className="sr-only">{STEP_STATE_LABELS[step.state]}:</span>
              <span className="flex-1">
                {catchments.size > 1 && step.catchmentId !== null
                  ? `${catchmentLabel(step.catchmentId)}: `
                  : ''}
                {progressLabel(step)}
              </span>
              <span className="tabular-nums text-muted-foreground">
                {progressCount(step)}
              </span>
            </li>
          ))}
        </ol>
      ) : (
        <p className="text-muted-foreground">
          Det kræver mange optimeringer og kan tage nogle minutter.
        </p>
      )}
    </div>
  )
}

const QuotaTradeStatus = ({
  result,
  canCompute,
  catchmentLabel,
}: {
  result: QuotaValueResult | undefined
  canCompute: boolean
  catchmentLabel: (catchmentId: number | null) => string
}) => {
  if (result?.status === 'queued' || result?.status === 'in_progress') {
    return (
      <QuotaTradeProgress result={result} catchmentLabel={catchmentLabel} />
    )
  }
  if (result?.status === 'failed') {
    return (
      <p className="text-sm text-destructive">
        {result.error?.message ?? 'Beregningen fejlede.'}
      </p>
    )
  }
  if (result?.status === 'completed' && result.outdated) {
    return (
      <p className="text-sm text-muted-foreground">
        Scenariet eller optimeringen er ændret siden beregningen.{' '}
        {canCompute ? 'Beregn igen for at se den aktuelle værdi.' : ''}
      </p>
    )
  }
  if (!canCompute) {
    return (
      <p className="text-sm text-muted-foreground">
        Kvoteværdien beregnes ud fra scenariets seneste Års-optimering. Kør
        Års-optimering, og kom tilbage hertil.
      </p>
    )
  }
  if (result?.status !== 'completed') {
    return (
      <p className="text-sm text-muted-foreground">
        Angiv den pris, du kan købe eller sælge kvote til, og beregn, hvor meget
        det betaler sig at handle i hvert kystvandopland.
      </p>
    )
  }
  return null
}

type QuotaTradeResultProps = {
  output: QuotaValueOutput
  price: number
  catchmentLabel: (catchmentId: number | null) => string
  target: TradeSimulationTarget
}

const QuotaTradeResult = ({
  output,
  price,
  catchmentLabel,
  target,
}: QuotaTradeResultProps) => {
  const [catchmentId, setCatchmentId] = useState<number | null>(null)
  const curve =
    output.curves.find((candidate) => candidate.catchmentId === catchmentId) ??
    output.curves[0]
  if (!curve) {
    return (
      <p className="text-sm text-muted-foreground">
        Scenariet har ingen kystvandoplande med udledningsloft og kvotegivende
        marker, så der er ingen kvote at handle med.
      </p>
    )
  }
  const check = interactionCheck(output.interaction, price)
  return (
    <div className="flex flex-col gap-3">
      {output.curves.length > 1 ? (
        <SegmentedControl
          aria-label="Kystvandopland"
          value={String(curve.catchmentId)}
          options={output.curves.map((option) => ({
            value: String(option.catchmentId),
            label: catchmentLabel(option.catchmentId),
          }))}
          onValueChange={(value) => setCatchmentId(Number(value))}
          className="w-fit"
        />
      ) : null}
      {check.kind === 'differs' ? (
        <p className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">
          Oplandene påvirker hinanden: handles der i alle oplande på én gang,
          giver det{' '}
          {check.combinedGain === null
            ? 'ingen mulig løsning'
            : formatSignedKr(check.combinedGain)}{' '}
          i stedet for {formatSignedKr(check.separateGain)} lagt sammen.
          Kurverne viser hvert opland for sig, med de andre uændrede.
        </p>
      ) : null}
      {check.kind === 'other-price' ? (
        <p className="text-sm text-muted-foreground">
          Kontrollen af samspillet mellem oplandene er beregnet ved{' '}
          {formatWholeNumber(check.computedAt)} kr/kg. Beregn igen for at
          kontrollere ved den nye pris.
        </p>
      ) : null}
      <QuotaCurveView
        key={curve.catchmentId}
        curve={curve}
        output={output}
        price={price}
        target={target}
        catchmentName={
          output.curves.length > 1 ? catchmentLabel(curve.catchmentId) : null
        }
      />
    </div>
  )
}

const QuotaCurveView = ({
  curve,
  output,
  price,
  target,
  catchmentName,
}: {
  curve: QuotaValueCurve
  output: QuotaValueOutput
  price: number
  target: TradeSimulationTarget
  // Named in a created simulation's name only when the farm has several.
  catchmentName: string | null
}) => {
  const points = useMemo(
    () => gainPoints(curve, output.baseDb2, price),
    [curve, output.baseDb2, price],
  )
  const best = bestTrade(points)
  const [selectedKg, setSelectedKg] = useState<number | null>(null)
  const selected =
    points.find((point) => point.tradeKg === selectedKg) ?? best ?? points[0]
  const data: QuotaGainDatum[] = points.map((point) => ({
    ...point,
    key: String(point.tradeKg),
    best: point.tradeKg === best?.tradeKg,
    selected: point.tradeKg === selected?.tradeKg,
  }))
  const limit = sellingLimit(curve)
  const hasBounds = points.some((point) => point.gainUpperBound !== null)
  const rivals = best && hasBounds ? rivalTrades(points, best) : []

  if (!selected || !best) {
    return (
      <p className="text-sm text-muted-foreground">Ingen løsninger at vise.</p>
    )
  }

  return (
    <div className="grid gap-3 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
      <div className="rounded-lg border bg-background p-3">
        <p className="text-sm font-medium">
          Ved {formatWholeNumber(price)} kr/kg: {describeTrade(best.tradeKg)}
          {best.tradeKg !== 0 ? ` (${formatSignedKr(best.gain)})` : ''}
        </p>
        {hasBounds ? (
          <p className={cn(CAPTION_CLASS, 'mt-1')}>
            {rivals.length === 0
              ? 'Sikkert bedst blandt de beregnede handler.'
              : `Inden for optimeringens usikkerhed kan også ${listTrades(rivals)} være bedst.`}
          </p>
        ) : null}
        <QuotaPriceThresholds curve={curve} />
        <p className={cn(CAPTION_CLASS, 'mt-2 mb-1')}>
          Gevinst i forhold til ingen handel, kr/år
        </p>
        <Chart
          definition={quotaGainChart(data, {
            formatTrade: formatTradeTick,
            formatGain: formatWholeNumber,
            describe: (datum) =>
              `${describeTrade(datum.tradeKg)}\n${describeGainRange(datum)}`,
          })}
          height={CHART_HEIGHT}
          ariaLabel="Gevinst ved køb og salg af kvote i forhold til ingen handel"
          onSelect={(point) => {
            if (point) setSelectedKg((point.datum as QuotaGainDatum).tradeKg)
          }}
        />
        <p className={cn(CAPTION_CLASS, 'text-right')}>
          Handel, kg N pr. år (negativ = salg, positiv = køb)
        </p>
        {hasBounds ? (
          <p className={cn(CAPTION_CLASS, 'mt-2')}>
            Det skraverede område er optimeringens usikkerhed: den bedst mulige
            plan ved hver handel giver en gevinst mellem punktet og områdets
            øverste kant.
          </p>
        ) : null}
        <p className={cn(CAPTION_CLASS, 'mt-2')}>
          Mere end {formatWholeNumber(curve.unconstrainedTradeKg)} kg N/år kan
          ikke udnyttes.{' '}
          {limit?.kind === 'proven'
            ? `Der kan højst sælges ${formatWholeNumber(Math.abs(limit.lowestKg))} kg N/år, før planen ikke længere kan overholde de øvrige krav.`
            : ''}
          {limit?.kind === 'undetermined'
            ? `Salg ud over ${formatWholeNumber(Math.abs(limit.lowestKg))} kg N/år kunne ikke afgøres inden for tidsgrænsen.`
            : ''}
        </p>
      </div>
      <QuotaPointDetails
        point={selected}
        output={output}
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

const formatPrice = (price: number) =>
  price.toLocaleString('da-DK', { maximumFractionDigits: 1 })

const QuotaPriceThresholds = ({ curve }: { curve: QuotaValueCurve }) => {
  const { buyBelow, sellAbove } = useMemo(() => priceThresholds(curve), [curve])
  return (
    <div className="mt-2 rounded-md bg-muted/50 p-2 text-xs">
      <p className="font-medium">Prisgrænser</p>
      <ul className="mt-1 flex flex-col gap-1 text-muted-foreground">
        <li>
          {buyBelow
            ? `Køb er bedst, når prisen er under ${formatPrice(buyBelow.priceKrPerKg)} kr/kg (${describeTrade(buyBelow.tradeKg).toLowerCase()}).`
            : 'Køb er ikke bedst ved nogen pris blandt de beregnede handler.'}
        </li>
        <li>
          {sellAbove
            ? `Salg er bedst, når prisen er over ${formatPrice(sellAbove.priceKrPerKg)} kr/kg (${describeTrade(sellAbove.tradeKg).toLowerCase()}).`
            : 'Der er ikke beregnet noget salg, som planen kan overholde.'}
        </li>
        {buyBelow && sellAbove ? (
          <li>
            {sellAbove.priceKrPerKg - buyBelow.priceKrPerKg >= 0.05
              ? `Mellem ${formatPrice(buyBelow.priceKrPerKg)} og ${formatPrice(sellAbove.priceKrPerKg)} kr/kg er ingen handel bedst.`
              : 'Der er ingen pris, hvor det er bedst ikke at handle.'}
          </li>
        ) : null}
      </ul>
      <p className="mt-1 text-[11px] text-muted-foreground">
        Grænserne gælder blandt de beregnede handler; en handel mellem punkterne
        kan flytte dem lidt.
      </p>
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
  const storedPlan = point.rotations.length > 0
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
        {
          catchmentId,
          tradeKg: point.tradeKg,
          name,
          priceKrPerKg,
          catchmentName,
        },
      )
      await mutate(simulationsKey(target.farmId))
      const simulationId = created.simulation.id
      // The marker are locked to the trade's plan and the traded caps are its
      // saved settings, so this run only fills in the result.
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
    <div className="flex flex-col gap-1">
      <Button
        size="sm"
        className="w-fit"
        onClick={() => void create()}
        disabled={!target.available || !storedPlan || creating}
      >
        {creating ? <Spinner /> : null}
        Opret som simulering
      </Button>
      <p className="text-xs text-muted-foreground">
        {!target.available
          ? 'Scenariet er ændret siden beregningen. Beregn kurven igen for at oprette handlen.'
          : !storedPlan
            ? 'Kurven er beregnet med en tidligere udgave. Beregn den igen for at oprette handlen.'
            : `Opretter "${name}" med handlens sædskifter låst på hver mark og oplandets loft ændret med handlen.`}
      </p>
      {error ? <p className="text-xs text-destructive">{error}</p> : null}
    </div>
  )
}

const QuotaPointDetails = ({
  point,
  output,
  price,
  create,
}: {
  point: GainPoint
  output: QuotaValueOutput
  price: number
  create: ReactNode
}) => {
  const { tradeKg } = point
  const solved = point.point
  const tradeAmount = -price * tradeKg
  const rows = quotaYearRows(solved)
  return (
    <div className="flex flex-col gap-3 rounded-lg border bg-background p-3 text-sm">
      <div>
        <p className="font-medium">{describeTrade(tradeKg)}</p>
        <p className="text-muted-foreground">
          {solved.solutionFromTradeKg !== null
            ? `Optimeringen fandt ikke en bedre plan inden for tidsgrænsen end planen ved ${describeTrade(solved.solutionFromTradeKg).toLowerCase()}, som også overholder dette loft. Værdien er derfor en nedre grænse.`
            : (STATUS_LABELS[solved.status] ?? solved.status)}
        </p>
      </div>
      <dl className="grid grid-cols-[1fr_auto] gap-x-3 gap-y-1">
        <dt className="text-muted-foreground">DB2 fra afgrøder</dt>
        <dd className="text-right tabular-nums">{formatKr(solved.db2)}</dd>
        {solved.db2UpperBound !== null ? (
          <>
            <dt className="text-muted-foreground">Højst mulige DB2</dt>
            <dd className="text-right tabular-nums">
              {formatKr(solved.db2UpperBound)}
            </dd>
            <dt className="text-muted-foreground">Usikkerhed</dt>
            <dd className="text-right tabular-nums">
              {formatKr(solved.db2UpperBound - solved.db2)}
            </dd>
          </>
        ) : null}
        <dt className="text-muted-foreground">
          {tradeKg > 0
            ? 'Køb af kvote'
            : tradeKg < 0
              ? 'Salg af kvote'
              : 'Handel'}
        </dt>
        <dd className="text-right tabular-nums">
          {formatSignedKr(tradeAmount)}
        </dd>
        <dt className="font-medium">Gevinst i forhold til ingen handel</dt>
        <dd className="text-right font-medium tabular-nums">
          {describeGainRange(point)}
        </dd>
      </dl>
      <table className="w-full text-xs tabular-nums">
        <caption className="mb-1 text-left text-muted-foreground">
          Udledning i oplandet og foderenheder på bedriften pr. år
        </caption>
        <thead>
          <tr className="text-muted-foreground">
            <th className="text-left font-normal">År</th>
            <th className="text-right font-normal">Udledning, kg N</th>
            <th className="text-right font-normal">Loft, kg N</th>
            <th className="text-right font-normal">FE</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.year}>
              <td>{row.year}</td>
              <td className="text-right">{formatWholeNumber(row.nLoad)}</td>
              <td className="text-right">
                {row.cap === null ? 'Intet' : formatWholeNumber(row.cap)}
              </td>
              <td className="text-right">{formatWholeNumber(row.feedUnits)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {output.minFeedUnits !== null || output.maxFeedUnits !== null ? (
        <p className="text-xs text-muted-foreground">
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
      {create}
    </div>
  )
}
