import { Chart } from '@tanstack/charts/react'
import { useState, type ReactNode } from 'react'

import {
  columnFigure,
  type ComparedColumn,
  type OnHighlight,
} from '@/components/farm/comparison-column'
import { CropGroupTile } from '@/components/farm/CropGroupTile'
import {
  cropDistributionChart,
  cropDistributionHeight,
  db2NLoadChart,
  db2NLoadPoints,
  type Db2NLoadPoint,
} from '@/lib/comparison-charts'
import { CROP_GROUPS, type CropGroup } from '@/lib/crop-groups'
import { formatCompactDkk, formatWholeNumber } from '@/lib/field-domain'
import { COMPARISON_PERIOD, formatKgN } from '@/lib/simulation-comparison'
import { cn } from '@/lib/utils'

const DB2_NLOAD_HEIGHT = 260
const AXIS_CAPTION_CLASS = 'text-[11px] text-muted-foreground'

const describeDb2NLoad = ({ title, db2, nLoad }: Db2NLoadPoint) =>
  `${title}\n${formatCompactDkk(db2)} · ${formatKgN(nLoad)}`

type ChartCardProps = {
  title: string
  description: string
  children: ReactNode
}

const ChartCard = ({ title, description, children }: ChartCardProps) => (
  <section className="rounded-lg border bg-card px-5 pt-4 pb-4">
    <h2 className="font-display text-[17px] leading-tight">{title}</h2>
    <p className="mt-1 mb-3 text-xs text-muted-foreground">{description}</p>
    {children}
  </section>
)

type CropDistributionCardProps = {
  columns: ComparedColumn[]
  highlightedKey: string | null
}

const CropDistributionCard = ({
  columns,
  highlightedKey,
}: CropDistributionCardProps) => {
  const [hoveredGroup, setHoveredGroup] = useState<CropGroup | null>(null)
  const cropGroups = CROP_GROUPS.filter((group) =>
    columns.some((column) =>
      column.cropShares?.some((share) => share.group.id === group.id),
    ),
  )
  return (
    <ChartCard
      title="Afgrødefordeling"
      description={`Andel af arealet, gennemsnit for ${COMPARISON_PERIOD}.`}
    >
      <Chart
        definition={cropDistributionChart(
          columns.map((column) => ({
            key: column.key,
            title: column.title,
            history: column.history,
            shares: column.cropShares,
          })),
          { highlightedKey, hoveredGroup },
        )}
        height={cropDistributionHeight(columns.length)}
        ariaLabel="Afgrødefordeling for afgrødehistorikken og de valgte simuleringer"
        onFocusChange={(point) =>
          setHoveredGroup(point?.datum.group.id ?? null)
        }
      />
      <ul className="mt-3 flex flex-wrap gap-x-3 gap-y-1.5 text-xs text-muted-foreground">
        {cropGroups.map((group) => (
          <li
            key={group.id}
            className={cn(
              'inline-flex items-center gap-1.5 transition-opacity duration-120',
              hoveredGroup === group.id && 'text-foreground',
              hoveredGroup !== null &&
                hoveredGroup !== group.id &&
                'opacity-40',
            )}
            onMouseEnter={() => setHoveredGroup(group.id)}
            onMouseLeave={() => setHoveredGroup(null)}
          >
            <CropGroupTile group={group} />
            {group.label}
          </li>
        ))}
      </ul>
    </ChartCard>
  )
}

type ComparisonChartsProps = {
  columns: ComparedColumn[]
  bestBalanceKey: string | null
  highlightedKey: string | null
  onHighlight: OnHighlight
}

export const ComparisonCharts = ({
  columns,
  bestBalanceKey,
  highlightedKey,
  onHighlight,
}: ComparisonChartsProps) => {
  const points = db2NLoadPoints(
    columns.map((column) => ({
      key: column.key,
      title: column.title,
      history: column.history,
      db2: columnFigure(column, column.totals.db2),
      nLoad: columnFigure(column, column.totals.nLoad),
    })),
    bestBalanceKey,
    highlightedKey,
  )
  return (
    <div className="grid gap-6 @3xl:grid-cols-2">
      <ChartCard
        title="Dækningsbidrag og udledning"
        description={`Gennemsnit pr. år for ${COMPARISON_PERIOD}. I det grønne felt er dækningsbidraget højere og udledningen lavere end afgrødehistorikkens.`}
      >
        <p className={cn(AXIS_CAPTION_CLASS, 'mb-1')}>Dækningsbidrag</p>
        <Chart
          definition={db2NLoadChart(points, {
            formatDb2: formatCompactDkk,
            formatNLoad: formatWholeNumber,
            describe: describeDb2NLoad,
          })}
          height={DB2_NLOAD_HEIGHT}
          ariaLabel="Dækningsbidrag og udledning for afgrødehistorikken og de valgte simuleringer"
          onFocusChange={(point) => onHighlight(point?.datum.key ?? null)}
        />
        <p className={cn(AXIS_CAPTION_CLASS, 'text-right')}>Udledning, kg N</p>
      </ChartCard>
      <CropDistributionCard columns={columns} highlightedKey={highlightedKey} />
    </div>
  )
}
