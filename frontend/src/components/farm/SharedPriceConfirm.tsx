import type { ReactNode } from 'react'

import type { SharedPrice } from '@/components/farm/shared-price-confirm'
import { Button } from '@/components/ui/button'
import { cropLabel } from '@/lib/crop-label'
import {
  findPrice,
  formatCropCount,
  formatDbDkk,
  formatEconomicsNumber,
  formatSignedDkk,
  priceValue,
  sharedPriceEffect,
  type CropDbDelta,
  type CropTotals,
  type EconomicsAssumptions,
  type EconomicsOverrides,
} from '@/lib/economics'

type DbEffectsConfirmProps = {
  title: string
  description: ReactNode
  effects: CropDbDelta[]
  confirmLabel: string
  onConfirm: () => void
  onCancel: () => void
  className: string
}

export const DbEffectsConfirm = ({
  title,
  description,
  effects,
  confirmLabel,
  onConfirm,
  onCancel,
  className,
}: DbEffectsConfirmProps) => (
  <div className={className}>
    <div
      role="status"
      className="rounded-md border border-warning/40 bg-warning/10 px-3.5 py-3 text-[13px]"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <p className="font-semibold">{title}</p>
          <p className="mt-0.5">{description}</p>
        </div>
        <div className="flex shrink-0 gap-2">
          <Button type="button" variant="outline" size="xs" onClick={onCancel}>
            Fortryd
          </Button>
          <Button type="button" size="xs" onClick={onConfirm}>
            {confirmLabel}
          </Button>
        </div>
      </div>
      <EffectsTable effects={effects} />
    </div>
  </div>
)

type EffectColumn = {
  label: string
  figure: (totals: CropTotals) => number
  format: (value: number) => string
  always?: boolean
}

// The columns of the overview table; a column that no crop changes is left out.
const EFFECT_COLUMNS: EffectColumn[] = [
  { label: 'Indtægt', figure: (t) => t.revenueDkkHa, format: formatDbDkk },
  { label: 'Tilskud', figure: (t) => t.subsidyDkkHa, format: formatSignedDkk },
  {
    label: 'Omkostninger',
    figure: (t) => -t.totalCostsDkkHa,
    format: formatDbDkk,
  },
  {
    label: 'Dækningsbidrag',
    figure: (t) => t.dbDkkHa,
    format: formatDbDkk,
    always: true,
  },
]

const EffectsTable = ({ effects }: { effects: CropDbDelta[] }) => {
  const columns = EFFECT_COLUMNS.filter(
    (column) =>
      column.always ||
      effects.some(
        (effect) =>
          Math.round(column.figure(effect.before)) !==
          Math.round(column.figure(effect.after)),
      ),
  )
  const gridStyle = {
    gridTemplateColumns: `minmax(8rem,1fr) repeat(${columns.length}, minmax(7rem,auto))`,
  }

  return (
    <div className="mt-2 overflow-x-auto">
      <div
        className="grid items-baseline gap-x-4 text-xs text-muted-foreground"
        style={gridStyle}
      >
        <span>kr/ha</span>
        {columns.map((column) => (
          <span key={column.label} className="text-right">
            {column.label}
          </span>
        ))}
      </div>
      {effects.map((effect) => (
        <div
          key={effect.cropCode}
          className="grid items-baseline gap-x-4 pt-1 tabular-nums"
          style={gridStyle}
        >
          <span className="truncate">
            {cropLabel(effect.cropCode, effect.cropName)}
          </span>
          {columns.map((column) => {
            const before = column.figure(effect.before)
            const after = column.figure(effect.after)
            const changed = Math.round(before) !== Math.round(after)
            return (
              <span key={column.label} className="text-right">
                {changed ? (
                  <>
                    <span className="text-muted-foreground">
                      {column.format(before)} →{' '}
                    </span>
                    <span className="font-semibold">
                      {column.format(after)}
                    </span>
                  </>
                ) : (
                  <span className="text-muted-foreground">
                    {column.format(after)}
                  </span>
                )}
              </span>
            )
          })}
        </div>
      ))}
    </div>
  )
}

type SharedPriceConfirmProps = {
  assumptions: EconomicsAssumptions
  overrides: EconomicsOverrides
  sharedPrice: SharedPrice
  priceId: string
  className: string
}

export const SharedPriceConfirm = ({
  assumptions,
  overrides,
  sharedPrice,
  priceId,
  className,
}: SharedPriceConfirmProps) => {
  const { pending } = sharedPrice
  if (pending?.priceId !== priceId) return null
  const price = findPrice(assumptions, priceId)
  const effects = sharedPriceEffect(
    assumptions,
    overrides,
    priceId,
    pending.value,
  )
  const verb = pending.value === price?.valueDkk ? 'Gendan' : 'Ret'

  return (
    <DbEffectsConfirm
      title={`Fælles pris for ${formatCropCount(effects.length)}`}
      description={
        <>
          {formatEconomicsNumber(priceValue(assumptions, overrides, priceId))} →{' '}
          {formatEconomicsNumber(pending.value)} {price?.unit}. Dækningsbidraget
          ændres pr. ha:
        </>
      }
      effects={effects}
      confirmLabel={`${verb} for alle ${effects.length}`}
      onConfirm={sharedPrice.confirm}
      onCancel={sharedPrice.cancel}
      className={className}
    />
  )
}
