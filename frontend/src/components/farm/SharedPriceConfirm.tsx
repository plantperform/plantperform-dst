import type { SharedPrice } from '@/components/farm/shared-price-confirm'
import { Button } from '@/components/ui/button'
import {
  findPrice,
  formatCropCount,
  formatEconomicsNumber,
  formatSignedDkk,
  priceValue,
  sharedPriceEffect,
  type EconomicsAssumptions,
  type EconomicsOverrides,
} from '@/lib/economics'

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
  const effects = sharedPriceEffect(
    assumptions,
    overrides,
    priceId,
    pending.value,
  )

  return (
    <div className={className}>
      <div
        role="status"
        className="rounded-md border border-amber-300 bg-amber-50 px-3.5 py-3 text-[13px]"
      >
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <p className="font-semibold">
              Fælles pris for {formatCropCount(effects.length)}
            </p>
            <p className="mt-0.5">
              {formatEconomicsNumber(
                priceValue(assumptions, overrides, priceId),
              )}{' '}
              → {formatEconomicsNumber(pending.value)}{' '}
              {findPrice(assumptions, priceId)?.unit}. Dækningsbidraget ændres
              pr. ha:
            </p>
          </div>
          <div className="flex shrink-0 gap-2">
            <Button
              type="button"
              variant="outline"
              size="xs"
              onClick={sharedPrice.cancel}
            >
              Fortryd
            </Button>
            <Button type="button" size="xs" onClick={sharedPrice.confirm}>
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
    </div>
  )
}
