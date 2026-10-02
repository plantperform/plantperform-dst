import { Pencil } from 'lucide-react'
import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'

import {
  CHOICE_TAB_ACTIVE_CLASS,
  CHOICE_TAB_CLASS,
  CHOICE_TAB_IDLE_CLASS,
} from '@/components/farm/choice-styles'
import { CropGroupTile } from '@/components/farm/CropGroupTile'
import {
  RULES_CARD_CLASS,
  RULES_CARD_HEAD_CLASS,
} from '@/components/farm/rules-ui'
import { Button } from '@/components/ui/button'
import { FieldError } from '@/components/ui/field-error'
import { Input } from '@/components/ui/input'
import { cropGroupFor } from '@/lib/crop-groups'
import {
  COST_CATEGORIES,
  cropTotals,
  cropYieldPct,
  economicsInputText,
  findPrice,
  formatEconomicsNumber,
  formatYieldPct,
  isCropCustomised,
  isPriceCustomised,
  isQuantityCustomised,
  isYieldCustomised,
  lineAmountDkkHa,
  lineQuantity,
  parseEconomicsInput,
  parseYieldPctInput,
  priceUsage,
  priceValue,
  quantityUnitLabel,
  withPriceOverride,
  withQuantityOverride,
  withYieldPct,
  YIELD_ADJUSTMENT_ID,
  type CropEconomics,
  type EconomicsAssumptions,
  type EconomicsInput,
  type EconomicsLine,
  type EconomicsOverrides,
} from '@/lib/economics'
import { formatNumber, formatWholeNumber } from '@/lib/field-domain'
import { cn } from '@/lib/utils'

const ROW_GRID_CLASS =
  'grid grid-cols-[minmax(0,1fr)_9.5rem_0.75rem_9.5rem_5rem] items-start gap-x-3 px-5'

const OVERVIEW_GRID_CLASS =
  'grid grid-cols-[minmax(0,1fr)_6rem_6rem_6rem] items-center gap-x-3 px-5'

const TABLE_HEAD_CLASS =
  'border-y bg-muted/30 py-2 text-xs font-semibold text-muted-foreground'

const LINE_ROW_CLASS =
  'border-b py-2 text-[13px] focus:ring-2 focus:ring-ring focus:outline-none focus:ring-inset'

type OverridesChange = (current: EconomicsOverrides) => EconomicsOverrides

type QuantityMode = 'editable' | 'fixed' | 'hidden'

type NumberInputProps = {
  value: number
  unit: string
  label: string
  parse?: (text: string) => EconomicsInput
  format?: (value: number) => string
  onChange: (value: number) => void
}

const NumberInput = ({
  value,
  unit,
  label,
  parse = parseEconomicsInput,
  onChange,
}: NumberInputProps) => {
  const errorId = useId()
  const [draft, setDraft] = useState<string | null>(null)
  const parsed = draft === null ? null : parse(draft)
  const error = parsed !== null && 'error' in parsed ? parsed.error : null

  return (
    <div className="space-y-1">
      <div className="flex items-center justify-end gap-1.5">
        <Input
          inputMode="decimal"
          aria-label={`${label} i ${unit}`}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? errorId : undefined}
          className="h-8 w-20 px-2.5 text-right text-[13px] tabular-nums aria-invalid:border-destructive aria-invalid:ring-1 aria-invalid:ring-destructive"
          value={draft ?? economicsInputText(value)}
          onChange={(event) => {
            const text = event.target.value
            setDraft(text)
            const next = parse(text)
            if ('value' in next) onChange(next.value)
          }}
          onBlur={() => {
            if (!error) setDraft(null)
          }}
        />
        <span className="w-16 text-xs text-muted-foreground">{unit}</span>
      </div>
      <FieldError id={errorId} message={error} />
    </div>
  )
}

type ValueCellProps = NumberInputProps & {
  editing: boolean
  className?: string
}

