import type { PendingPrice } from '@/components/farm/shared-price-confirm'
import { Button } from '@/components/ui/button'
import {
  findPrice,
  formatEconomicsNumber,
  formatNameList,
  formatSignedDkk,
  priceValue,
  sharedPriceEffect,
  type EconomicsAssumptions,
  type EconomicsOverrides,
} from '@/lib/economics'

type SharedPriceConfirmProps = {
  assumptions: EconomicsAssumptions
  overrides: EconomicsOverrides
  pending: PendingPrice
  title: string
  onCancel: () => void
  onConfirm: () => void
}

export const SharedPriceConfirm = ({
  assumptions,
  overrides,
  pending,
  title,
  onCancel,
  onConfirm,
}: SharedPriceConfirmProps) => {
  const effects = sharedPriceEffect(
    assumptions,
    overrides,
    pending.priceId,
    pending.value,
  )

  return (
    <div className="rounded-[10px] border border-amber-300 bg-amber-50 px-3.5 py-3 text-[13px]">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <p className="font-semibold">{title}</p>
          <p className="mt-0.5">
            {formatEconomicsNumber(
              priceValue(assumptions, overrides, pending.priceId),
            )}{' '}
            → {formatEconomicsNumber(pending.value)}{' '}
            {findPrice(assumptions, pending.priceId)?.unit} gælder for{' '}
            {formatNameList(effects.map((effect) => effect.cropName))}.
            Dækningsbidraget ændres pr. ha:
          </p>
        </div>
        <div className="flex shrink-0 gap-2">
          <Button type="button" variant="outline" size="xs" onClick={onCancel}>
            Fortryd
          </Button>
          <Button type="button" size="xs" onClick={onConfirm}>
            Ret for alle {effects.length}
          </Button>
        </div>
      </div>
      <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1 tabular-nums">
        {effects.map((effect) => (
          <li key={effect.cropName}>
            {effect.cropName}{' '}
            <span className="font-semibold">
              {formatSignedDkk(effect.deltaDkkHa)}
            </span>
          </li>
        ))}
      </ul>
    </div>
  )
}
