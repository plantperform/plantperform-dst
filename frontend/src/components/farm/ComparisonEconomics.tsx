import { Fragment, useState } from 'react'
import { useLocation } from 'react-router-dom'

import { useFarmBudgets } from '@/api/economics'
import type { EconomicsStatement, FarmingSystem } from '@/api/types'
import {
  ComparisonColumnsTable,
  ComparisonFigureRow,
  type ComparedColumnsProps,
} from '@/components/farm/ComparisonColumnsTable'
import { useEconomicsProfiles } from '@/components/farm/economics-profiles-state'
import { ChangedValue } from '@/components/farm/economics-ui'
import { EconomicsChip } from '@/components/farm/EconomicsChip'
import {
  SegmentedControl,
  type SegmentedControlOption,
} from '@/components/ui/segmented-control'
import { compareProfileChanges, formatCropLabels } from '@/lib/economics'
import {
  STANDARD_PROFILE_ID,
  type EconomicsProfile,
} from '@/lib/economics-profiles'
import {
  formatStatementLine,
  STATEMENT_GROUPS,
  STATEMENT_RESULT,
  STATEMENT_UNIT_LABELS,
  type StatementLine,
  type StatementUnit,
} from '@/lib/simulation-comparison'
import { cn } from '@/lib/utils'

const UNIT_OPTIONS = (['perHa', 'total'] as const).map(
  (value): SegmentedControlOption<StatementUnit> => ({
    value,
    label: STATEMENT_UNIT_LABELS[value],
    activeClassName: 'text-foreground',
  }),
)

const FIGURE_CLASS = 'text-right text-[13px] tabular-nums'
const BAND_CLASS = 'bg-muted/30 hover:bg-muted/30'
const RESULT_CELL_CLASS = 'border-t-2 border-t-foreground/70 py-3'

const LINE_ROW = {
  className: 'border-0',
  labelClassName: 'py-2 pl-8',
  cellClassName: cn(FIGURE_CLASS, 'py-2'),
}
const TOTAL_ROW = {
  className: 'border-t border-border',
  labelClassName: 'py-2 font-semibold',
  cellClassName: cn(FIGURE_CLASS, 'py-2 font-semibold'),
}
const RESULT_ROW = {
  className: BAND_CLASS,
  labelClassName: cn(RESULT_CELL_CLASS, 'font-semibold'),
  cellClassName: cn(
    FIGURE_CLASS,
    RESULT_CELL_CLASS,
    'font-display text-lg leading-tight',
  ),
}

type ComparisonEconomicsProps = ComparedColumnsProps & {
  profiles: EconomicsProfile[]
  farmingSystems: FarmingSystem[]
  statements: (EconomicsStatement | null | undefined)[]
}

export const ComparisonEconomics = ({
  profiles,
  farmingSystems,
  statements,
  ...table
}: ComparisonEconomicsProps) => {
  const { farmId } = useEconomicsProfiles()
  const { search } = useLocation()
  const [unit, setUnit] = useState<StatementUnit>('perHa')
  const customised = profiles.some(
    (profile) => profile.id !== STANDARD_PROFILE_ID,
  )
  const budgetsFor = (farmingSystem: FarmingSystem) =>
    customised && farmingSystems.includes(farmingSystem) ? farmId : undefined
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

  const statementRow = (line: StatementLine, style: typeof LINE_ROW) => (
    <ComparisonFigureRow
      key={line.label}
      label={line.label}
      {...style}
      {...table}
    >
      {(_, index) => {
        const statement = statements[index]
        return statement ? formatStatementLine(statement, line, unit) : null
      }}
    </ComparisonFigureRow>
  )

  return (
    <>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <h2 className="pt-1 font-display text-[22px] leading-tight">
          Økonomi i simuleringerne
        </h2>
        <SegmentedControl
          aria-label="Vis økonomien i kr/ha eller kr i alt"
          value={unit}
          options={UNIT_OPTIONS}
          labelClassName=""
          onValueChange={setUnit}
        />
      </div>
      <ComparisonColumnsTable
        compact
        label={`Gennemsnit pr. år, ${STATEMENT_UNIT_LABELS[unit]}`}
        {...table}
      >
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
            note={row.appliesTo ?? formatCropLabels(row.cropLabels)}
            cellClassName={FIGURE_CLASS}
            {...table}
          >
            {(_, index) =>
              row.cells[index].changed ? (
                <ChangedValue>{row.cells[index].value}</ChangedValue>
              ) : (
                row.cells[index].value
              )
            }
          </ComparisonFigureRow>
        ))}
        {STATEMENT_GROUPS.map((group, groupIndex) => (
          <Fragment key={group.label}>
            <ComparisonFigureRow
              label={group.label}
              className={cn('border-y', BAND_CLASS)}
              labelClassName="py-2 font-display text-[15px]"
              {...table}
            >
              {(_, index) =>
                groupIndex === 0 && !statements[index] ? (
                  <span className="text-xs text-muted-foreground">
                    Kør Optimér igen for at se regnskabet.
                  </span>
                ) : null
              }
            </ComparisonFigureRow>
            {group.lines.map((line) => statementRow(line, LINE_ROW))}
            {statementRow(group.total, TOTAL_ROW)}
          </Fragment>
        ))}
        {statementRow(STATEMENT_RESULT, RESULT_ROW)}
      </ComparisonColumnsTable>
    </>
  )
}
