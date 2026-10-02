import {
  ChevronDown,
  ChevronRight,
  Link2,
  Minus,
  Plus,
  Undo2,
} from 'lucide-react'
import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'

import { CropGroupTile } from '@/components/farm/CropGroupTile'
import { AppTooltip } from '@/components/ui/app-tooltip'
import { Button } from '@/components/ui/button'
import { FieldError } from '@/components/ui/field-error'
import { Input } from '@/components/ui/input'
import { cropGroupFor } from '@/lib/crop-groups'
import {
  COST_CATEGORIES,
  cropSources,
  cropTotals,
  cropYieldPct,
  economicsInputText,
  findPrice,
  formatDbDkk,
  formatEconomicsNumber,
  formatYieldPct,
  incomeSplit,
  isCropCustomised,
  isLineCustomised,
  isPriceCustomised,
  isQuantityCustomised,
  isYieldCustomised,
  lineAmountDkkHa,
  lineGroupId,
  lineQuantity,
  parseEconomicsInput,
  parseYieldPctInput,
  priceUsage,
  priceValue,
  quantityUnitLabel,
  stepYieldPct,
  withoutCropChanges,
  withPriceOverride,
  withQuantityOverride,
  withYieldPct,
  YIELD_ADJUSTMENT_ID,
  YIELD_PCT_STEP,
  type CropEconomics,
  type EconomicsAssumptions,
  type EconomicsGroupId,
  type EconomicsInput,
  type EconomicsLine,
  type EconomicsOverrides,
  type IncomeShare,
} from '@/lib/economics'
import { formatNumber, formatWholeNumber } from '@/lib/field-domain'
import { cn } from '@/lib/utils'

export type OverridesChange = (
  current: EconomicsOverrides,
) => EconomicsOverrides

type QuantityMode = 'editable' | 'fixed' | 'hidden'

type RegisterRow = (rowId: string, element: HTMLDivElement | null) => void

const ROW_CLASS =
  'grid grid-cols-[minmax(0,1fr)_auto_4.5rem] items-center gap-x-4 border-t py-2 pr-5 pl-11 text-[13px] focus:ring-2 focus:ring-ring focus:outline-none focus:ring-inset'

const FIELD_CLASS =
  'h-7 rounded-md border px-2 py-0 text-right text-[13px] tabular-nums'

const SHARE_CLASS: Record<IncomeShare['id'], string> = {
  seed: 'bg-stone-300',
  cropProtection: 'bg-stone-400',
  fieldWork: 'bg-stone-500',
  drying: 'bg-stone-600',
  db: 'bg-primary',
}

const shareLabel = (id: IncomeShare['id']) =>
  id === 'db'
    ? 'Dækningsbidrag'
    : (COST_CATEGORIES.find((category) => category.id === id)?.label ?? id)

const sourceList = new Intl.ListFormat('da-DK', {
  style: 'long',
  type: 'conjunction',
})

export const CustomisedDot = () => (
  <span className="size-1.5 shrink-0 rounded-full bg-amber-500">
    <span className="sr-only">(tilpasset)</span>
  </span>
)

const CustomisedChip = () => (
  <span className="rounded bg-amber-100 px-1.5 text-[11px] font-medium text-amber-800">
    tilpasset
  </span>
)

type CustomisedMarkProps = {
  label: string
  onRestore?: () => void
}

const CustomisedMark = ({ label, onRestore }: CustomisedMarkProps) => (
  <span className="inline-flex items-center gap-0.5">
    <CustomisedChip />
    {onRestore ? (
      <AppTooltip content="Gendan standard">
        <button
          type="button"
          aria-label={`Gendan standard for ${label}`}
          className="rounded-sm p-0.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
          onClick={onRestore}
        >
          <Undo2 className="size-3.5" aria-hidden="true" />
        </button>
      </AppTooltip>
    ) : null}
  </span>
)