const ValueCell = ({ editing, className, ...input }: ValueCellProps) =>
  editing ? (
    <NumberInput {...input} />
  ) : (
    <div className={cn('flex items-baseline justify-end gap-1.5', className)}>
      <span className="w-20 px-2.5 text-right tabular-nums">
        {(input.format ?? formatEconomicsNumber)(input.value)}
      </span>
      <span className="w-16 text-xs text-muted-foreground">{input.unit}</span>
    </div>
  )

const RestoreButton = ({ onClick }: { onClick: () => void }) => (
  <>
    {' · '}
    <button
      type="button"
      className="rounded-sm font-medium text-primary underline underline-offset-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      onClick={onClick}
    >
      Gendan standard
    </button>
  </>
)

const ValueHeading = ({ children }: { children: ReactNode }) => (
  <span className="flex justify-end gap-1.5">
    <span className="w-20 px-2.5 text-right">{children}</span>
    <span className="w-16" aria-hidden="true" />
  </span>
)

type LineRowProps = {
  assumptions: EconomicsAssumptions
  overrides: EconomicsOverrides
  crop: CropEconomics
  line: EconomicsLine
  usage: number
  editing: boolean
  quantityMode: QuantityMode
  onOverridesChange: (
    update: (current: EconomicsOverrides) => EconomicsOverrides,
  ) => void
  onRestore: (line: EconomicsLine) => void
  registerRow: (lineId: string, element: HTMLDivElement | null) => void
}

const LineRow = ({
  assumptions,
  overrides,
  crop,
  line,
  usage,
  editing,
  quantityMode,
  onOverridesChange,
  onRestore,
  registerRow,
}: LineRowProps) => {
  const price = findPrice(assumptions, line.priceId)
  const customised =
    isQuantityCustomised(overrides, crop, line.id) ||
    isPriceCustomised(overrides, line.priceId)
  const quantity = lineQuantity(overrides, crop, line)
  const source =
    price && price.label !== line.label
      ? `${price.label}: ${price.source}`
      : price?.source
  const textClass = editing ? 'pt-1.5' : undefined

  return (
    <div
      ref={(element) => registerRow(line.id, element)}
      tabIndex={-1}
      className={cn(ROW_GRID_CLASS, LINE_ROW_CLASS)}
    >
      <div className={cn('min-w-0', textClass)}>
        <p>
          {line.label}
          {customised ? (
            <span className="text-muted-foreground"> (tilpasset)</span>
          ) : null}
        </p>
        <p className="text-xs text-muted-foreground">
          {source}
          {usage > 1 ? ` · fælles pris for ${usage} afgrøder` : null}
          {customised ? (
            <RestoreButton onClick={() => onRestore(line)} />
          ) : null}
        </p>
      </div>
      {quantityMode === 'hidden' ? (
        <span className="col-span-2" aria-hidden="true" />
      ) : (
        <>
          <ValueCell
            editing={editing && quantityMode === 'editable'}
            className={textClass}
            value={quantity}
            unit={quantityUnitLabel(line.quantityUnit, quantity)}
            label={`Mængde for ${line.label}`}
            onChange={(value) =>
              onOverridesChange((current) =>
                withQuantityOverride(current, crop, line.id, value),
              )
            }
          />
          <span
            className={cn('text-center text-muted-foreground', textClass)}
            aria-hidden="true"
          >
            ×
          </span>
        </>
      )}
      <ValueCell
        editing={editing}
        value={priceValue(assumptions, overrides, line.priceId)}
        unit={price?.unit ?? ''}
        label={`Stykpris for ${line.label}`}
        onChange={(value) =>
          onOverridesChange((current) =>
            withPriceOverride(assumptions, current, line.priceId, value),
          )
        }
      />
      <span className={cn('text-right tabular-nums', textClass)}>
        {formatWholeNumber(lineAmountDkkHa(assumptions, overrides, crop, line))}
      </span>
    </div>
  )
}

type YieldAdjustmentRowProps = {
  overrides: EconomicsOverrides
  crop: CropEconomics
  editing: boolean
  onOverridesChange: (change: OverridesChange) => void
  onRestore: () => void
  registerRow: (lineId: string, element: HTMLDivElement | null) => void
}

