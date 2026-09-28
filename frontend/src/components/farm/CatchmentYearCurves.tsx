import { useState } from 'react'

import {
  DETAIL_CLASS,
  HISTORY_CELL_CLASS,
} from '@/components/farm/comparison-column'
import {
  formatWholeNumber,
  QUOTA_STATUS_STYLES,
  ROTATION_CALENDAR_YEARS,
} from '@/lib/field-domain'
import {
  curveCeilingPct,
  curveLeftPct,
  curveSegments,
  curveTopPct,
  describeCatchmentYearsOver,
  formatYears,
  type CatchmentYearQuota,
} from '@/lib/simulation-comparison'
import type { CatchmentYearStatus } from '@/lib/simulation-overview'
import { cn } from '@/lib/utils'

export type CurveRow = {
  key: string
  title: string
  history: boolean
  years: CatchmentYearQuota[] | null
  averagePct: number | null
  status: CatchmentYearStatus | null
}

const YEAR_COUNT = ROTATION_CALENDAR_YEARS.length

const marked = (level: CatchmentYearQuota['level']) =>
  level === 'over' || level === 'near'

const dotClass = (level: CatchmentYearQuota['level'], hovered: boolean) => {
  if (level === 'over') return 'size-2.5 border-red-600 bg-red-600'
  if (level === 'near') return 'size-2.5 border-amber-600 bg-amber-500'
  return hovered
    ? 'size-2.5 border-[#8F8F89] bg-[#8F8F89]'
    : 'size-1.5 border-[#8F8F89] bg-card'
}

const rowHoverClass = (history: boolean) =>
  history ? 'hover:bg-[#ECE6D6]' : 'hover:bg-muted'

const labelHoverClass = (history: boolean) =>
  history ? 'group-hover/curve:bg-[#ECE6D6]' : 'group-hover/curve:bg-muted'

const labelClass = (level: CatchmentYearQuota['level']) =>
  level === 'over' || level === 'near'
    ? QUOTA_STATUS_STYLES[level].text
    : 'text-foreground'

const describeCount = (status: CatchmentYearStatus | null) => {
  if (status === null) return { text: '', className: '' }
  if (status.level === 'over') {
    return {
      text: `${formatYears(status.overYears.length)} over kvoten`,
      className: QUOTA_STATUS_STYLES.over.text,
    }
  }
  return {
    text: describeCatchmentYearsOver(status),
    className:
      status.level === 'ok' || status.level === 'near'
        ? 'text-green-700'
        : 'text-muted-foreground',
  }
}

const describeYear = (index: number, rows: CurveRow[]) =>
  `${ROTATION_CALENDAR_YEARS[index]}: ${rows
    .map((row) => {
      const quotaPct = row.years?.[index]?.quotaPct ?? null
      return `${row.title} ${quotaPct === null ? 'ingen tal' : `${formatWholeNumber(quotaPct)} %`}`
    })
    .join(', ')}`

type CurveRowViewProps = {
  row: CurveRow
  ceilingPct: number
  hovered: number | null
  onHover: (index: number) => void
}