const SharedPriceIcon = ({ count }: { count: number }) => (
  <AppTooltip content={`Fælles pris for ${count} afgrøder`}>
    <span className="inline-flex text-muted-foreground">
      <Link2 className="size-3.5" aria-hidden="true" />
      <span className="sr-only">Fælles pris for {count} afgrøder</span>
    </span>
  </AppTooltip>
)

type EditableValueProps = {
  value: number
  label: string
  unit: string
  editable: boolean
  customised: boolean
  format?: (value: number) => string
  parse?: (text: string) => EconomicsInput
  onChange: (value: number) => void
}

const EditableValue = ({
  value,
  label,
  unit,
  editable,
  customised,
  format = formatEconomicsNumber,
  parse = parseEconomicsInput,
  onChange,
}: EditableValueProps) => {
  const errorId = useId()
  const [draft, setDraft] = useState<string | null>(null)
  const closing = useRef(false)

  if (!editable) {
    if (draft !== null) setDraft(null)
    return (
      <span
        className={cn(
          'tabular-nums',
          customised
            ? 'self-center rounded bg-amber-100 px-1 leading-5 text-amber-900'
            : 'text-foreground',
        )}
      >
        {format(value)}
      </span>
    )
  }

  if (draft === null) {
    return (
      <button
        type="button"
        aria-label={`Ret ${label}, ${format(value)} ${unit}`}
        className={cn(
          FIELD_CLASS,
          'min-w-16 cursor-text transition-colors hover:border-primary focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none',
          customised
            ? 'border-amber-300 bg-amber-100 text-amber-900'
            : 'bg-background text-foreground',
        )}
        onClick={() => {
          closing.current = false
          setDraft(economicsInputText(value))
        }}
      >
        {format(value)}
      </button>
    )
  }

  const parsed = parse(draft)
  const error = 'error' in parsed ? parsed.error : null
  const commit = () => {
    if ('error' in parsed) return
    closing.current = true
    onChange(parsed.value)
    setDraft(null)
  }

  return (
    <span className="inline-flex flex-col items-end gap-0.5">
      <Input
        autoFocus
        inputMode="decimal"
        aria-label={`${label} i ${unit}`}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? errorId : undefined}
        className={cn(
          FIELD_CLASS,
          'w-16 aria-invalid:border-destructive aria-invalid:ring-1 aria-invalid:ring-destructive',
        )}
        value={draft}
        onFocus={(event) => event.currentTarget.select()}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={() => {
          if (!closing.current) commit()
        }}
        onKeyDown={(event) => {
          if (event.key === 'Enter') commit()
          if (event.key !== 'Escape') return
          closing.current = true
          setDraft(null)
        }}
      />
      <FieldError id={errorId} message={error} />
    </span>
  )
}

type LineRowProps = {
  assumptions: EconomicsAssumptions
  overrides: EconomicsOverrides
  crop: CropEconomics
  line: EconomicsLine
  usage: number
  quantityMode: QuantityMode
  editable: boolean
  onChange: (change: OverridesChange) => void
  registerRow: RegisterRow
}

