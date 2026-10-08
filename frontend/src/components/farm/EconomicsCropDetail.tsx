import { ChevronDown, ChevronRight, Link2, Undo2 } from 'lucide-react'
import { useEffect, useId, useRef, useState, type ReactNode } from 'react'

import { CropGroupTile } from '@/components/farm/CropGroupTile'
import { CustomisedDot, RestoreButton } from '@/components/farm/economics-ui'
import {
  EconomicsNumberField,
  YieldPctField,
} from '@/components/farm/EconomicsNumberField'
import { KeyFigure } from '@/components/farm/OverviewCard'
import {
  useSharedPriceConfirm,
  type SharedPrice,
} from '@/components/farm/shared-price-confirm'
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
  FERTILISER_NOTE,
  findPrice,
  formatCropCount,
  formatDbDkk,
  formatEconomicsNumber,
  formatNameList,
  formatSignedDkk,
  isCropCustomised,
  isLineCustomised,
  isYieldCustomised,
  lineAmountDkkHa,
  lineGroupId,
  lineQuantity,
  priceCrops,
  priceValue,
  quantityUnitLabel,
  withoutCropChanges,
  withPriceOverride,
  withQuantityOverride,
  withYieldPct,
  YIELD_ADJUSTMENT_ID,
  YIELD_ADJUSTMENT_LABEL,
  type CropEconomics,
  type EconomicsAssumptions,
  type EconomicsGroupId,
  type EconomicsLine,
  type EconomicsOverrides,
  type OverridesChange,
} from '@/lib/economics'
import { formatNumber } from '@/lib/field-domain'
import { cn } from '@/lib/utils'

type QuantityMode = 'editable' | 'fixed' | 'hidden'

const ROW_CLASS =
  'grid grid-cols-[minmax(0,1fr)_4.5rem] items-center gap-x-4 gap-y-1 border-t py-2 pr-5 pl-11 text-[13px] focus:ring-2 focus:ring-ring focus:outline-none focus:ring-inset @lg:grid-cols-[minmax(0,1fr)_auto_4.5rem]'

const ROW_LABEL_CLASS = 'col-span-2 min-w-0 @lg:col-span-1'

const HIGHLIGHT_CLASS = 'bg-primary/10'

const useFocusedRow = (highlighted: boolean) => {
  const row = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!highlighted) return
    row.current?.focus({ preventScroll: true })
    row.current?.scrollIntoView({ block: 'center' })
  }, [highlighted])

  return row
}

const StaticValue = ({ children }: { children: ReactNode }) => (
  <span className="text-foreground tabular-nums">{children}</span>
)

type LineRowProps = {
  assumptions: EconomicsAssumptions
  overrides: EconomicsOverrides
  crop: CropEconomics
  line: EconomicsLine
  quantityMode: QuantityMode
  highlighted: boolean
  sharedPrice: SharedPrice
  onChange?: (change: OverridesChange) => void
}

