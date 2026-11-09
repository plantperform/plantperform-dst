import { ChevronRight } from 'lucide-react'
import { Fragment, useState } from 'react'
import { useLocation } from 'react-router-dom'

import type { EconomicsStatement, FarmingSystem } from '@/api/types'
import {
  ComparisonColumnsTable,
  ComparisonFigureRow,
  type ComparedColumnsProps,
} from '@/components/farm/ComparisonColumnsTable'
import { EconomicsChip } from '@/components/farm/EconomicsChip'
import {
  SegmentedControl,
  type SegmentedControlOption,
} from '@/components/ui/segmented-control'
import { cropLabel } from '@/lib/crop-label'
import type { EconomicsProfile } from '@/lib/economics-profiles'
import {
  formatStatementLine,
  hasStatementPeriods,
  STATEMENT_AVERAGE_PERIOD,
  STATEMENT_GROUPS,
  STATEMENT_PERIODS,
  STATEMENT_RESULT,
  STATEMENT_UNIT_LABELS,
  statementCropRows,
  statementFigures,
  statementPeriodLabel,
  statementPostRows,
  type StatementLine,
  type StatementPeriod,
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

type StatementBreakdown = 'crop' | 'post'

// What a line unfolds into: the crops it comes from or its regnskabsposter.
const BREAKDOWN_OPTIONS: SegmentedControlOption<StatementBreakdown>[] = [
  { value: 'crop', label: 'Afgrøder', activeClassName: 'text-foreground' },
  { value: 'post', label: 'Poster', activeClassName: 'text-foreground' },
]

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
  const { search } = useLocation()
  const [unit, setUnit] = useState<StatementUnit>('total')
  const [chosenPeriod, setChosenPeriod] = useState<StatementPeriod>(
    STATEMENT_AVERAGE_PERIOD,
  )
  const [opened, setOpened] = useState<ReadonlySet<string>>(new Set())
  const periodsShown = statements.every(
    (statement) => !statement || hasStatementPeriods(statement),
  )
  const period = periodsShown ? chosenPeriod : STATEMENT_AVERAGE_PERIOD
  const [breakdown, setBreakdown] = useState<StatementBreakdown>('crop')
  const cropsShown = statements.some((statement) => statement?.crops?.length)
  const postsShown = statements.some(
    (statement) => Object.keys(statement?.posts ?? {}).length > 0,
  )
  const periodOptions = STATEMENT_PERIODS.map(
    (value): SegmentedControlOption<StatementPeriod> => ({
      value,
      label:
        value === STATEMENT_AVERAGE_PERIOD
          ? 'Gennemsnit'
          : statementPeriodLabel(value),
      title: periodsShown
        ? undefined
        : 'Kør Optimér igen for at se det enkelte år.',
      disabled: !periodsShown && value !== STATEMENT_AVERAGE_PERIOD,
      activeClassName: 'text-foreground',
    }),
  )
  const toggleOpened = (label: string) =>
    setOpened((current) => {
      const next = new Set(current)
      if (!next.delete(label)) next.add(label)
      return next
    })
  const detailRows = (line: StatementLine) =>
    breakdown === 'crop'
      ? statementCropRows(statements, line, period).map((crop) => ({
          key: crop.cropCode,
          label: cropLabel(crop.cropCode, crop.cropName),
          cells: crop.figures.map((figures) =>
            figures ? formatStatementLine(figures, line, unit) : null,
          ),
        }))
      : statementPostRows(statements, line, period, unit).map((post) => ({
          key: post.name,
          label: post.name,
          cells: post.cells,
        }))

  const statementRow = (line: StatementLine, style: typeof LINE_ROW) => {
    const expandable =
      breakdown === 'crop'
        ? line.byCrop && cropsShown
        : line.postsKey && postsShown
    const open = Boolean(expandable) && opened.has(line.label)
    return (
      <Fragment key={line.label}>
        <ComparisonFigureRow
          label={
            expandable ? (
              <button
                type="button"
                aria-expanded={open}
                className="-ml-1 flex items-center gap-1 rounded-sm text-left focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                onClick={() => toggleOpened(line.label)}
              >
                <ChevronRight
                  aria-hidden="true"
                  className={cn(
                    'size-3.5 shrink-0 text-muted-foreground transition-transform',
                    open && 'rotate-90',
                  )}
                />
                {line.label}
              </button>
            ) : (
              line.label
            )
          }
          {...style}
          {...table}
        >
          {(_, index) => {
            const figures = statementFigures(statements[index], period)
            return figures ? formatStatementLine(figures, line, unit) : null
          }}
        </ComparisonFigureRow>
        {open
          ? detailRows(line).map((row) => (
              <ComparisonFigureRow
                key={row.key}
                label={row.label}
                className="border-0"
                labelClassName="py-1.5 pl-14 text-xs font-normal text-muted-foreground"
                cellClassName={cn(FIGURE_CLASS, 'py-1.5 text-muted-foreground')}
                {...table}
              >
                {(_, index) => row.cells[index]}
              </ComparisonFigureRow>
            ))
          : null}
      </Fragment>
    )
  }

  return (
    <>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <h2 className="pt-1 font-display text-[22px] leading-tight">
          Økonomi i simuleringerne
        </h2>
        <div className="flex flex-wrap items-center gap-2">
          <SegmentedControl
            aria-label="Vis økonomien som gennemsnit eller for et enkelt år"
            value={period}
            options={periodOptions}
            labelClassName=""
            onValueChange={setChosenPeriod}
          />
          <SegmentedControl
            aria-label="Fold linjerne ud efter afgrøde eller regnskabspost"
            value={breakdown}
            options={BREAKDOWN_OPTIONS}
            labelClassName=""
            onValueChange={setBreakdown}
          />
          <SegmentedControl
            aria-label="Vis økonomien i kr/ha eller kr i alt"
            value={unit}
            options={UNIT_OPTIONS}
            labelClassName=""
            onValueChange={setUnit}
          />
        </div>
      </div>
      <ComparisonColumnsTable
        compact
        label={`${statementPeriodLabel(period)}, ${STATEMENT_UNIT_LABELS[unit]}`}
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
