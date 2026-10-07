import { useState } from 'react'

import {
  priceCrops,
  withPriceOverride,
  type EconomicsAssumptions,
  type OverridesChange,
} from '@/lib/economics'

type PendingPrice = { priceId: string; value: number }

export const useSharedPriceConfirm = (
  assumptions: EconomicsAssumptions,
  onChange: (change: OverridesChange) => void,
) => {
  const [pending, setPending] = useState<PendingPrice | null>(null)
  const save = (price: PendingPrice) =>
    onChange((current) =>
      withPriceOverride(assumptions, current, price.priceId, price.value),
    )

  return {
    pending,
    shownPrice: (priceId: string, value: number) =>
      pending?.priceId === priceId ? pending.value : value,
    commitPrice: (priceId: string, value: number) => {
      if (priceCrops(assumptions, priceId).length > 1) {
        setPending({ priceId, value })
      } else {
        save({ priceId, value })
      }
    },
    confirm: () => {
      if (pending) save(pending)
      setPending(null)
    },
    cancel: () => setPending(null),
  }
}

export type SharedPrice = ReturnType<typeof useSharedPriceConfirm>
