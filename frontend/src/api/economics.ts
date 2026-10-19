import { useMemo } from 'react'
import useSWR from 'swr'

import { deleteJson, fetcher, patchJson, postJson } from '@/api/client'
import type {
  EconomicsModule,
  EconomicsOverrides,
  FarmingSystem,
  FarmMember,
  Simulation,
} from '@/api/types'
import {
  COST_CATEGORIES,
  type CostCategory,
  type EconomicsAssumptions,
  type EconomicsLine,
  type SoilVariant,
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
  soilVariants: Record<string, SoilVariant[]>
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
  soilVariants: budgets.soilVariants,
})

export const economicsModulesKey = '/economics-modules'

const modulePath = (moduleId: string) =>
  `${economicsModulesKey}/${encodeURIComponent(moduleId)}`

export const useEconomicsModules = () =>
  useSWR<EconomicsModule[]>(economicsModulesKey, fetcher, {
    revalidateOnFocus: false,
    revalidateOnReconnect: false,
  })

export const createEconomicsModule = (
  name: string,
  overrides: EconomicsOverrides,
) =>
  postJson<EconomicsModule, { name: string; overrides: EconomicsOverrides }>(
    economicsModulesKey,
    { name, overrides },
  )

export const updateEconomicsModule = (
  moduleId: string,
  input: {
    expectedRevision: number
    name?: string
    overrides?: EconomicsOverrides
  },
) => patchJson<EconomicsModule, typeof input>(modulePath(moduleId), input)

export const deleteEconomicsModule = (moduleId: string) =>
  deleteJson(modulePath(moduleId))

const membersPath = (moduleId: string) => `${modulePath(moduleId)}/members`

export const useEconomicsModuleMembers = (moduleId: string) =>
  useSWR<FarmMember[]>(membersPath(moduleId), fetcher)

const MODULES_MEMBERS_KEY = 'economics-modules-members'

const fetchModulesMembers = async (
  moduleIds: string[],
): Promise<Record<string, FarmMember[]>> =>
  Object.fromEntries(
    await Promise.all(
      moduleIds.map(async (moduleId) => {
        const members = await fetcher<FarmMember[]>(
          membersPath(moduleId),
        ).catch((): FarmMember[] => [])
        return [moduleId, members] as const
      }),
    ),
  )

export const useEconomicsModulesMembers = (moduleIds: string[]) =>
  useSWR<Record<string, FarmMember[]>>(
    moduleIds.length > 0
      ? [MODULES_MEMBERS_KEY, [...moduleIds].sort().join(',')]
      : null,
    ([, ids]: [string, string]) => fetchModulesMembers(ids.split(',')),
  )

export const addEconomicsModuleMember = (moduleId: string, email: string) =>
  postJson<FarmMember, { email: string }>(membersPath(moduleId), { email })

export const removeEconomicsModuleMember = (moduleId: string, email: string) =>
  deleteJson(`${membersPath(moduleId)}/${encodeURIComponent(email)}`)

const simulationEconomicsPath = (farmId: string, simulationId: string) =>
  `/farms/${encodeURIComponent(farmId)}/simulations/${encodeURIComponent(simulationId)}/economics`

export const selectSimulationEconomics = (
  farmId: string,
  simulation: Pick<Simulation, 'id' | 'revision'>,
  economicsModuleId: string,
) =>
  patchJson<
    Simulation,
    { expectedRevision: number; economicsModuleId: string }
  >(simulationEconomicsPath(farmId, simulation.id), {
    expectedRevision: simulation.revision,
    economicsModuleId,
  })

export const recalculateSimulationEconomics = (
  farmId: string,
  simulation: Pick<Simulation, 'id' | 'revision'>,
  requestId: string,
) =>
  postJson<Simulation, { expectedRevision: number; requestId: string }>(
    `${simulationEconomicsPath(farmId, simulation.id)}/recalculate`,
    { expectedRevision: simulation.revision, requestId },
  )

export const retrySimulationEconomics = (
  farmId: string,
  simulationId: string,
) =>
  postJson<Simulation, Record<string, never>>(
    `${simulationEconomicsPath(farmId, simulationId)}/recalculate/retry`,
    {},
  )

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