const YieldAdjustmentRow = ({
  overrides,
  crop,
  editing,
  onOverridesChange,
  onRestore,
  registerRow,
}: YieldAdjustmentRowProps) => {
  const customised = isYieldCustomised(overrides, crop)

  return (
    <div
      ref={(element) => registerRow(YIELD_ADJUSTMENT_ID, element)}
      tabIndex={-1}
      className={cn(ROW_GRID_CLASS, LINE_ROW_CLASS)}
    >
      <div className={cn('min-w-0', editing ? 'pt-1.5' : undefined)}>
        <p>
          Udbytte i forhold til normen
          {customised ? (
            <span className="text-muted-foreground"> (tilpasset)</span>
          ) : null}
        </p>
        <p className="text-xs text-muted-foreground">
          Procenten lægges oven på hver marks eget udbytte, som afhænger af
          jordtype og vanding. Tallene herunder er et eksempel for JB 5-6.
          {customised ? <RestoreButton onClick={onRestore} /> : null}
        </p>
      </div>
      <ValueCell
        editing={editing}
        value={cropYieldPct(overrides, crop)}
        unit="%"
        label="Udbytte i forhold til normen"
        parse={parseYieldPctInput}
        format={formatYieldPct}
        onChange={(value) =>
          onOverridesChange((current) => withYieldPct(current, crop, value))
        }
      />
      <span className="col-span-3" aria-hidden="true" />
    </div>
  )
}

type LineSectionProps = {
  title: string
  total: string
  children: ReactNode
}

const LineSection = ({ title, total, children }: LineSectionProps) => (
  <section>
    <h4 className="flex items-baseline justify-between gap-3 border-b px-5 pt-2 pb-1 text-xs font-semibold">
      <span className="text-muted-foreground">{title}</span>
      <span className="tabular-nums">{total}</span>
    </h4>
    {children}
  </section>
)

type CropTableProps = {
  assumptions: EconomicsAssumptions
  overrides: EconomicsOverrides
  crop: CropEconomics
  editing: boolean
  onOverridesChange?: (change: OverridesChange) => void
  registerRow: (lineId: string, element: HTMLDivElement | null) => void
}

const CropTable = ({
  assumptions,
  overrides,
  crop,
  editing,
  onOverridesChange,
  registerRow,
}: CropTableProps) => {
  const [restoreCount, setRestoreCount] = useState(0)
  const usage = useMemo(() => priceUsage(assumptions), [assumptions])
  const totals = cropTotals(assumptions, overrides, crop)
  const changeOverrides = (change: OverridesChange) =>
    onOverridesChange?.(change)

  const restore = (line: EconomicsLine) => {
    changeOverrides((current) =>
      withPriceOverride(
        assumptions,
        withQuantityOverride(current, crop, line.id, null),
        line.priceId,
        null,
      ),
    )
    setRestoreCount((count) => count + 1)
  }

  const restoreYield = () => {
    changeOverrides((current) => withYieldPct(current, crop, null))
    setRestoreCount((count) => count + 1)
  }

  const renderLines = (
    lines: EconomicsLine[],
    quantityMode: QuantityMode = 'editable',
  ) =>
    lines.map((line) => (
      <LineRow
        key={`${crop.cropCode}:${line.id}:${restoreCount}`}
        assumptions={assumptions}
        overrides={overrides}
        crop={crop}
        line={line}
        usage={usage.get(line.priceId) ?? 0}
        editing={editing}
        quantityMode={quantityMode}
        onOverridesChange={changeOverrides}
        onRestore={restore}
        registerRow={registerRow}
      />
    ))

  return (
    <div className="overflow-x-auto">
      <div className="min-w-176">
        <div className={cn(ROW_GRID_CLASS, TABLE_HEAD_CLASS)}>
          <span>Post</span>
          <ValueHeading>Mængde</ValueHeading>
          <span aria-hidden="true" />
          <ValueHeading>Stykpris</ValueHeading>
          <span className="text-right">kr/ha</span>
        </div>

        <LineSection
          title="Indtægt"
          total={formatWholeNumber(totals.revenueDkkHa)}
        >
          {crop.revenue.length > 0 ? (
            <YieldAdjustmentRow
              key={`${crop.cropCode}:${YIELD_ADJUSTMENT_ID}:${restoreCount}`}
              overrides={overrides}
              crop={crop}
              editing={editing}
              onOverridesChange={changeOverrides}
              onRestore={restoreYield}
              registerRow={registerRow}
            />
          ) : null}
          {renderLines(crop.revenue, 'fixed')}
        </LineSection>

        <LineSection
          title="Tilskud"
          total={`+${formatWholeNumber(totals.subsidyDkkHa)}`}
        >
          {renderLines(crop.subsidies, 'hidden')}
        </LineSection>

        {COST_CATEGORIES.filter(
          (category) => crop.costs[category.id].length > 0,
        ).map((category) => (
          <LineSection
            key={category.id}
            title={category.label}
            total={`−${formatWholeNumber(totals.costsDkkHa[category.id])}`}
          >
            {renderLines(crop.costs[category.id])}
          </LineSection>
        ))}

        <div className="flex items-start justify-between gap-3 bg-muted/30 px-5 py-2.5 text-[13px]">
          <div className="min-w-0">
            <p className="font-semibold">Omkostninger i alt</p>
            <p className="text-xs text-muted-foreground">
              Gødning er ikke med her, for den regnes ud fra kvælstofnormen i
              hver simulering.
            </p>
          </div>
          <span className="shrink-0 font-semibold tabular-nums">
            −{formatWholeNumber(totals.totalCostsDkkHa)}
          </span>
        </div>
      </div>
    </div>
  )
}

