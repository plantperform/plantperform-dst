import { ChevronDown, ChevronRight, Link2, Undo2 } from 'lucide-react'
import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'

import { CropGroupTile } from '@/components/farm/CropGroupTile'
import {
  EconomicsNumberField,
  YieldPctField,
} from '@/components/farm/EconomicsNumberField'
import { useSharedPriceConfirm } from '@/components/farm/shared-price-confirm'
import { SharedPriceConfirm } from '@/components/farm/SharedPriceConfirm'
import { AppTooltip } from '@/components/ui/app-tooltip'
import { Button } from '@/components/ui/button'
import { cropGroupFor } from '@/lib/crop-groups'
import {
  COST_CATEGORIES,
  cropDbChange,
  cropSources,
  cropTotals,
  cropYieldPct,
  findPrice,
  formatDbDkk,
  formatEconomicsNumber,
  formatNameList,
  formatSignedDkk,
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
  priceUsage,
  priceValue,
  quantityUnitLabel,
  withoutCropChanges,
  withPriceOverride,
  withQuantityOverride,
  withYieldPct,
  YIELD_ADJUSTMENT_ID,
  yieldHint,
  type CropEconomics,
  type EconomicsAssumptions,
  type EconomicsGroupId,
  type EconomicsLine,
  type EconomicsOverrides,
  type IncomeShare,
  type OverridesChange,
} from '@/lib/economics'
import { formatNumber, formatWholeNumber } from '@/lib/field-domain'
import { cn } from '@/lib/utils'

type QuantityMode = 'editable' | 'fixed' | 'hidden'

type RegisterRow = (rowId: string, element: HTMLDivElement | null) => void

const ROW_CLASS =
  'grid grid-cols-[minmax(0,1fr)_auto_4.5rem] items-center gap-x-4 border-t py-2 pr-5 pl-11 text-[13px] focus:ring-2 focus:ring-ring focus:outline-none focus:ring-inset'

const HIGHLIGHT_CLASS = 'bg-primary/10'

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

const StaticValue = ({ children }: { children: ReactNode }) => (
  <span className="text-foreground tabular-nums">{children}</span>
)

type LineRowProps = {
  assumptions: EconomicsAssumptions
  overrides: EconomicsOverrides
  crop: CropEconomics
  line: EconomicsLine
  usage: number
  quantityMode: QuantityMode
  editable: boolean
  highlighted: boolean
  onChange: (change: OverridesChange) => void
  onPriceCommit: (priceId: string, value: number) => void
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
  highlighted,
  onChange,
  onPriceCommit,
  registerRow,
}: LineRowProps) => {
  const price = findPrice(assumptions, line.priceId)
  const quantity = lineQuantity(overrides, crop, line)
  const quantityUnit = quantityUnitLabel(line.quantityUnit, quantity)
  const unitPrice = priceValue(assumptions, overrides, line.priceId)
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
      className={cn(ROW_CLASS, highlighted && HIGHLIGHT_CLASS)}
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
      <div className="flex items-start justify-end gap-1.5 leading-7 whitespace-nowrap text-muted-foreground">
        {quantityMode === 'hidden' ? null : (
          <>
            {editable && quantityMode === 'editable' ? (
              <EconomicsNumberField
                value={quantity}
                label={`Mængden for ${line.label} i ${quantityUnit}`}
                customised={isQuantityCustomised(overrides, crop, line.id)}
                onCommit={(value) =>
                  onChange((current) =>
                    withQuantityOverride(current, crop, line.id, value),
                  )
                }
              />
            ) : (
              <StaticValue>{formatEconomicsNumber(quantity)}</StaticValue>
            )}
            <span>{quantityUnit}</span>
            <span className="px-0.5" aria-hidden="true">
              ×
            </span>
          </>
        )}
        {editable ? (
          <EconomicsNumberField
            value={unitPrice}
            label={`Stykprisen for ${line.label} i ${price?.unit ?? ''}`}
            customised={isPriceCustomised(overrides, line.priceId)}
            onCommit={(value) => onPriceCommit(line.priceId, value)}
          />
        ) : (
          <StaticValue>{formatEconomicsNumber(unitPrice)}</StaticValue>
        )}
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
  highlighted: boolean
  onChange: (change: OverridesChange) => void
  registerRow: RegisterRow
}

const YieldAdjustmentRow = ({
  overrides,
  crop,
  editable,
  highlighted,
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
      className={cn(ROW_CLASS, highlighted ? HIGHLIGHT_CLASS : 'bg-muted/40')}
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
        <p className="text-xs text-primary">{yieldHint(overrides, crop)}</p>
      </div>
      {editable ? (
        <YieldPctField
          pct={pct}
          cropName={crop.cropName}
          onCommit={changePct}
        />
      ) : (
        <span className="justify-self-end leading-7">
          <StaticValue>{formatYieldPct(pct)}</StaticValue>{' '}
          <span className="text-muted-foreground">%</span>
        </span>
      )}
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
  note?: string | null
  tone?: 'positive' | 'negative'
}

const KeyFigure = ({ label, value, note, tone }: KeyFigureProps) => (
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
    {note ? <dd className="text-[11px] tabular-nums">{note}</dd> : null}
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
  const sharedPrice = useSharedPriceConfirm(assumptions, change)
  const usage = useMemo(() => priceUsage(assumptions), [assumptions])
  const totals = cropTotals(assumptions, overrides, crop)
  const dbChange = cropDbChange(assumptions, overrides, crop)
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
          note={
            dbChange === 0
              ? null
              : `${formatSignedDkk(dbChange)} i forhold til Standard`
          }
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
                highlighted={focusLineId === YIELD_ADJUSTMENT_ID}
                onChange={change}
                registerRow={registerRow}
              />
            ) : null}
            {group.lines.map((line) => (
              <div key={line.id}>
                <LineRow
                  assumptions={assumptions}
                  overrides={overrides}
                  crop={crop}
                  line={line}
                  usage={usage.get(line.priceId) ?? 0}
                  quantityMode={group.quantityMode}
                  editable={editable}
                  highlighted={focusLineId === line.id}
                  onChange={change}
                  onPriceCommit={sharedPrice.commitPrice}
                  registerRow={registerRow}
                />
                {sharedPrice.pending?.priceId === line.priceId ? (
                  <div className="pr-5 pb-3 pl-11">
                    <SharedPriceConfirm
                      assumptions={assumptions}
                      overrides={overrides}
                      pending={sharedPrice.pending}
                      title={`Fælles pris for ${usage.get(line.priceId) ?? 0} afgrøder`}
                      onCancel={sharedPrice.cancel}
                      onConfirm={sharedPrice.confirm}
                    />
                  </div>
                ) : null}
              </div>
            ))}
          </Group>
        ))}
      </div>

      <p className="border-t px-5 py-2.5 text-[11px] text-muted-foreground">
        Kilde: {formatNameList(cropSources(assumptions, crop))}. Gødning er ikke
        med i omkostningerne, for den regnes ud fra kvælstofnormen i hver
        simulering.
      </p>
    </div>
  )
}
