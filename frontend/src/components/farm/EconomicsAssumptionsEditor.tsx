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
import { useEconomics } from '@/components/farm/economics-context'
import {
  CollapseButton,
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
  economicsInputText,
  findPrice,
  formatEconomicsNumber,
  isCropCustomised,
  isPriceCustomised,
  isQuantityCustomised,
  lineAmountDkkHa,
  lineQuantity,
  parseEconomicsInput,
  priceUsage,
  priceValue,
  quantityUnitLabel,
  withPriceOverride,
  withQuantityOverride,
  type CropEconomics,
  type EconomicsAssumptions,
  type EconomicsLine,
  type EconomicsOverrides,
} from '@/lib/economics'
import { formatNumber, formatWholeNumber } from '@/lib/field-domain'
import { cn } from '@/lib/utils'

const ROW_GRID_CLASS =
  'grid grid-cols-[minmax(0,1fr)_9.5rem_0.75rem_9.5rem_5rem] items-start gap-x-3 px-5'

type NumberInputProps = {
  value: number
  unit: string
  label: string
  onChange: (value: number) => void
}

const NumberInput = ({ value, unit, label, onChange }: NumberInputProps) => {
  const errorId = useId()
  const [draft, setDraft] = useState<string | null>(null)
  const parsed = draft === null ? null : parseEconomicsInput(draft)
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
            const next = parseEconomicsInput(text)
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
}

