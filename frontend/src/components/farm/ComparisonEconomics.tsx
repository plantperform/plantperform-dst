import { useLocation } from 'react-router-dom'

import {
  ComparisonColumnsTable,
  ComparisonFigureRow,
} from '@/components/farm/ComparisonColumnsTable'
import {
  completeFigure,
  type ComparedColumn,
  type OnHighlight,
} from '@/components/farm/comparison-column'
import { useEconomicsNavigation } from '@/components/farm/economics-navigation'
import { useEconomicsProfiles } from '@/components/farm/economics-profiles-state'
import { EconomicsChip } from '@/components/farm/EconomicsChip'
import { ChangedValue } from '@/components/farm/EconomicsProfileChanges'
import { TableCell, TableRow } from '@/components/ui/table'
import {
  compareProfileChanges,
  formatNameList,
  profileChanges,
} from '@/lib/economics'
import { STANDARD_PROFILE, STANDARD_PROFILE_ID } from '@/lib/economics-profiles'
import { formatPerHa, totalsPerHa } from '@/lib/field-domain'

const VALUE_CLASS = 'text-[13px] tabular-nums'

type ComparisonEconomicsProps = {
  columns: ComparedColumn[]
  highlightedKey: string | null
  onHighlight: OnHighlight
}

export const ComparisonEconomics = ({
  columns,
  highlightedKey,
  onHighlight,
}: ComparisonEconomicsProps) => {
  const economics = useEconomicsProfiles()
  const { startGuide } = useEconomicsNavigation()
  const { search } = useLocation()
  const profiles = columns.map((column) =>
    column.history
      ? STANDARD_PROFILE
      : economics.profileForSimulation(column.key),
  )

  if (profiles.every((profile) => profile.id === STANDARD_PROFILE_ID)) {
    return (
      <p className="rounded-lg border bg-card px-4.5 py-4 text-sm text-muted-foreground">
        Alle simuleringer regner med {STANDARD_PROFILE.name}.{' '}
        <button
          type="button"
          className="rounded-sm font-medium text-primary underline underline-offset-2 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
          onClick={() => startGuide({ fromProfileId: STANDARD_PROFILE_ID })}
        >
          Tilpas økonomien til bedriften
        </button>
      </p>
    )
  }

  const rows = compareProfileChanges(
    profiles.map((profile) =>
      profileChanges(economics.assumptions, profile.overrides),
    ),
  )
  const table = { columns, highlightedKey, onHighlight }

  return (
    <ComparisonColumnsTable {...table}>
      <ComparisonFigureRow
        label={<span className="text-muted-foreground">Økonomiprofil</span>}
        {...table}
      >
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
          label={<span className="font-medium">{row.label}</span>}
          note={formatNameList(row.cropNames)}
          {...table}
        >
          {(_, index) => (
            <span className={VALUE_CLASS}>
              {row.cells[index].changed ? (
                <ChangedValue>{row.cells[index].value}</ChangedValue>
              ) : (
                row.cells[index].value
              )}
            </span>
          )}
        </ComparisonFigureRow>
      ))}
      <ComparisonFigureRow
        label={<span className="font-medium">Dækningsbidrag med Standard</span>}
        {...table}
      >
        {(column) => {
          const db2PerHa = completeFigure(
            column,
            totalsPerHa(column.totals, 'db2'),
          )
          return (
            <span className={VALUE_CLASS}>
              {db2PerHa === null ? '-' : formatPerHa(db2PerHa, 'db2')}
            </span>
          )
        }}
      </ComparisonFigureRow>
      <ComparisonFigureRow
        label={<span className="font-semibold">Økonomiens bidrag</span>}
        {...table}
      >
        {() => <span className="text-[13px] text-muted-foreground">-</span>}
      </ComparisonFigureRow>
      <TableRow className="hover:bg-transparent">
        <TableCell
          colSpan={columns.length + 1}
          className="bg-muted/30 px-4.5 py-2.5 text-xs whitespace-normal text-amber-800"
        >
          Profilerne indgår ikke i beregningen endnu, så alle dækningsbidrag er
          regnet med {STANDARD_PROFILE.name}.
        </TableCell>
      </TableRow>
    </ComparisonColumnsTable>
  )
}