type CropsOverviewProps = {
  assumptions: EconomicsAssumptions
  overrides: EconomicsOverrides
  onOpenCrop: (cropCode: number) => void
}

const CropsOverview = ({
  assumptions,
  overrides,
  onOpenCrop,
}: CropsOverviewProps) => {
  return (
    <div className="overflow-x-auto">
      <div className="min-w-128">
        <div className={cn(OVERVIEW_GRID_CLASS, TABLE_HEAD_CLASS)}>
          <span>Afgrøde</span>
          <span className="text-right">Indtægt</span>
          <span className="text-right">Tilskud</span>
          <span className="text-right">Omkostninger</span>
        </div>
        {assumptions.crops.map((crop) => {
          const totals = cropTotals(assumptions, overrides, crop)
          return (
            <button
              key={crop.cropCode}
              type="button"
              onClick={() => onOpenCrop(crop.cropCode)}
              className={cn(
                OVERVIEW_GRID_CLASS,
                'w-full border-b py-2 text-left text-[13px] transition-colors hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none focus-visible:ring-inset',
              )}
            >
              <span className="flex min-w-0 items-center gap-2">
                <CropGroupTile
                  group={cropGroupFor(crop.cropCode, crop.cropName)}
                />
                <span className="min-w-0">
                  {crop.cropName}
                  {isCropCustomised(overrides, crop) ? (
                    <span className="text-muted-foreground"> (tilpasset)</span>
                  ) : null}
                </span>
              </span>
              <span className="text-right tabular-nums">
                {formatWholeNumber(totals.revenueDkkHa)}
              </span>
              <span className="text-right tabular-nums">
                +{formatWholeNumber(totals.subsidyDkkHa)}
              </span>
              <span className="text-right tabular-nums">
                −{formatWholeNumber(totals.totalCostsDkkHa)}
              </span>
            </button>
          )
        })}
        <p className="bg-muted/30 px-5 py-2.5 text-xs text-muted-foreground">
          Gødning er ikke med i omkostningerne, for den regnes ud fra
          kvælstofnormen i hver simulering.
        </p>
      </div>
    </div>
  )
}

type EconomicsAssumptionsEditorProps = {
  assumptions: EconomicsAssumptions
  overrides: EconomicsOverrides
  onOverridesChange?: (change: OverridesChange) => void
  defaultEditing?: boolean
  focus?: { cropCode: number; lineId: string; key: string }
}

