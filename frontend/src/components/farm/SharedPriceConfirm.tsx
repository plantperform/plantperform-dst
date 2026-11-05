import type { ReactNode } from 'react'

import type { SharedPrice } from '@/components/farm/shared-price-confirm'
import { Button } from '@/components/ui/button'
import { cropLabel } from '@/lib/crop-label'
import {
  findPrice,
  formatCropCount,
  formatEconomicsNumber,
  formatSignedDkk,
  priceValue,
  sharedPriceEffect,
  type CropDbDelta,
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
      <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1 tabular-nums">
        {effects.map((effect) => (
          <li key={effect.cropCode}>
            {cropLabel(effect.cropCode, effect.cropName)}{' '}
            <span className="font-semibold">
              {formatSignedDkk(effect.deltaDkkHa)}
            </span>
          </li>
        ))}
      </ul>
    </div>
  </div>
)

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