const LineRow = ({
  assumptions,
  overrides,
  crop,
  line,
  usage,
  quantityMode,
  editable,
  onChange,
  registerRow,
}: LineRowProps) => {
  const price = findPrice(assumptions, line.priceId)
  const quantity = lineQuantity(overrides, crop, line)
  const quantityUnit = quantityUnitLabel(line.quantityUnit, quantity)
  const restore = () =>
    onChange((current) =>
      withPriceOverride(
        assumptions,
        withQuantityOverride(current, crop, line.id, null),
        line.priceId,
        null,
      ),
    )

  return (
    <div
      ref={(element) => registerRow(line.id, element)}
      tabIndex={-1}
      className={ROW_CLASS}
    >
      <div className="flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-0.5">
        <span>{line.label}</span>
        {usage > 1 ? <SharedPriceIcon count={usage} /> : null}
        {isLineCustomised(overrides, crop, line) ? (
          <CustomisedMark
            label={line.label}
            onRestore={editable ? restore : undefined}
          />
        ) : null}
      </div>
      <div className="flex items-start justify-end gap-1 leading-7 whitespace-nowrap text-muted-foreground">
        {quantityMode === 'hidden' ? null : (
          <>
            <EditableValue
              editable={editable && quantityMode === 'editable'}
              customised={isQuantityCustomised(overrides, crop, line.id)}
              value={quantity}
              label={`mængden for ${line.label}`}
              unit={quantityUnit}
              onChange={(value) =>
                onChange((current) =>
                  withQuantityOverride(current, crop, line.id, value),
                )
              }
            />
            <span>{quantityUnit}</span>
            <span className="px-1" aria-hidden="true">
              ×
            </span>
          </>
        )}
        <EditableValue
          editable={editable}
          customised={isPriceCustomised(overrides, line.priceId)}
          value={priceValue(assumptions, overrides, line.priceId)}
          label={`stykprisen for ${line.label}`}
          unit={price?.unit ?? ''}
          onChange={(value) =>
            onChange((current) =>
              withPriceOverride(assumptions, current, line.priceId, value),
            )
          }
        />
        <span>{price?.unit}</span>
      </div>
      <span className="text-right tabular-nums">
        {formatWholeNumber(lineAmountDkkHa(assumptions, overrides, crop, line))}
      </span>
    </div>
  )
}

type YieldAdjustmentRowProps = {
  overrides: EconomicsOverrides
  crop: CropEconomics
  editable: boolean
  onChange: (change: OverridesChange) => void
  registerRow: RegisterRow
}

const YieldAdjustmentRow = ({
  overrides,
  crop,
  editable,
  onChange,
  registerRow,
}: YieldAdjustmentRowProps) => {
  const pct = cropYieldPct(overrides, crop)
  const changePct = (value: number | null) =>
    onChange((current) => withYieldPct(current, crop, value))

  return (
    <div
      ref={(element) => registerRow(YIELD_ADJUSTMENT_ID, element)}
      tabIndex={-1}
      className={cn(ROW_CLASS, 'bg-muted/40')}
    >
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5">
          <span>Udbytte i forhold til normen</span>
          {isYieldCustomised(overrides, crop) ? (
            <CustomisedMark
              label="udbyttet"
              onRestore={editable ? () => changePct(null) : undefined}
            />
          ) : null}
        </div>
        <p className="text-xs text-muted-foreground">
          Lægges oven på hver marks eget udbytte, som afhænger af jordtype og
          vanding.
        </p>
      </div>
      <div className="flex items-start justify-end gap-1.5 leading-7">
        {editable ? (
          <Button
            type="button"
            variant="outline"
            size="icon"
            className="size-7"
            aria-label={`Sænk udbyttet ${YIELD_PCT_STEP} %`}
            onClick={() => changePct(stepYieldPct(pct, -1))}
          >
            <Minus className="size-3.5" aria-hidden="true" />
          </Button>
        ) : null}
        <EditableValue
          editable={editable}
          customised={isYieldCustomised(overrides, crop)}
          value={pct}
          label="udbyttet i forhold til normen"
          unit="%"
          format={formatYieldPct}
          parse={parseYieldPctInput}
          onChange={changePct}
        />
        <span className="text-muted-foreground">%</span>
        {editable ? (
          <Button
            type="button"
            variant="outline"
            size="icon"
            className="size-7"
            aria-label={`Hæv udbyttet ${YIELD_PCT_STEP} %`}
            onClick={() => changePct(stepYieldPct(pct, 1))}
          >
            <Plus className="size-3.5" aria-hidden="true" />
          </Button>
        ) : null}
      </div>
      <span aria-hidden="true" />
    </div>
  )
}

type GroupProps = {
  title: string
  total: string
  open: boolean
  customised: boolean
  onToggle: () => void
  children: ReactNode
}

