import { Fragment } from 'react'

import {
  columnCellClass,
  DETAIL_CLASS,
  highlightHandlers,
  type OnHighlight,
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
  describeCurveLegend,
  formatYears,
  overlayCurveTone,
  type CatchmentYearQuota,
  type CurveTone,
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

const marked = (level: CatchmentYearQuota['level']): level is 'over' | 'near' =>
  level === 'over' || level === 'near'

const STATUS_DOT_CLASSES: Record<'over' | 'near', string> = {
  over: 'border-destructive bg-destructive',
  near: 'border-warning bg-warning',
}

const STROKE_CLASSES: Record<CurveTone, string> = {
  plain: 'stroke-[#8F8F89]',
  history: 'stroke-[#B8B3A6]',
  best: 'stroke-primary',
  highlighted: 'stroke-[#1C1C1A]',
  dimmed: 'stroke-[#DAD9D3]',
}

const SWATCH_CLASSES: Record<CurveTone, string> = {
  plain: 'border-[#8F8F89]',
  history: 'border-[#B8B3A6]',
  best: 'border-primary',
  highlighted: 'border-[#1C1C1A]',
  dimmed: 'border-[#DAD9D3]',
}

const TONE_DOT_CLASSES: Record<CurveTone, string> = {
  plain: 'border-[#8F8F89] bg-[#8F8F89]',
  history: 'border-[#B8B3A6] bg-[#B8B3A6]',
  best: 'border-primary bg-primary',
  highlighted: 'border-[#1C1C1A] bg-[#1C1C1A]',
  dimmed: 'border-[#DAD9D3] bg-[#DAD9D3]',
}

const dotClass = (level: CatchmentYearQuota['level'], hovered: boolean) => {
  if (marked(level)) return cn('size-2.5', STATUS_DOT_CLASSES[level])
  return hovered
    ? 'size-2.5 border-[#8F8F89] bg-[#8F8F89]'
    : 'size-1.5 border-[#8F8F89] bg-card'
}

const labelClass = (level: CatchmentYearQuota['level']) =>
  marked(level) ? QUOTA_STATUS_STYLES[level].text : 'text-foreground'

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
        ? 'text-success-strong'
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

const pointStyle = (index: number, quotaPct: number, ceilingPct: number) => ({
  left: `${curveLeftPct(index, YEAR_COUNT)}%`,
  top: `${curveTopPct(quotaPct, ceilingPct)}%`,
})

const YearGuide = ({ index }: { index: number | null }) =>
  index === null ? null : (
    <div
      className="absolute inset-y-0 border-l border-[#C9C9C4]"
      style={{ left: `${curveLeftPct(index, YEAR_COUNT)}%` }}
    />
  )

const QuotaLine = ({ ceilingPct }: { ceilingPct: number }) => (
  <div
    className="absolute inset-x-0 border-t border-dashed border-destructive/55"
    style={{ top: `${curveTopPct(100, ceilingPct)}%` }}
  />
)

const YearZones = ({ onHover }: { onHover: (index: number) => void }) => (
  <div className="absolute inset-0 flex">
    {ROTATION_CALENDAR_YEARS.map((year, index) => (
      <div
        key={year}
        className="min-w-0 flex-1"
        onMouseEnter={() => onHover(index)}
      />
    ))}
  </div>
)

type CurveLineProps = {
  years: CatchmentYearQuota[]
  ceilingPct: number
  className: string
  strokeWidth: number
  dashed?: boolean
}

const CurveLine = ({
  years,
  ceilingPct,
  className,
  strokeWidth,
  dashed = false,
}: CurveLineProps) => (
  <svg
    viewBox="0 0 100 100"
    preserveAspectRatio="none"
    className="absolute inset-0 size-full overflow-visible"
  >
    {curveSegments(
      years.map((year) => year.quotaPct),
      ceilingPct,
    ).map((points) => (
      <polyline
        key={points}
        points={points}
        fill="none"
        className={cn('transition-colors', className)}
        strokeWidth={strokeWidth}
        strokeDasharray={dashed ? '4 3' : undefined}
        vectorEffect="non-scaling-stroke"
      />
    ))}
  </svg>
)

type CurveRowViewProps = {
  row: CurveRow
  ceilingPct: number
  hovered: number | null
  onHover: (index: number) => void
  highlightedKey: string | null
  onHighlight: OnHighlight
}

const CurveRowView = ({
  row,
  ceilingPct,
  hovered,
  onHover,
  highlightedKey,
  onHighlight,
}: CurveRowViewProps) => {
  const count = describeCount(row.status)
  const highlighted = row.key === highlightedKey
  const background = columnCellClass(row, highlightedKey)
  return (
    <div
      className={cn(
        'flex items-stretch border-t border-border/60 px-4.5 transition-colors duration-120',
        background,
      )}
      {...highlightHandlers(row.key, onHighlight)}
    >
      <div
        className={cn(
          'flex w-51.5 min-w-0 shrink-0 items-center py-2 pr-2 pl-5.5 text-[13px]',
          row.history && 'text-muted-foreground',
          highlighted && 'font-semibold',
        )}
      >
        <span className="truncate">{row.title}</span>
      </div>
      <div aria-hidden="true" className="relative h-15 min-w-0 flex-8">
        <YearGuide index={hovered} />
        <QuotaLine ceilingPct={ceilingPct} />
        {row.years === null ? null : (
          <>
            <CurveLine
              years={row.years}
              ceilingPct={ceilingPct}
              className={highlighted ? 'stroke-[#1C1C1A]' : 'stroke-[#8F8F89]'}
              strokeWidth={highlighted ? 2 : 1.5}
            />
            {row.years.map(({ year, quotaPct, level }, index) => {
              if (quotaPct === null) return null
              const isHovered = index === hovered
              const point = pointStyle(index, quotaPct, ceilingPct)
              return (
                <div key={year}>
                  <div
                    className={cn(
                      'absolute rounded-full border-[1.5px] transition-[width,height] duration-100',
                      dotClass(level, isHovered),
                    )}
                    style={{ ...point, transform: 'translate(-50%, -50%)' }}
                  />
                  {marked(level) || isHovered ? (
                    <div
                      className={cn(
                        'absolute rounded-[3px] px-[3px] py-px text-[11px] leading-none font-semibold whitespace-nowrap tabular-nums',
                        labelClass(level),
                        background ?? DETAIL_CLASS,
                      )}
                      style={{
                        ...point,
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
        <YearZones onHover={onHover} />
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

type CurveOverlayProps = {
  rows: CurveRow[]
  ceilingPct: number
  hovered: number | null
  onHover: (index: number) => void
  bestKey: string | null
  highlightedKey: string | null
  onHighlight: OnHighlight
}

const CurveOverlay = ({
  rows,
  ceilingPct,
  hovered,
  onHover,
  bestKey,
  highlightedKey,
  onHighlight,
}: CurveOverlayProps) => {
  const toned = rows.map((row) => ({
    row,
    tone: overlayCurveTone(row, bestKey, highlightedKey),
  }))
  const drawn = [
    ...toned.filter(({ tone }) => tone !== 'highlighted'),
    ...toned.filter(({ tone }) => tone === 'highlighted'),
  ]
  return (
    <div className="flex border-t border-border/60 px-4.5">
      <ul className="flex w-51.5 shrink-0 flex-col justify-center gap-0.5 py-2 pr-2 pl-5.5">
        {toned.map(({ row, tone }) => {
          const legend = describeCurveLegend(row.years, row.averagePct, hovered)
          return (
            <li
              key={row.key}
              className="flex items-start gap-2 py-[3px]"
              {...highlightHandlers(row.key, onHighlight)}
            >
              <span
                aria-hidden="true"
                className={cn(
                  'mt-[7px] w-3.5 shrink-0 border-t-2',
                  row.history && 'border-dashed',
                  SWATCH_CLASSES[tone],
                )}
              />
              <span className="min-w-0">
                <span
                  className={cn(
                    'block truncate text-[13px] leading-[1.3]',
                    row.history && 'text-muted-foreground',
                    row.key === highlightedKey && 'font-semibold',
                  )}
                >
                  {row.title}
                </span>
                <span
                  className={cn(
                    'block text-xs leading-[1.3] tabular-nums',
                    legend.level === null
                      ? 'text-muted-foreground'
                      : labelClass(legend.level),
                    legend.level !== null &&
                      marked(legend.level) &&
                      'font-semibold',
                  )}
                >
                  {legend.text}
                </span>
              </span>
            </li>
          )
        })}
      </ul>
      <div aria-hidden="true" className="relative h-42.5 min-w-0 flex-8">
        <YearGuide index={hovered} />
        <QuotaLine ceilingPct={ceilingPct} />
        {drawn.map(({ row, tone }) =>
          row.years === null ? null : (
            <Fragment key={row.key}>
              <CurveLine
                years={row.years}
                ceilingPct={ceilingPct}
                className={STROKE_CLASSES[tone]}
                strokeWidth={tone === 'highlighted' ? 2.5 : 1.5}
                dashed={row.history}
              />
              {tone === 'dimmed'
                ? null
                : row.years.map(({ year, quotaPct, level }, index) =>
                    quotaPct === null ||
                    (!marked(level) && index !== hovered) ? null : (
                      <div
                        key={year}
                        className={cn(
                          'absolute rounded-full border-[1.5px] transition-[width,height] duration-100',
                          index === hovered ? 'size-2.5' : 'size-2',
                          marked(level)
                            ? STATUS_DOT_CLASSES[level]
                            : TONE_DOT_CLASSES[tone],
                        )}
                        style={{
                          ...pointStyle(index, quotaPct, ceilingPct),
                          transform: 'translate(-50%, -50%)',
                        }}
                      />
                    ),
                  )}
            </Fragment>
          ),
        )}
        <YearZones onHover={onHover} />
      </div>
    </div>
  )
}

type CatchmentYearCurvesProps = {
  id: string
  rows: CurveRow[]
  hoveredYear: number | null
  onHoverYear: (index: number | null) => void
  highlightedKey: string | null
  onHighlight: OnHighlight
  bestKey: string | null
  overlay: boolean
  onToggleOverlay: () => void
}

export const CatchmentYearCurves = ({
  id,
  rows,
  hoveredYear,
  onHoverYear,
  highlightedKey,
  onHighlight,
  bestKey,
  overlay,
  onToggleOverlay,
}: CatchmentYearCurvesProps) => {
  const ceilingPct = curveCeilingPct(
    rows.flatMap((row) => row.years?.map((year) => year.quotaPct) ?? []),
  )
  return (
    <div
      id={id}
      className={DETAIL_CLASS}
      onMouseLeave={() => onHoverYear(null)}
    >
      <div className="flex items-center px-4.5">
        <p className="w-51.5 shrink-0 py-2.5 pr-2 pl-5.5 text-xs leading-snug text-muted-foreground">
          Procent af kvoten pr. år
          <br />
          Stiplet linje er kvoten (100 %)
          <br />
          <button
            type="button"
            onClick={onToggleOverlay}
            className="rounded-sm font-semibold text-primary hover:underline focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
          >
            {overlay ? 'Vis hver for sig' : 'Vis samlet i et diagram'}
          </button>
        </p>
        <div className="flex min-w-0 flex-8">
          {ROTATION_CALENDAR_YEARS.map((year, index) => (
            <button
              key={year}
              type="button"
              aria-label={describeYear(index, rows)}
              onFocus={() => onHoverYear(index)}
              onBlur={() => onHoverYear(null)}
              onMouseEnter={() => onHoverYear(index)}
              className={cn(
                'min-w-0 flex-1 rounded-sm py-2.5 text-center text-xs tabular-nums focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none',
                hoveredYear === index
                  ? 'font-semibold text-foreground'
                  : 'text-muted-foreground',
              )}
            >
              {year}
            </button>
          ))}
        </div>
        {overlay ? null : (
          <>
            <p className="w-27.5 shrink-0 py-2.5 text-right text-xs text-muted-foreground">
              Gennemsnit
            </p>
            <p className="w-40 shrink-0 py-2.5 text-right text-xs text-muted-foreground">
              År over kvoten
            </p>
          </>
        )}
      </div>
      {overlay ? (
        <CurveOverlay
          rows={rows}
          ceilingPct={ceilingPct}
          hovered={hoveredYear}
          onHover={onHoverYear}
          bestKey={bestKey}
          highlightedKey={highlightedKey}
          onHighlight={onHighlight}
        />
      ) : (
        rows.map((row) => (
          <CurveRowView
            key={row.key}
            row={row}
            ceilingPct={ceilingPct}
            hovered={hoveredYear}
            onHover={onHoverYear}
            highlightedKey={highlightedKey}
            onHighlight={onHighlight}
          />
        ))
      )}
    </div>
  )
}
