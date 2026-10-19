import { useMemo } from 'react'
import useSWR from 'swr'

import { fetcher } from '@/api/client'
import type { FarmingSystem } from '@/api/types'
import {
  COST_CATEGORIES,
  type CostCategory,
  type EconomicsAssumptions,
  type EconomicsLine,
} from '@/lib/economics'

type BudgetLine = Omit<EconomicsLine, 'id' | 'priceId'> & {
  category: string
  priceId: string | null
}

type CropBudget = {
  cropCode: number
  cropName: string
  precedingCropValueKgNHa: number
  revenue: BudgetLine[]
  subsidies: BudgetLine[]
  costs: BudgetLine[]
}

type CropBudgets = {
  jbNr: number | null
  farmingSystem: FarmingSystem
  prices: {
    id: string
    label: string
    unit: string
    value: number
    source: string | null
  }[]
  crops: CropBudget[]
}

type BudgetScope = { farmingSystem: FarmingSystem } | { simulationId: string }

const farmBudgetsKey = (farmId: string | undefined, scope: BudgetScope) => {
  if (!farmId) return null
  const query =
    'simulationId' in scope
      ? `simulationId=${encodeURIComponent(scope.simulationId)}`
      : `farmingSystem=${encodeURIComponent(scope.farmingSystem)}`
  return `/farms/${encodeURIComponent(farmId)}/economics/budgets?${query}`
}

const toLines = (lines: BudgetLine[]): EconomicsLine[] =>
  lines.flatMap((line) =>
    line.priceId === null
      ? []
      : [
          {
            id: line.quantityId ?? line.priceId,
            label: line.label,
            quantity: line.quantity,
            quantityUnit: line.quantityUnit,
            quantityId: line.quantityId,
            priceId: line.priceId,
            followsYield: line.followsYield,
          },
        ],
  )

const toAssumptions = (budgets: CropBudgets): EconomicsAssumptions => ({
  soilTypeNumber: budgets.jbNr,
  farmingSystem: budgets.farmingSystem,
  prices: budgets.prices.map(({ value, ...price }) => ({
    ...price,
    valueDkk: value,
  })),
  crops: budgets.crops.map((crop) => ({
    cropCode: crop.cropCode,
    cropName: crop.cropName,
    precedingCropValueKgNHa: crop.precedingCropValueKgNHa,
    revenue: toLines(crop.revenue),
    subsidies: toLines(crop.subsidies),
    costs: Object.fromEntries(
      COST_CATEGORIES.map(({ id, label }) => [
        id,
        toLines(crop.costs.filter((line) => line.category === label)),
      ]),
    ) as Record<CostCategory, EconomicsLine[]>,
  })),
})

export const useFarmBudgets = (
  farmId: string | undefined,
  scope: BudgetScope,
) => {
  const response = useSWR<CropBudgets>(farmBudgetsKey(farmId, scope), fetcher, {
    revalidateOnFocus: false,
  })
  const data = useMemo(
    () => (response.data ? toAssumptions(response.data) : undefined),
    [response.data],
  )
  return { ...response, data }
}
