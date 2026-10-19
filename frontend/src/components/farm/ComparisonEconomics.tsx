import { useLocation } from 'react-router-dom'

import { useFarmBudgets } from '@/api/economics'
import type { FarmingSystem } from '@/api/types'
import {
  ComparisonColumnsTable,
  ComparisonFigureRow,
  type ComparedColumnsProps,
} from '@/components/farm/ComparisonColumnsTable'
import { useEconomicsProfiles } from '@/components/farm/economics-profiles-state'
import { ChangedValue } from '@/components/farm/economics-ui'
import { EconomicsChip } from '@/components/farm/EconomicsChip'
import { compareProfileChanges, formatCropNames } from '@/lib/economics'
import type { EconomicsProfile } from '@/lib/economics-profiles'

type ComparisonEconomicsProps = ComparedColumnsProps & {
  profiles: EconomicsProfile[]
  farmingSystems: FarmingSystem[]
}

export const ComparisonEconomics = ({
  profiles,
  farmingSystems,
  ...table
}: ComparisonEconomicsProps) => {
  const { farmId } = useEconomicsProfiles()
  const { search } = useLocation()
  const budgetsFor = (farmingSystem: FarmingSystem) =>
    farmingSystems.includes(farmingSystem) ? farmId : undefined
  const conventional = useFarmBudgets(budgetsFor('Konventionel'), {
    farmingSystem: 'Konventionel',
  }).data
  const organic = useFarmBudgets(budgetsFor('Økologisk'), {
    farmingSystem: 'Økologisk',
  }).data
  const columnBudgets = farmingSystems.map((system) =>
    system === 'Økologisk' ? organic : conventional,
  )
  const rows = columnBudgets.every((assumptions) => assumptions !== undefined)
    ? compareProfileChanges(
        profiles.map((profile, index) => ({
          assumptions: columnBudgets[index]!,
          overrides: profile.overrides,
        })),
      )
    : []

  return (
    <ComparisonColumnsTable {...table}>
      <ComparisonFigureRow label="Regner med" {...table}>
        {(_, index) => (
          <EconomicsChip
            profile={profiles[index]}
            farmingSystem={farmingSystems[index]}
            returnTo={{ kind: 'compare', search }}
          />
        )}
      </ComparisonFigureRow>
      {rows.map((row) => (
        <ComparisonFigureRow
          key={row.key}
          label={row.label}
          note={formatCropNames(row.cropNames)}
          {...table}
        >
          {(_, index) => (
            <span className="text-[13px] tabular-nums">
              {row.cells[index].changed ? (
                <ChangedValue>{row.cells[index].value}</ChangedValue>
              ) : (
                row.cells[index].value
              )}
            </span>
          )}
        </ComparisonFigureRow>
      ))}
    </ComparisonColumnsTable>
  )
}
