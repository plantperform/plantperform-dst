import { useState } from 'react'

import {
  findPrice,
  priceCrops,
  withPriceOverride,
  type EconomicsAssumptions,
  type OverridesChange,
} from '@/lib/economics'

type PendingPrice = {
  priceId: string
  value: number
  alongside?: OverridesChange
}

export const useSharedPriceConfirm = (
  assumptions: EconomicsAssumptions,
  onChange: (change: OverridesChange) => void,
) => {
  const [pending, setPending] = useState<PendingPrice | null>(null)
  const save = ({ priceId, value, alongside }: PendingPrice) =>
    onChange((current) =>
      withPriceOverride(
        assumptions,
        alongside ? alongside(current) : current,
        priceId,
        value,
      ),
    )
  const commitPrice = (
    priceId: string,
    value: number,
    alongside?: OverridesChange,
  ) => {
    const price = { priceId, value, alongside }
    if (priceCrops(assumptions, priceId).length > 1) {
      setPending(price)
    } else {
      save(price)
    }
  }

  return {
    pending,
    shownPrice: (priceId: string, value: number) =>
      pending?.priceId === priceId ? pending.value : value,
    commitPrice,
    restorePrice: (priceId: string, alongside?: OverridesChange) => {
      const standard = findPrice(assumptions, priceId)
      if (standard) commitPrice(priceId, standard.valueDkk, alongside)
    },
    confirm: () => {
      if (pending) save(pending)
      setPending(null)
    },
    cancel: () => setPending(null),
  }
}

export type SharedPrice = ReturnType<typeof useSharedPriceConfirm>