const Group = ({
  title,
  total,
  open,
  customised,
  onToggle,
  children,
}: GroupProps) => {
  const contentId = useId()
  const Chevron = open ? ChevronDown : ChevronRight

  return (
    <section className="border-t">
      <h3>
        <button
          type="button"
          aria-expanded={open}
          aria-controls={contentId}
          className="flex w-full items-center gap-2 px-5 py-2.5 text-left text-[13px] font-semibold transition-colors hover:bg-muted/50 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none focus-visible:ring-inset"
          onClick={onToggle}
        >
          <Chevron
            className="size-4 shrink-0 text-muted-foreground"
            aria-hidden="true"
          />
          <span className="flex-1">{title}</span>
          {customised ? <CustomisedDot /> : null}
          <span className="tabular-nums">{total}</span>
        </button>
      </h3>
      {open ? <div id={contentId}>{children}</div> : null}
    </section>
  )
}

type KeyFigureProps = {
  label: string
  value: string
  tone?: 'positive' | 'negative'
}

const KeyFigure = ({ label, value, tone }: KeyFigureProps) => (
  <div
    className={cn(
      'rounded-md px-3 py-2',
      tone === 'positive' && 'bg-primary/10 text-primary',
      tone === 'negative' && 'bg-destructive/10 text-destructive',
      !tone && 'bg-muted/60',
    )}
  >
    <dt className={cn('text-[11px]', !tone && 'text-muted-foreground')}>
      {label}
    </dt>
    <dd className="mt-0.5 text-lg font-semibold tabular-nums">{value}</dd>
  </div>
)

const IncomeBar = ({ shares }: { shares: IncomeShare[] }) => (
  <div className="px-5 pt-3">
    <div
      className="flex h-2.5 gap-0.5 overflow-hidden rounded-full bg-muted"
      aria-hidden="true"
    >
      {shares.map((part) => (
        <span
          key={part.id}
          className={SHARE_CLASS[part.id]}
          style={{ flex: `${part.share} 1 0%` }}
        />
      ))}
    </div>
    <ul
      aria-label="Fordeling af indtægt og tilskud"
      className="mt-1.5 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-muted-foreground"
    >
      {shares.map((part) => (
        <li key={part.id} className="flex items-center gap-1">
          <span
            className={cn('size-2 rounded-sm', SHARE_CLASS[part.id])}
            aria-hidden="true"
          />
          {shareLabel(part.id)} {Math.round(part.share * 100)} %
        </li>
      ))}
    </ul>
  </div>
)

type EconomicsCropDetailProps = {
  assumptions: EconomicsAssumptions
  overrides: EconomicsOverrides
  crop: CropEconomics
  onOverridesChange?: (change: OverridesChange) => void
  focus?: { lineId: string; key: string }
}

