import type { YearlySummaryEntry } from '@/api/types'
import {
  Table,
  TableBody,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import {
  CURRENT_CALENDAR_YEAR,
  formatFieldCount,
  formatNumber,
  formatWholeNumber,
  ROTATION_START_CALENDAR_YEAR,
  YEAR_BAR_FILL_COLOR,
  YEAR_BAR_OVER_COLOR,
  type ResolvedFarmQuota,
} from '@/lib/field-domain'

type YearlyOverviewTableProps = {
  entries: YearlySummaryEntry[]
  quota: ResolvedFarmQuota
}

const clampPct = (value: number) => Math.min(100, Math.max(0, value))

const MetricBar = ({
  fillPct,
  markerPct = null,
  isOver = false,
}: {
  fillPct: number
  markerPct?: number | null
  isOver?: boolean
}) => (
  <div
    className="relative h-1.5 flex-1 overflow-hidden rounded-full bg-muted"
    aria-hidden="true"
  >
    <div
      className="h-full rounded-full"
      style={{
        width: `${clampPct(fillPct)}%`,
        backgroundColor: isOver ? YEAR_BAR_OVER_COLOR : YEAR_BAR_FILL_COLOR,
      }}
    />
    {markerPct !== null ? (
      <div
        className="absolute inset-y-0 w-0.5 bg-foreground/40"
        style={{ left: `calc(${clampPct(markerPct)}% - 1px)` }}
      />
    ) : null}
  </div>
)

const MetricCell = ({
  label,
  fillPct,
  markerPct = null,
  isOver = false,
}: {
  label: string
  fillPct: number
  markerPct?: number | null
  isOver?: boolean
}) => (
  <TableCell>
    <div className="flex items-center gap-2">
      <span
        className={`w-28 shrink-0 text-right tabular-nums ${
          isOver ? 'font-medium text-red-700' : ''
        }`}
      >
        {label}
      </span>
      <MetricBar fillPct={fillPct} markerPct={markerPct} isOver={isOver} />
    </div>
  </TableCell>
)

export const YearlyOverviewTable = ({
  entries,
  quota,
}: YearlyOverviewTableProps) => {
  const { quotaKgn } = quota
  const maxDb2 = Math.max(1, ...entries.map((entry) => entry.totalDb2))
  const nLoadScale = Math.max(
    1,
    quotaKgn,
    ...entries.map((entry) => entry.totalNLoadKg),
  )
  const maxFen = Math.max(1, ...entries.map((entry) => entry.totalFen))
  const showFen = entries.some((entry) => entry.totalFen > 0)
  const quotaMarkerPct = quotaKgn > 0 ? (quotaKgn / nLoadScale) * 100 : null
  const fieldCountVaries = entries.some(
    (entry) => entry.fieldCount !== entries[0].fieldCount,
  )

  const averageDb2 =
    entries.reduce((sum, entry) => sum + entry.totalDb2, 0) / entries.length
  const averageNLoad =
    entries.reduce((sum, entry) => sum + entry.totalNLoadKg, 0) / entries.length
  const averageFen =
    entries.reduce((sum, entry) => sum + entry.totalFen, 0) / entries.length
  const lastCalendarYear = ROTATION_START_CALENDAR_YEAR + entries.length - 1

  return (
    <div className="space-y-2">
      <p className="text-xs text-muted-foreground">
        Summen for de beregnede marker i det enkelte år. Sædskifterne gentager
        sig, så mønsteret fortsætter efter {lastCalendarYear}.
      </p>
      <Table className="table-fixed min-w-[36rem]">
        <TableHeader>
          <TableRow>
            <TableHead className={fieldCountVaries ? 'w-44' : 'w-32'}>
              År
            </TableHead>
            <TableHead>DB2 (kr)</TableHead>
            <TableHead>Udledning (kg N)</TableHead>
            {showFen ? <TableHead>Foderenheder (FE)</TableHead> : null}
          </TableRow>
        </TableHeader>
        <TableBody>
          {entries.map((entry) => {
            const calendarYear = ROTATION_START_CALENDAR_YEAR + entry.year - 1
            const isCurrentYear = calendarYear === CURRENT_CALENDAR_YEAR
            const isOverQuota = quotaKgn > 0 && entry.totalNLoadKg > quotaKgn
            return (
              <TableRow key={entry.year}>
                <TableCell className="pr-4">
                  <span className={isCurrentYear ? 'font-medium' : ''}>
                    {calendarYear}
                  </span>
                  {isCurrentYear ? (
                    <span className="ml-1.5 rounded-full bg-muted px-1.5 text-[11px] text-muted-foreground">
                      i år
                    </span>
                  ) : null}
                  {fieldCountVaries ? (
                    <span className="ml-1.5 text-[11px] text-muted-foreground">
                      {formatFieldCount(entry.fieldCount)}
                    </span>
                  ) : null}
                </TableCell>
                <MetricCell
                  label={formatWholeNumber(entry.totalDb2)}
                  fillPct={(entry.totalDb2 / maxDb2) * 100}
                />
                <MetricCell
                  label={formatNumber(entry.totalNLoadKg)}
                  fillPct={(entry.totalNLoadKg / nLoadScale) * 100}
                  markerPct={quotaMarkerPct}
                  isOver={isOverQuota}
                />
                {showFen ? (
                  <MetricCell
                    label={formatWholeNumber(entry.totalFen)}
                    fillPct={(entry.totalFen / maxFen) * 100}
                  />
                ) : null}
              </TableRow>
            )
          })}
        </TableBody>
        <TableFooter>
          <TableRow>
            <TableCell className="pr-4">Gennemsnit pr. år</TableCell>
            <MetricCell
              label={formatWholeNumber(averageDb2)}
              fillPct={(averageDb2 / maxDb2) * 100}
            />
            <MetricCell
              label={formatNumber(averageNLoad)}
              fillPct={(averageNLoad / nLoadScale) * 100}
              markerPct={quotaMarkerPct}
              isOver={quotaKgn > 0 && averageNLoad > quotaKgn}
            />
            {showFen ? (
              <MetricCell
                label={formatWholeNumber(averageFen)}
                fillPct={(averageFen / maxFen) * 100}
              />
            ) : null}
          </TableRow>
        </TableFooter>
      </Table>
      {quotaKgn > 0 ? (
        <p className="text-xs text-muted-foreground">
          Stregen i udledningskolonnen er grænsen på {formatNumber(quotaKgn)} kg
          N pr. år ({quota.basis}). År over grænsen er vist med rødt.
        </p>
      ) : null}
    </div>
  )
}
