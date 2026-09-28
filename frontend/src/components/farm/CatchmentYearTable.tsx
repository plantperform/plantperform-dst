import {
  formatWholeNumber,
  QUOTA_STATUS_STYLES,
  ROTATION_CALENDAR_YEARS,
} from '@/lib/field-domain'
import {
  quotaBarShare,
  type CatchmentYearQuota,
} from '@/lib/simulation-comparison'
import { cn } from '@/lib/utils'

type YearCellProps = {
  yearQuota: CatchmentYearQuota
}

const YearCell = ({ yearQuota: { quotaPct, level } }: YearCellProps) =>
  quotaPct === null ? (
    <span className="text-xs text-muted-foreground">Ingen tal</span>
  ) : (
    <div className="flex items-center gap-2">
      <div className="relative h-2.5 w-28 rounded-full bg-muted">
        <div
          className={cn(
            'h-full rounded-full',
            level === 'ok'
              ? 'bg-muted-foreground/40'
              : QUOTA_STATUS_STYLES[level].dot,
          )}
          style={{ width: `${quotaBarShare(quotaPct)}%` }}
        />
        <div
          aria-hidden="true"
          className="absolute -inset-y-1 w-px bg-foreground"
          style={{ left: `${quotaBarShare(100)}%` }}
        />
      </div>
      <span
        className={cn(
          'tabular-nums',
          level === 'over' && `font-medium ${QUOTA_STATUS_STYLES.over.text}`,
        )}
      >
        {formatWholeNumber(quotaPct)} %
      </span>
    </div>
  )

export type CatchmentYearColumn = {
  key: string
  title: string
  years: CatchmentYearQuota[] | null
}

type CatchmentYearTableProps = {
  id: string
  columns: CatchmentYearColumn[]
}

export const CatchmentYearTable = ({
  id,
  columns,
}: CatchmentYearTableProps) => (
  <div id={id} className="space-y-3 px-4 py-4">
    <div className="flex flex-wrap items-baseline justify-between gap-2">
      <p className="text-sm font-medium">År for år i procent af kvoten</p>
      <p className="text-xs text-muted-foreground">
        Rødt er over kvoten, gult er tæt på (mindst 90 %)
      </p>
    </div>
    <table className="text-sm">
      <thead>
        <tr className="text-left text-xs text-muted-foreground">
          <th scope="col" className="py-1 pr-6 font-medium">
            År
          </th>
          {columns.map((column) => (
            <th key={column.key} scope="col" className="py-1 pr-6 font-medium">
              {column.title}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {ROTATION_CALENDAR_YEARS.map((year, yearIndex) => (
          <tr key={year}>
            <th
              scope="row"
              className="py-1 pr-6 text-left font-normal tabular-nums"
            >
              {year}
            </th>
            {columns.map((column) => (
              <td key={column.key} className="py-1 pr-6">
                {column.years === null ? null : (
                  <YearCell yearQuota={column.years[yearIndex]} />
                )}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  </div>
)