export const EconomicsCropDetail = ({
  assumptions,
  overrides,
  crop,
  onOverridesChange,
  focus,
}: EconomicsCropDetailProps) => {
  const editable = onOverridesChange !== undefined
  const change = (update: OverridesChange) => onOverridesChange?.(update)
  const usage = useMemo(() => priceUsage(assumptions), [assumptions])
  const totals = cropTotals(assumptions, overrides, crop)
  const [openGroups, setOpenGroups] = useState<ReadonlySet<EconomicsGroupId>>(
    () => new Set(['revenue']),
  )
  const [shownFocus, setShownFocus] = useState<string | null>(null)
  const rowElements = useRef(new Map<string, HTMLDivElement>())
  const focusKey = focus?.key
  const focusLineId = focus?.lineId

  if (focus && focus.key !== shownFocus) {
    setShownFocus(focus.key)
    const group = lineGroupId(crop, focus.lineId)
    if (group) setOpenGroups((current) => new Set([...current, group]))
  }

  useEffect(() => {
    if (focusKey === undefined || focusLineId === undefined) return
    const row = rowElements.current.get(focusLineId)
    row?.focus({ preventScroll: true })
    row?.scrollIntoView({ block: 'center' })
  }, [focusKey, focusLineId])

  const registerRow: RegisterRow = (rowId, element) => {
    if (element) rowElements.current.set(rowId, element)
    else rowElements.current.delete(rowId)
  }

  const toggleGroup = (id: EconomicsGroupId) =>
    setOpenGroups((current) => {
      const next = new Set(current)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  const groups: {
    id: EconomicsGroupId
    title: string
    total: string
    lines: EconomicsLine[]
    quantityMode: QuantityMode
  }[] = [
    {
      id: 'revenue',
      title: 'Indtægt',
      total: formatWholeNumber(totals.revenueDkkHa),
      lines: crop.revenue,
      quantityMode: 'fixed',
    },
    {
      id: 'subsidy',
      title: 'Tilskud',
      total: `+${formatWholeNumber(totals.subsidyDkkHa)}`,
      lines: crop.subsidies,
      quantityMode: 'hidden',
    },
    ...COST_CATEGORIES.filter(
      (category) => crop.costs[category.id].length > 0,
    ).map((category) => ({
      id: category.id,
      title: category.label,
      total: `−${formatWholeNumber(totals.costsDkkHa[category.id])}`,
      lines: crop.costs[category.id],
      quantityMode: 'editable' as const,
    })),
  ]

  return (
    <div>
      <div className="flex flex-wrap items-start gap-3 px-5 pt-4 pb-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <CropGroupTile group={cropGroupFor(crop.cropCode, crop.cropName)} />
            <h2 className="text-base font-semibold">{crop.cropName}</h2>
            {isCropCustomised(overrides, crop) ? <CustomisedChip /> : null}
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            Forfrugtsværdi {formatNumber(crop.precedingCropValueKgNHa)} kg N/ha
            · tal i kr/ha for JB 5-6
            {editable ? ' · tallene i felterne kan rettes' : null}
          </p>
        </div>
        {editable && isCropCustomised(overrides, crop) ? (
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() =>
              change((current) =>
                withoutCropChanges(assumptions, current, crop),
              )
            }
          >
            <Undo2 className="size-3.5" aria-hidden="true" />
            Gendan standard
          </Button>
        ) : null}
      </div>

      <dl className="grid grid-cols-2 gap-2 px-5 sm:grid-cols-4">
        <KeyFigure
          label="Indtægt"
          value={formatWholeNumber(totals.revenueDkkHa)}
        />
        <KeyFigure
          label="Tilskud"
          value={`+${formatWholeNumber(totals.subsidyDkkHa)}`}
        />
        <KeyFigure
          label="Omkostninger"
          value={`−${formatWholeNumber(totals.totalCostsDkkHa)}`}
        />
        <KeyFigure
          label="Dækningsbidrag"
          value={formatDbDkk(totals.dbDkkHa)}
          tone={totals.dbDkkHa < 0 ? 'negative' : 'positive'}
        />
      </dl>

      <IncomeBar shares={incomeSplit(totals)} />

      <div className="mt-3">
        {groups.map((group) => (
          <Group
            key={group.id}
            title={group.title}
            total={group.total}
            open={openGroups.has(group.id)}
            customised={
              group.lines.some((line) =>
                isLineCustomised(overrides, crop, line),
              ) ||
              (group.id === 'revenue' && isYieldCustomised(overrides, crop))
            }
            onToggle={() => toggleGroup(group.id)}
          >
            {group.id === 'revenue' && crop.revenue.length > 0 ? (
              <YieldAdjustmentRow
                overrides={overrides}
                crop={crop}
                editable={editable}
                onChange={change}
                registerRow={registerRow}
              />
            ) : null}
            {group.lines.map((line) => (
              <LineRow
                key={line.id}
                assumptions={assumptions}
                overrides={overrides}
                crop={crop}
                line={line}
                usage={usage.get(line.priceId) ?? 0}
                quantityMode={group.quantityMode}
                editable={editable}
                onChange={change}
                registerRow={registerRow}
              />
            ))}
          </Group>
        ))}
      </div>

      <p className="border-t px-5 py-2.5 text-[11px] text-muted-foreground">
        Kilde: {sourceList.format(cropSources(assumptions, crop))}. Gødning er
        ikke med i omkostningerne, for den regnes ud fra kvælstofnormen i hver
        simulering.
      </p>
    </div>
  )
}
