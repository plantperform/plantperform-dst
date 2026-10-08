import { useLocation } from 'react-router-dom'

import {
  ComparisonColumnsTable,
  ComparisonFigureRow,
  type ComparedColumnsProps,
} from '@/components/farm/ComparisonColumnsTable'
import { useEconomicsProfiles } from '@/components/farm/economics-profiles-state'
import { ChangedValue } from '@/components/farm/economics-ui'
import { EconomicsChip } from '@/components/farm/EconomicsChip'
import { TableCell, TableRow } from '@/components/ui/table'
import {
  compareProfileChanges,
  formatNameList,
  profileChanges,
} from '@/lib/economics'
import {
  STANDARD_PROFILE,
  type EconomicsProfile,
} from '@/lib/economics-profiles'

type ComparisonEconomicsProps = ComparedColumnsProps & {
  profiles: EconomicsProfile[]
}

export const ComparisonEconomics = ({
  profiles,
  ...table
}: ComparisonEconomicsProps) => {
  const { assumptions } = useEconomicsProfiles()
  const { search } = useLocation()
  const rows = compareProfileChanges(
    profiles.map((profile) => profileChanges(assumptions, profile.overrides)),
  )

  return (
    <ComparisonColumnsTable {...table}>
      <ComparisonFigureRow label="Økonomiprofil" {...table}>
        {(_, index) => (
          <EconomicsChip
            profile={profiles[index]}
            returnTo={{ kind: 'compare', search }}
          />
        )}
      </ComparisonFigureRow>
      {rows.map((row) => (
        <ComparisonFigureRow
          key={row.key}
          label={row.label}
          note={formatNameList(row.cropNames)}
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
      <TableRow className="hover:bg-transparent">
        <TableCell
          colSpan={profiles.length + 1}
          className="bg-muted/30 px-4.5 py-2.5 text-xs whitespace-normal text-warning-strong"
        >
          Profilerne indgår ikke i beregningen endnu, så alle dækningsbidrag er
          regnet med {STANDARD_PROFILE.name}.
        </TableCell>
      </TableRow>
    </ComparisonColumnsTable>
  )
}
