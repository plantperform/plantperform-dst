import { ArrowDownToLine, Coins, Droplets } from 'lucide-react'
import { useState } from 'react'

import type { FieldRecord, RotationCandidateYearResult } from '@/api/types'
import { CropGroupTile, CropYearBlock } from '@/components/farm/CropGroupTile'
import {
  WinterCoverLegend,
  WinterCoverSwatch,
} from '@/components/farm/WinterCoverBand'
import {
  SegmentedControl,
  type SegmentedControlOption,
} from '@/components/ui/segmented-control'
import { cropGroupFor, shortCropName } from '@/lib/crop-groups'
import {
  CURRENT_CALENDAR_YEAR,
  formatCompactDkk,
  formatNumber,
  yearNLoadKgHa,
} from '@/lib/field-domain'
import { cn } from '@/lib/utils'
import { presentWinterCovers, rotationCovers } from '@/lib/winter-cover'

type YearMetric = 'nLoad' | 'leaching' | 'db2'

const METRIC_OPTIONS: SegmentedControlOption<YearMetric>[] = [
  { value: 'nLoad', label: 'Udledning', icon: Droplets, title: 'Udledning' },
  {
    value: 'leaching',
    label: 'Udvaskning',
    icon: ArrowDownToLine,
    title: 'Udvaskning',
  },
  { value: 'db2', label: 'DB2', icon: Coins, title: 'DB2' },
]

const metricValue = (
  metric: YearMetric,
  yearValue: RotationCandidateYearResult,
  field: FieldRecord,
): number => {
  if (metric === 'leaching') return yearValue.leachingKgNHa
  if (metric === 'nLoad') {
    return (
      yearNLoadKgHa(yearValue.leachingKgNHa, field.retention) * field.areaHa
    )
  }
  return yearValue.dbDkkHa * field.areaHa
}

const describeMetric = (metric: YearMetric, value: number): string => {
  if (metric === 'db2') return `DB2 ${formatCompactDkk(value)}`
  if (metric === 'leaching') return `Udvaskning ${formatNumber(value)} kg N/ha`
  return `Udledning ${formatNumber(value)} kg N`
}

type ColumnScale = {
  divisor: number
  unit: string
  maximumFractionDigits: number
}

const columnScale = (
  metric: YearMetric,
  values: (number | null)[],
): ColumnScale => {
  const maxAbs = Math.max(
    0,
    ...values.flatMap((value) => (value === null ? [] : [Math.abs(value)])),
  )
  if (metric !== 'db2') {
    return {
      divisor: 1,
      unit: metric === 'nLoad' ? 'kg N' : 'kg N/ha',
      maximumFractionDigits: maxAbs >= 100 ? 0 : 1,
    }
  }
  const divisor = maxAbs >= 999_500 ? 1_000_000 : maxAbs >= 999.5 ? 1_000 : 1
  return {
    divisor,
    unit: divisor === 1_000_000 ? 'mio. kr' : divisor === 1_000 ? 't.kr' : 'kr',
    maximumFractionDigits: maxAbs / divisor < 10 ? 1 : 0,
  }
}

const formatColumnValue = (value: number, scale: ColumnScale): string =>
  new Intl.NumberFormat('da-DK', {
    maximumFractionDigits: scale.maximumFractionDigits,
  }).format(value / scale.divisor)

type FieldYearStripProps = {
  field: FieldRecord
  yearValues?: RotationCandidateYearResult[]
  startYear: number
  selectedIndex: number | null
  onSelect?: (index: number | null) => void
}