const CurveRowView = ({
  row,
  ceilingPct,
  hovered,
  onHover,
}: CurveRowViewProps) => {
  const count = describeCount(row.status)
  const background = row.history ? HISTORY_CELL_CLASS : DETAIL_CLASS
  return (
    <div
      className={cn(
        'group/curve flex items-stretch border-t border-border/60 px-4.5 transition-colors',
        row.history && HISTORY_CELL_CLASS,
        rowHoverClass(row.history),
      )}
    >
      <div
        className={cn(
          'flex w-51.5 min-w-0 shrink-0 items-center py-2 pr-2 pl-5.5 text-[13px]',
          row.history &&
            'text-muted-foreground group-hover/curve:text-foreground',
        )}
      >
        <span className="truncate">{row.title}</span>
      </div>
      <div aria-hidden="true" className="relative h-20 min-w-0 flex-8">
        {hovered === null ? null : (
          <div
            className="absolute inset-y-0 border-l border-[#C9C9C4]"
            style={{ left: `${curveLeftPct(hovered, YEAR_COUNT)}%` }}
          />
        )}
        <div className="absolute inset-x-0 inset-y-3">
          <div
            className="absolute inset-x-0 border-t border-dashed border-red-600/55"
            style={{ top: `${curveTopPct(100, ceilingPct)}%` }}
          />
          {row.years === null ? null : (
            <>
              <svg
                viewBox="0 0 100 100"
                preserveAspectRatio="none"
                className="absolute inset-0 size-full overflow-visible"
              >
                {curveSegments(
                  row.years.map((year) => year.quotaPct),
                  ceilingPct,
                ).map((points) => (
                  <polyline
                    key={points}
                    points={points}
                    fill="none"
                    className="stroke-[#8F8F89] transition-colors group-hover/curve:stroke-[#4A4A45]"
                    strokeWidth={1.5}
                    vectorEffect="non-scaling-stroke"
                  />
                ))}
              </svg>
              {row.years.map(({ year, quotaPct, level }, index) => {
                if (quotaPct === null) return null
                const isHovered = index === hovered
                const left = `${curveLeftPct(index, YEAR_COUNT)}%`
                const top = `${curveTopPct(quotaPct, ceilingPct)}%`
                return (
                  <div key={year}>
                    <div
                      className={cn(
                        'absolute rounded-full border-[1.5px] transition-[width,height] duration-100',
                        dotClass(level, isHovered),
                      )}
                      style={{ left, top, transform: 'translate(-50%, -50%)' }}
                    />
                    {marked(level) || isHovered ? (
                      <div
                        className={cn(
                          'absolute rounded-[3px] px-[3px] py-px text-[11px] leading-none font-semibold whitespace-nowrap tabular-nums',
                          labelClass(level),
                          background,
                          labelHoverClass(row.history),
                        )}
                        style={{
                          left,
                          top,
                          transform:
                            index >= YEAR_COUNT - 2
                              ? 'translate(calc(-100% - 8px), -50%)'
                              : 'translate(8px, -50%)',
                        }}
                      >
                        {formatWholeNumber(quotaPct)} %
                      </div>
                    ) : null}
                  </div>
                )
              })}
            </>
          )}
        </div>
        <div className="absolute inset-0 flex">
          {ROTATION_CALENDAR_YEARS.map((year, index) => (
            <div
              key={year}
              className="min-w-0 flex-1"
              onMouseEnter={() => onHover(index)}
            />
          ))}
        </div>
      </div>
      <div className="flex w-27.5 shrink-0 items-center justify-end text-[13px] text-muted-foreground tabular-nums">
        {row.averagePct === null
          ? '-'
          : `${formatWholeNumber(row.averagePct)} %`}
      </div>
      <div
        className={cn(
          'flex w-40 shrink-0 items-center justify-end text-right text-[13px] font-semibold',
          count.className,
        )}
      >
        {count.text}
      </div>
    </div>
  )
}

type CatchmentYearCurvesProps = {
  id: string
  rows: CurveRow[]
}

export const CatchmentYearCurves = ({ id, rows }: CatchmentYearCurvesProps) => {
  const [hovered, setHovered] = useState<number | null>(null)
  const ceilingPct = curveCeilingPct(
    rows.flatMap((row) => row.years?.map((year) => year.quotaPct) ?? []),
  )
  return (
    <div id={id} className={DETAIL_CLASS} onMouseLeave={() => setHovered(null)}>
      <div className="flex items-center px-4.5">
        <p className="w-51.5 shrink-0 py-2.5 pr-2 pl-5.5 text-xs leading-snug text-muted-foreground">
          Procent af kvoten pr. år
          <br />
          Stiplet linje er kvoten (100 %)
        </p>
        <div className="flex min-w-0 flex-8">
          {ROTATION_CALENDAR_YEARS.map((year, index) => (
            <button
              key={year}
              type="button"
              aria-label={describeYear(index, rows)}
              onFocus={() => setHovered(index)}
              onBlur={() => setHovered(null)}
              onMouseEnter={() => setHovered(index)}
              className={cn(
                'min-w-0 flex-1 rounded-sm py-2.5 text-center text-xs tabular-nums focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none',
                hovered === index
                  ? 'font-semibold text-foreground'
                  : 'text-muted-foreground',
              )}
            >
              {year}
            </button>
          ))}
        </div>
        <p className="w-27.5 shrink-0 py-2.5 text-right text-xs text-muted-foreground">
          Gennemsnit
        </p>
        <p className="w-40 shrink-0 py-2.5 text-right text-xs text-muted-foreground">
          År over kvoten
        </p>
      </div>
      {rows.map((row) => (
        <CurveRowView
          key={row.key}
          row={row}
          ceilingPct={ceilingPct}
          hovered={hovered}
          onHover={setHovered}
        />
      ))}
    </div>
  )
}