const ValueCell = ({ editing, ...input }: ValueCellProps) =>
  editing ? (
    <NumberInput {...input} />
  ) : (
    <div className="flex items-baseline justify-end gap-1.5">
      <span className="w-20 px-2.5 text-right tabular-nums">
        {formatEconomicsNumber(input.value)}
      </span>
      <span className="w-16 text-xs text-muted-foreground">{input.unit}</span>
    </div>
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
  quantityEditable: boolean
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
  quantityEditable,
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
      className={cn(
        ROW_GRID_CLASS,
        'border-b py-2 text-[13px] focus:ring-2 focus:ring-ring focus:outline-none focus:ring-inset',
      )}
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
            <>
              {' · '}
              <button
                type="button"
                className="rounded-sm font-medium text-primary underline underline-offset-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                onClick={() => onRestore(line)}
              >
                Gendan standard
              </button>
            </>
          ) : null}
        </p>
      </div>
      {quantityEditable ? (
        <>
          <ValueCell
            editing={editing}
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
      ) : (
        <span className="col-span-2" aria-hidden="true" />
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

export const EconomicsAssumptionsEditor = () => {
  const id = useId()
  const {
    assumptions,
    overrides,
    setOverrides,
    focusRequest,
    clearFocusRequest,
  } = useEconomics()
  const [expanded, setExpanded] = useState(true)
  const [editing, setEditing] = useState(false)
  const [activeCode, setActiveCode] = useState<number | null>(null)
  const [restoreCount, setRestoreCount] = useState(0)
  const [shownFocus, setShownFocus] = useState<number | null>(null)
  const rowElements = useRef(new Map<string, HTMLDivElement>())
  const usage = useMemo(() => priceUsage(assumptions), [assumptions])

  if (focusRequest && focusRequest.nonce !== shownFocus) {
    setShownFocus(focusRequest.nonce)
    setExpanded(true)
    setActiveCode(focusRequest.cropCode)
  }

  useEffect(() => {
    if (!focusRequest) return
    const row = rowElements.current.get(focusRequest.lineId)
    row?.focus({ preventScroll: true })
    row?.scrollIntoView({ block: 'center' })
    clearFocusRequest()
  }, [focusRequest, clearFocusRequest])

  const registerRow = (lineId: string, element: HTMLDivElement | null) => {
    if (element) rowElements.current.set(lineId, element)
    else rowElements.current.delete(lineId)
  }

  const active =
    assumptions.crops.find((crop) => crop.cropCode === activeCode) ??
    assumptions.crops[0]
  if (!active) return null

  const totals = cropTotals(assumptions, overrides, active)

  const restore = (line: EconomicsLine) => {
    setOverrides((current) =>
      withPriceOverride(
        assumptions,
        withQuantityOverride(current, active, line.id, null),
        line.priceId,
        null,
      ),
    )
    setRestoreCount((count) => count + 1)
  }

  const renderLines = (lines: EconomicsLine[], quantityEditable = true) =>
    lines.map((line) => (
      <LineRow
        key={`${active.cropCode}:${line.id}:${restoreCount}`}
        assumptions={assumptions}
        overrides={overrides}
        crop={active}
        line={line}
        usage={usage.get(line.priceId) ?? 0}
        editing={editing}
        quantityEditable={quantityEditable}
        onOverridesChange={setOverrides}
        onRestore={restore}
        registerRow={registerRow}
      />
    ))

  return (
    <section
      className={cn(RULES_CARD_CLASS, 'overflow-hidden')}
      aria-labelledby={`${id}-title`}
    >
      <div className={RULES_CARD_HEAD_CLASS}>
        <div className="min-w-0">
          <h3 id={`${id}-title`} className="text-sm font-semibold">
            Økonomi
          </h3>
          <p className="mt-1 text-[13px] text-muted-foreground">
            Priser og mængder bag dækningsbidraget for hver afgrøde. Standarden
            er SEGES Budgetkalkuler 2026, og du kan rette den, så den passer til
            bedriften.
          </p>
          <p className="mt-1 text-[13px] text-amber-800">
            Eksempeldata for konventionel drift på JB 5-6. Ændringer gemmes ikke
            og indgår ikke i beregningen endnu.
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          <Button
            type="button"
            variant="outline"
            size="sm"
            aria-expanded={editing}
            onClick={() => {
              setEditing((current) => !current)
              setExpanded(true)
            }}
          >
            <Pencil className="size-3.5" aria-hidden="true" />
            {editing ? 'Luk redigering' : 'Rediger økonomi'}
          </Button>
          <CollapseButton
            expanded={expanded}
            controls={`${id}-content`}
            onExpandedChange={setExpanded}
          />
        </div>
      </div>

      {expanded ? (
        <div id={`${id}-content`}>
          <div className="space-y-2.5 border-t px-5 py-3">
            <div
              role="tablist"
              aria-label="Afgrøder"
              className="flex flex-wrap gap-1.5"
            >
              {assumptions.crops.map((crop) => {
                const isActive = crop.cropCode === active.cropCode
                return (
                  <button
                    key={crop.cropCode}
                    type="button"
                    role="tab"
                    aria-selected={isActive}
                    onClick={() => setActiveCode(crop.cropCode)}
                    className={cn(
                      CHOICE_TAB_CLASS,
                      isActive
                        ? CHOICE_TAB_ACTIVE_CLASS
                        : CHOICE_TAB_IDLE_CLASS,
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
              {active.cropName} har en forfrugtsværdi på{' '}
              <b className="font-semibold text-foreground">
                {formatNumber(active.precedingCropValueKgNHa)} kg N/ha
              </b>
              , som trækkes fra næste afgrødes kvælstofnorm.
            </p>
          </div>

          <div className="overflow-x-auto">
            <div className="min-w-176">
              <div
                className={cn(
                  ROW_GRID_CLASS,
                  'border-y bg-muted/30 py-2 text-xs font-semibold text-muted-foreground',
                )}
              >
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
                {renderLines(active.revenue)}
              </LineSection>

              <LineSection
                title="Tilskud"
                total={`+${formatWholeNumber(totals.subsidyDkkHa)}`}
              >
                {renderLines(active.subsidies, false)}
              </LineSection>

              {COST_CATEGORIES.filter(
                (category) => active.costs[category.id].length > 0,
              ).map((category) => (
                <LineSection
                  key={category.id}
                  title={category.label}
                  total={`−${formatWholeNumber(totals.costsDkkHa[category.id])}`}
                >
                  {renderLines(active.costs[category.id])}
                </LineSection>
              ))}

              <div className="flex items-start justify-between gap-3 bg-muted/30 px-5 py-2.5 text-[13px]">
                <div className="min-w-0">
                  <p className="font-semibold">Omkostninger i alt</p>
                  <p className="text-xs text-muted-foreground">
                    Gødning er ikke med her, for den regnes ud fra
                    kvælstofnormen i hver simulering.
                  </p>
                </div>
                <span className="shrink-0 font-semibold tabular-nums">
                  −{formatWholeNumber(totals.totalCostsDkkHa)}
                </span>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  )
}