export const FieldYearStrip = ({
  field,
  yearValues,
  startYear,
  selectedIndex,
  onSelect,
}: FieldYearStripProps) => {
  const [metric, setMetric] = useState<YearMetric>('nLoad')
  const hasValues = yearValues !== undefined && yearValues.length > 0
  const values = field.cropRotation.map((_, index) => {
    const yearValue = yearValues?.[index]
    return yearValue ? metricValue(metric, yearValue, field) : null
  })
  const counted = values.filter((value): value is number => value !== null)
  const maxValue = Math.max(0, ...counted)
  const meanValue =
    counted.length > 0
      ? counted.reduce((sum, value) => sum + value, 0) / counted.length
      : null
  const scale = columnScale(metric, values)
  const yearCovers = rotationCovers(
    field.cropRotation,
    yearValues?.map((yearValue) => yearValue.leachingDetail) ?? [],
  )
  const presentCovers = presentWinterCovers(yearCovers ?? [])
  const distinctCrops = field.cropRotation.filter(
    (year, index, all) =>
      all.findIndex((candidate) => candidate.cropName === year.cropName) ===
      index,
  )
  const selectedYear =
    selectedIndex !== null ? field.cropRotation[selectedIndex] : undefined
  const selectedValue =
    selectedIndex !== null ? yearValues?.[selectedIndex] : undefined
  const otherMetrics = METRIC_OPTIONS.filter(
    (option) => option.value !== metric,
  )

  return (
    <div>
      {hasValues ? (
        <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1.5 pt-2.5">
          <SegmentedControl
            value={metric}
            options={METRIC_OPTIONS}
            onValueChange={setMetric}
            aria-label="Vis"
            labelClassName="inline"
          />
          <span className="text-[11px] leading-[14px] text-muted-foreground tabular-nums">
            {meanValue !== null ? (
              <span className="@min-[560px]:hidden">
                Gns. {formatColumnValue(meanValue, scale)}{' '}
              </span>
            ) : null}
            {scale.unit}
          </span>
        </div>
      ) : null}
      <div className="relative @min-[560px]:pr-14">
        {hasValues && meanValue !== null && meanValue > 0 && maxValue > 0 ? (
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-x-0 top-3.5 h-14 @min-[560px]:h-[72px]"
          >
            <div
              className="absolute inset-x-0 flex translate-y-1/2 items-center gap-1.5"
              style={{
                bottom: `calc((100% - 16px) * ${Math.min(meanValue / maxValue, 1)})`,
              }}
            >
              <span className="h-0 flex-1 border-t border-dashed border-foreground/40" />
              <span className="hidden w-12 shrink-0 text-right text-[10px] leading-3 text-muted-foreground tabular-nums @min-[560px]:block">
                gns. {formatColumnValue(meanValue, scale)}
              </span>
            </div>
          </div>
        ) : null}
        <div
          role={onSelect ? 'group' : undefined}
          aria-label={onSelect ? 'Vælg år' : undefined}
          className="grid gap-x-0.5 pt-2.5 @min-[560px]:gap-x-1"
          style={{
            gridTemplateColumns: `repeat(${field.cropRotation.length}, minmax(0, 1fr))`,
          }}
        >
          {field.cropRotation.map((year, index) => {
            const value = values[index]
            const covers = yearCovers?.[index] ?? []
            const isSelected = selectedIndex === index
            const calendarYear = startYear + index
            const isCurrentYear = calendarYear === CURRENT_CALENDAR_YEAR
            const group = cropGroupFor(year.cropCode, year.cropName)
            const title = `${calendarYear}${isCurrentYear ? ' (i år)' : ''}: ${
              year.cropName
            }${
              year.undersownCropName !== null
                ? ` (udlæg: ${year.undersownCropName})`
                : ''
            }${covers.map((yearCover) => ` · ${yearCover.cover.label}`).join('')}${
              value !== null ? ` · ${describeMetric(metric, value)}` : ''
            }`
            const ratio =
              value !== null && maxValue > 0 ? Math.max(0, value) / maxValue : 0
            const content = (
              <>
                {hasValues ? (
                  <span
                    aria-hidden="true"
                    className="flex h-14 flex-col items-center justify-end border-b border-border @min-[560px]:h-[72px]"
                  >
                    <span
                      className={cn(
                        'relative mb-0.5 rounded-sm px-0.5 whitespace-nowrap text-[12px] leading-[14px] tabular-nums',
                        isSelected
                          ? 'bg-muted font-semibold text-foreground'
                          : 'bg-card text-muted-foreground',
                      )}
                    >
                      {value !== null ? formatColumnValue(value, scale) : '-'}
                    </span>
                    <span
                      className={cn(
                        'w-4 rounded-t-[3px] transition-colors @min-[560px]:w-7',
                        isSelected
                          ? 'bg-primary'
                          : 'bg-primary/40 group-hover:bg-primary/60',
                      )}
                      style={{
                        height:
                          value !== null
                            ? `max(2px, calc((100% - 16px) * ${ratio}))`
                            : 0,
                      }}
                    />
                  </span>
                ) : null}
                <CropYearBlock
                  group={group}
                  covers={yearCovers?.[index]}
                  size="md"
                  className="mt-[3px]"
                />
                <span
                  className={cn(
                    'mt-1 text-[12px] leading-4 font-semibold tabular-nums',
                    isSelected ? 'text-foreground' : 'text-muted-foreground',
                    isCurrentYear &&
                      'underline decoration-dotted underline-offset-2',
                  )}
                >
                  {calendarYear}
                </span>
                <span
                  className={cn(
                    'mt-px hidden truncate text-[11px] leading-[14px] @min-[560px]:block',
                    isSelected ? 'text-foreground' : 'text-muted-foreground',
                  )}
                >
                  {shortCropName(year.cropName)}
                </span>
              </>
            )
            const className = cn(
              'group flex min-w-0 flex-col rounded-[6px] border px-0.5 py-1 text-center @min-[560px]:px-1',
              isSelected ? 'border-primary bg-muted' : 'border-transparent',
              onSelect &&
                'cursor-pointer transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none',
              onSelect && !isSelected && 'hover:bg-muted/60',
            )
            return onSelect ? (
              <button
                key={index}
                type="button"
                aria-pressed={isSelected}
                aria-label={title}
                title={title}
                onClick={() => onSelect(isSelected ? null : index)}
                className={className}
              >
                {content}
              </button>
            ) : (
              <div key={index} title={title} className={className}>
                {content}
              </div>
            )
          })}
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 pt-2 text-[11px] leading-[14px] text-muted-foreground @min-[560px]:hidden">
        <span className="font-medium text-foreground">Afgrøder</span>
        {distinctCrops.map((year) => (
          <span
            key={year.cropName}
            className="inline-flex items-center gap-1.5"
          >
            <CropGroupTile group={cropGroupFor(year.cropCode, year.cropName)} />
            {shortCropName(year.cropName)}
          </span>
        ))}
      </div>
      {presentCovers.length > 0 ? (
        <WinterCoverLegend
          covers={presentCovers}
          className="pt-2 text-[11px] leading-[14px]"
        />
      ) : null}
      {selectedYear && selectedIndex !== null ? (
        <div className="space-y-1.5 pt-2 text-xs leading-4">
          <p className="tabular-nums text-pretty">
            <span className="font-semibold">{startYear + selectedIndex}</span> ·{' '}
            {selectedYear.cropName}
            {selectedYear.undersownCropName !== null
              ? ` · udlæg: ${shortCropName(selectedYear.undersownCropName)}`
              : ''}
            {selectedValue
              ? otherMetrics
                  .map(
                    (option) =>
                      ` · ${describeMetric(option.value, metricValue(option.value, selectedValue, field))}`,
                  )
                  .join('')
              : ''}
          </p>
          {(yearCovers?.[selectedIndex] ?? []).map((yearCover) => (
            <p
              key={yearCover.cover.id}
              className="flex items-start gap-1.5 text-muted-foreground"
            >
              <WinterCoverSwatch cover={yearCover.cover} className="size-4" />
              <span>
                <span className="font-medium text-foreground">
                  {yearCover.cover.label}.
                </span>{' '}
                {yearCover.description}
              </span>
            </p>
          ))}
        </div>
      ) : null}
    </div>
  )
}
