import { useId, type ReactNode } from 'react'

import { GRID_HEAD_CLASS, RestoreButton } from '@/components/farm/economics-ui'
import { EconomicsNumberField } from '@/components/farm/EconomicsNumberField'
import {
  CROSS_CROP_PRICE_GROUPS,
  crossCropPriceRows,
  formatEconomicsNumber,
  isPriceCustomised,
  parseEconomicsInput,
  parseNetPriceInput,
  priceValue,
  withPriceOverride,
  type CrossCropPriceGroup,
  type CrossCropPriceRow,
  type EconomicsAssumptions,
  type EconomicsInput,
  type EconomicsOverrides,
  type OverridesChange,
  type UnitPrice,
} from '@/lib/economics'
import { cn } from '@/lib/utils'

export const PRICES_GRID_CLASS =
  'grid grid-cols-[minmax(9rem,1fr)_8rem_11rem] items-center gap-x-4 px-5'

type PriceRowProps = {
  price: UnitPrice
  value: number
  label: string
  parse?: (text: string) => EconomicsInput
  // Without it the profile's price is shown, but cannot be changed.
  onCommit?: (value: number) => void
  children: ReactNode
}

export const PriceRow = ({
  price,
  value,
  label,
  parse,
  onCommit,
  children,
}: PriceRowProps) => (
  <div className={cn(PRICES_GRID_CLASS, 'py-2.5 text-[13px]')}>
    {children}
    <span className="text-right text-muted-foreground tabular-nums">
      {formatEconomicsNumber(price.valueDkk)} {price.unit}
    </span>
    <span className="flex items-start justify-end gap-1.5 leading-7 text-muted-foreground">
      {onCommit ? (
        <EconomicsNumberField
          value={value}
          standard={price.valueDkk}
          label={label}
          parse={parse}
          onCommit={onCommit}
        />
      ) : (
        <span className="text-foreground tabular-nums">
          {formatEconomicsNumber(value)}
        </span>
      )}
      <span>{price.unit}</span>
    </span>
  </div>
)

type GroupRowsProps = {
  assumptions: EconomicsAssumptions
  overrides: EconomicsOverrides
  title: string
  note: string
  rows: CrossCropPriceRow[]
  onChange?: (change: OverridesChange) => void
}

const GroupRows = ({
  assumptions,
  overrides,
  title,
  note,
  rows,
  onChange,
}: GroupRowsProps) => {
  const titleId = useId()

  return (
    <section aria-labelledby={titleId}>
      <div className="border-b px-5 pt-3.5 pb-2.5">
        <h3 id={titleId} className="text-[13px] font-semibold">
          {title}
        </h3>
        <p className="mt-0.5 max-w-2xl text-xs text-muted-foreground">{note}</p>
      </div>
      {rows.map(({ price, canBeNegative }) => {
        const commit = (value: number | null) =>
          onChange?.((current) =>
            withPriceOverride(assumptions, current, price.id, value),
          )
        return (
          <div key={price.id} className="border-b">
            <PriceRow
              price={price}
              value={priceValue(assumptions, overrides, price.id)}
              label={`Din pris for ${price.label} i ${price.unit}`}
              parse={canBeNegative ? parseNetPriceInput : parseEconomicsInput}
              onCommit={onChange ? commit : undefined}
            >
              <span className="flex min-w-0 items-center gap-1">
                <span className="min-w-0">{price.label}</span>
                {onChange && isPriceCustomised(overrides, price.id) ? (
                  <RestoreButton
                    label={price.label}
                    onRestore={() => commit(null)}
                  />
                ) : null}
              </span>
            </PriceRow>
          </div>
        )
      })}
    </section>
  )
}

type CrossCropPricesProps = {
  assumptions: EconomicsAssumptions
  overrides: EconomicsOverrides
  // All the groups unless the caller shows some of them elsewhere.
  groups?: readonly CrossCropPriceGroup[]
  onChange?: (change: OverridesChange) => void
}

export const CrossCropPrices = ({
  assumptions,
  overrides,
  groups,
  onChange,
}: CrossCropPricesProps) => {
  const rows = crossCropPriceRows(assumptions)

  return (
    <div className="overflow-x-auto">
      <div className="min-w-130">
        <div className={cn(PRICES_GRID_CLASS, GRID_HEAD_CLASS)}>
          <span>Post</span>
          <span className="text-right">Standardens pris</span>
          <span className="text-right">
            {onChange ? 'Din pris' : 'Profilens pris'}
          </span>
        </div>
        {CROSS_CROP_PRICE_GROUPS.map((group) => {
          const groupRows = rows.filter((row) => row.group === group.id)
          if (groupRows.length === 0) return null
          if (groups && !groups.includes(group.id)) return null
          return (
            <GroupRows
              key={group.id}
              assumptions={assumptions}
              overrides={overrides}
              title={group.title}
              note={group.note}
              rows={groupRows}
              onChange={onChange}
            />
          )
        })}
      </div>
    </div>
  )
}