export const EconomicsAssumptionsEditor = ({
  assumptions,
  overrides,
  onOverridesChange,
  defaultEditing = false,
  focus,
}: EconomicsAssumptionsEditorProps) => {
  const id = useId()
  const [editing, setEditing] = useState(defaultEditing)
  const [activeCode, setActiveCode] = useState<number | null>(null)
  const [shownFocus, setShownFocus] = useState<string | null>(null)
  const rowElements = useRef(new Map<string, HTMLDivElement>())
  const canEdit = onOverridesChange !== undefined
  const focusKey = focus?.key
  const focusLineId = focus?.lineId

  if (focus && focus.key !== shownFocus) {
    setShownFocus(focus.key)
    setActiveCode(focus.cropCode)
  }

  useEffect(() => {
    if (focusKey === undefined || focusLineId === undefined) return
    const row = rowElements.current.get(focusLineId)
    row?.focus({ preventScroll: true })
    row?.scrollIntoView({ block: 'center' })
  }, [focusKey, focusLineId])

  const registerRow = (lineId: string, element: HTMLDivElement | null) => {
    if (element) rowElements.current.set(lineId, element)
    else rowElements.current.delete(lineId)
  }

  const active = assumptions.crops.find((crop) => crop.cropCode === activeCode)

  return (
    <section
      className={cn(RULES_CARD_CLASS, 'overflow-hidden')}
      aria-labelledby={`${id}-title`}
    >
      <div className={RULES_CARD_HEAD_CLASS}>
        <h2 id={`${id}-title`} className="text-sm font-semibold">
          Priser og mængder
        </h2>
        {canEdit ? (
          <Button
            type="button"
            variant="outline"
            size="sm"
            aria-expanded={editing}
            onClick={() => setEditing((current) => !current)}
          >
            <Pencil className="size-3.5" aria-hidden="true" />
            {editing ? 'Luk redigering' : 'Rediger økonomi'}
          </Button>
        ) : null}
      </div>

      <div className="space-y-2.5 border-t px-5 py-3">
        <div
          role="tablist"
          aria-label="Afgrøder"
          className="flex flex-wrap gap-1.5"
        >
          <button
            type="button"
            role="tab"
            aria-selected={!active}
            onClick={() => setActiveCode(null)}
            className={cn(
              CHOICE_TAB_CLASS,
              active ? CHOICE_TAB_IDLE_CLASS : CHOICE_TAB_ACTIVE_CLASS,
            )}
          >
            Alle afgrøder
          </button>
          {assumptions.crops.map((crop) => {
            const isActive = crop === active
            return (
              <button
                key={crop.cropCode}
                type="button"
                role="tab"
                aria-selected={isActive}
                onClick={() => setActiveCode(crop.cropCode)}
                className={cn(
                  CHOICE_TAB_CLASS,
                  isActive ? CHOICE_TAB_ACTIVE_CLASS : CHOICE_TAB_IDLE_CLASS,
                )}
              >
                <CropGroupTile
                  group={cropGroupFor(crop.cropCode, crop.cropName)}
                />
                {crop.cropName}
                {isCropCustomised(overrides, crop) ? (
                  <span className="font-normal text-muted-foreground">
                    (tilpasset)
                  </span>
                ) : null}
              </button>
            )
          })}
        </div>
        <p className="text-[13px] text-muted-foreground">
          {active ? (
            <>
              {active.cropName} har en forfrugtsværdi på{' '}
              <b className="font-semibold text-foreground">
                {formatNumber(active.precedingCropValueKgNHa)} kg N/ha
              </b>
              , som trækkes fra næste afgrødes kvælstofnorm.
            </>
          ) : canEdit ? (
            'Tallene er i kr/ha. Klik på en afgrøde for at se og rette dens priser og mængder.'
          ) : (
            'Tallene er i kr/ha. Klik på en afgrøde for at se dens priser og mængder.'
          )}
        </p>
      </div>

      {active ? (
        <CropTable
          assumptions={assumptions}
          overrides={overrides}
          crop={active}
          editing={editing}
          onOverridesChange={onOverridesChange}
          registerRow={registerRow}
        />
      ) : (
        <CropsOverview
          assumptions={assumptions}
          overrides={overrides}
          onOpenCrop={setActiveCode}
        />
      )}
    </section>
  )
}