const LineRow = ({
  assumptions,
  overrides,
  crop,
  line,
  quantityMode,
  highlighted,
  sharedPrice,
  onChange,
}: LineRowProps) => {
  const row = useFocusedRow(highlighted)
  const price = findPrice(assumptions, line.priceId)
  const quantity = lineQuantity(overrides, crop, line)
  const quantityUnit = quantityUnitLabel(line.quantityUnit, quantity)
  const unitPrice = priceValue(assumptions, overrides, line.priceId)
  const sharedBy = priceCrops(assumptions, line.priceId).length

  return (
    <div
      ref={row}
      tabIndex={highlighted ? -1 : undefined}
      className={cn(ROW_CLASS, highlighted && HIGHLIGHT_CLASS)}
    >
      <div
        className={cn(
          ROW_LABEL_CLASS,
          'flex flex-wrap items-center gap-x-1.5 gap-y-0.5',
        )}
      >
        <span>{line.label}</span>
        {sharedBy > 1 ? (
          <AppTooltip content={`Fælles pris for ${formatCropCount(sharedBy)}`}>
            <span className="inline-flex text-muted-foreground">
              <Link2 className="size-3.5" aria-hidden="true" />
              <span className="sr-only">
                Fælles pris for {formatCropCount(sharedBy)}
              </span>
            </span>
          </AppTooltip>
        ) : null}
        {onChange && isLineCustomised(overrides, crop, line) ? (
          <RestoreButton
            label={line.label}
            onRestore={() =>
              onChange((current) =>
                withPriceOverride(
                  assumptions,
                  withQuantityOverride(current, crop, line.id, null),
                  line.priceId,
                  null,
                ),
              )
            }
          />
        ) : null}
      </div>
      <div className="flex items-start justify-end gap-1.5 leading-7 whitespace-nowrap text-muted-foreground">
        {quantityMode === 'hidden' ? null : (
          <>
            {onChange && quantityMode === 'editable' ? (
              <EconomicsNumberField
                value={quantity}
                standard={line.quantity}
                label={`Mængden for ${line.label} i ${quantityUnit}`}
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
        {onChange ? (
          <EconomicsNumberField
            value={sharedPrice.shownPrice(line.priceId, unitPrice)}
            standard={price?.valueDkk ?? 0}
            label={`Stykprisen for ${line.label} i ${price?.unit ?? ''}`}
            onCommit={(value) => sharedPrice.commitPrice(line.priceId, value)}
          />
        ) : (
          <StaticValue>{formatEconomicsNumber(unitPrice)}</StaticValue>
        )}
        <span>{price?.unit}</span>
      </div>
      <span className="text-right tabular-nums">
        {formatDbDkk(lineAmountDkkHa(assumptions, overrides, crop, line))}
      </span>
    </div>
  )
}

type YieldAdjustmentRowProps = {
  overrides: EconomicsOverrides
  crop: CropEconomics
  highlighted: boolean
  onChange: (change: OverridesChange) => void
}

const YieldAdjustmentRow = ({
  overrides,
  crop,
  highlighted,
  onChange,
}: YieldAdjustmentRowProps) => {
  const row = useFocusedRow(highlighted)
  const changePct = (value: number | null) =>
    onChange((current) => withYieldPct(current, crop, value))

  return (
    <div
      ref={row}
      tabIndex={highlighted ? -1 : undefined}
      className={cn(ROW_CLASS, highlighted ? HIGHLIGHT_CLASS : 'bg-muted/40')}
    >
      <div className={ROW_LABEL_CLASS}>
        <div className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5">
          <span>{YIELD_ADJUSTMENT_LABEL}</span>
          {isYieldCustomised(overrides, crop) ? (
            <RestoreButton
              label={YIELD_ADJUSTMENT_LABEL}
              onRestore={() => changePct(null)}
            />
          ) : null}
        </div>
        <p className="text-xs text-muted-foreground">
          Lægges oven på hver marks eget udbytte, som afhænger af jordtype og
          vanding.
        </p>
      </div>
      <YieldPctField
        pct={cropYieldPct(overrides, crop)}
        cropName={crop.cropName}
        onCommit={changePct}
      />
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

type EconomicsCropDetailProps = {
  assumptions: EconomicsAssumptions
  overrides: EconomicsOverrides
  crop: CropEconomics
  onOverridesChange?: (change: OverridesChange) => void
  focusLineId?: string
}

export const EconomicsCropDetail = ({
  assumptions,
  overrides,
  crop,
  onOverridesChange,
  focusLineId,
}: EconomicsCropDetailProps) => {
  const sharedPrice = useSharedPriceConfirm(assumptions, (change) =>
    onOverridesChange?.(change),
  )
  const totals = cropTotals(assumptions, overrides, crop)
  const dbChange = cropDbChange(assumptions, overrides, crop)
  const [openGroups, setOpenGroups] = useState<ReadonlySet<EconomicsGroupId>>(
    () => {
      const focused = focusLineId ? lineGroupId(crop, focusLineId) : null
      return new Set(focused ? ['revenue', focused] : ['revenue'])
    },
  )

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
      total: formatDbDkk(totals.revenueDkkHa),
      lines: crop.revenue,
      quantityMode: 'fixed',
    },
    {
      id: 'subsidy',
      title: 'Tilskud',
      total: formatSignedDkk(totals.subsidyDkkHa),
      lines: crop.subsidies,
      quantityMode: 'hidden',
    },
    ...COST_CATEGORIES.filter(
      (category) => crop.costs[category.id].length > 0,
    ).map((category) => ({
      id: category.id,
      title: category.label,
      total: formatDbDkk(-totals.costsDkkHa[category.id]),
      lines: crop.costs[category.id],
      quantityMode: (category.id === 'fertiliser'
        ? 'fixed'
        : 'editable') as QuantityMode,
    })),
  ]

  return (
    <div className="@container">
      <div className="flex flex-wrap items-start gap-3 px-5 pt-4 pb-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <CropGroupTile group={cropGroupFor(crop.cropCode, crop.cropName)} />
            <h2 className="text-base font-semibold">{crop.cropName}</h2>
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            Forfrugtsværdi {formatNumber(crop.precedingCropValueKgNHa)} kg N/ha
            · tal i kr/ha for JB 5-6
          </p>
        </div>
        {onOverridesChange && isCropCustomised(overrides, crop) ? (
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() =>
              onOverridesChange((current) =>
                withoutCropChanges(assumptions, current, crop),
              )
            }
          >
            <Undo2 className="size-3.5" aria-hidden="true" />
            Gendan standard
          </Button>
        ) : null}
      </div>

      <div className="grid grid-cols-2 gap-4 px-5 pb-1 @xl:grid-cols-4">
        <KeyFigure
          label="Indtægt"
          figure={{ value: formatDbDkk(totals.revenueDkkHa) }}
        />
        <KeyFigure
          label="Tilskud"
          figure={{ value: formatSignedDkk(totals.subsidyDkkHa) }}
        />
        <KeyFigure
          label="Omkostninger"
          figure={{ value: formatDbDkk(-totals.totalCostsDkkHa) }}
        />
        <KeyFigure
          label="Dækningsbidrag"
          figure={{ value: formatDbDkk(totals.dbDkkHa) }}
          note={
            dbChange === 0
              ? null
              : `${formatSignedDkk(dbChange)} i forhold til Standard`
          }
        />
      </div>

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
            {group.id === 'revenue' &&
            onOverridesChange &&
            crop.revenue.length > 0 ? (
              <YieldAdjustmentRow
                overrides={overrides}
                crop={crop}
                highlighted={focusLineId === YIELD_ADJUSTMENT_ID}
                onChange={onOverridesChange}
              />
            ) : null}
            {group.lines.map((line) => (
              <div key={line.id}>
                <LineRow
                  assumptions={assumptions}
                  overrides={overrides}
                  crop={crop}
                  line={line}
                  quantityMode={group.quantityMode}
                  highlighted={focusLineId === line.id}
                  sharedPrice={sharedPrice}
                  onChange={onOverridesChange}
                />
                <SharedPriceConfirm
                  assumptions={assumptions}
                  overrides={overrides}
                  sharedPrice={sharedPrice}
                  priceId={line.priceId}
                  className="pr-5 pb-3 pl-11"
                />
              </div>
            ))}
          </Group>
        ))}
      </div>

      <p className="border-t px-5 py-2.5 text-[11px] text-muted-foreground">
        Kilde: {formatNameList(cropSources(assumptions, crop))}.{' '}
        {FERTILISER_NOTE}
      </p>
    </div>
  )
}
