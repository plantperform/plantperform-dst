import type { ColumnDef, RowData } from '@tanstack/react-table'
import { ChevronRight, Lock, X } from 'lucide-react'
import type { ReactNode } from 'react'

import type { FieldRecord } from '@/api/types'
import { QuotaStatusIndicator } from '@/components/farm/QuotaStatusIndicator'
import { RotationSwatches } from '@/components/farm/RotationSwatches'
import { SortableColumnHeaderContent } from '@/components/farm/SortableColumnHeaderContent'
import { AppTooltip, TruncatedTooltip } from '@/components/ui/app-tooltip'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import {
  availableNKgNHa,
  availableNShareOfNorm,
  totalFertiliser,
  type FertiliserFigures,
} from '@/lib/fertiliser-overview'
import {
  describeSeparateQuotas,
  describeUncalculatedCount,
  EXCLUDED_FROM_CALCULATION,
  fieldFigure,
  fieldDisplayName,
  fieldNNormPct,
  firstCalendarYear,
  formatLockTooltip,
  formatNumber,
  formatQuotaAmount,
  formatRotationYear,
  formatShare,
  formatWholeNumber,
  getFieldQuotaStatus,
  isFieldCalculated,
  isFieldLocked,
  perHaUnit,
  totalsFigure,
  type FarmQuota,
  type FieldTotals,
  type PerHaFigure,
  type PerHaMetric,
  type QuotaStatus,
  type QuotaStatusLevel,
} from '@/lib/field-domain'
import { textWidth } from '@/lib/text-width'
import { cn } from '@/lib/utils'

declare module '@tanstack/react-table' {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  interface ColumnMeta<TData extends RowData, TValue> {
    headerClassName?: string
    cellClassName?: string
    toggleLabel?: string
    // Columns sharing a group are shown and hidden together.
    toggleGroup?: string
    widthHints?: ((row: TData) => number)[]
  }
}

const CELL_X_PADDING = 'px-2 full:px-2.5'
const HEADER_CELL_CLASS = `${CELL_X_PADDING} py-2 align-top text-xs font-medium whitespace-normal text-muted-foreground`
const HEADER_SUBLINE_CLASS = 'block text-[11px] leading-4 font-normal'
const BODY_CELL_CLASS = `${CELL_X_PADDING} py-1 whitespace-nowrap full:py-1.5`
const NUMERIC_HEADER_CLASS = `${HEADER_CELL_CLASS} text-right`
const NUMERIC_CELL_CLASS = `${BODY_CELL_CLASS} text-right tabular-nums`
const SECONDARY_LINE_CLASS =
  'hidden text-xs font-normal text-muted-foreground full:block'
// The totals row keeps its second line when the list is compact: the
// bedrift's totals are the figures to read there.
const FOOTER_SECONDARY_LINE_CLASS = 'text-xs font-normal text-muted-foreground'

type Placement = 'cell' | 'footer'

const secondaryLineClass = (placement: Placement) =>
  placement === 'footer' ? FOOTER_SECONDARY_LINE_CLASS : SECONDARY_LINE_CLASS

const UNKNOWN_LABEL = 'Ukendt'

type CellContent = PerHaFigure | string | null

const contentWidthHints = (
  contentOf: (field: FieldRecord) => CellContent,
): ((field: FieldRecord) => number)[] => [
  (field) => (contentOf(field) === null ? 1 : 0),
  (field) => {
    const content = contentOf(field)
    if (content === null) return 0
    return textWidth(typeof content === 'string' ? content : content.value)
  },
  (field) => {
    const content = contentOf(field)
    return content === null || typeof content === 'string' || !content.total
      ? 0
      : textWidth(content.total)
  },
]

const uniqueCropNames = (rotation: FieldRecord['cropRotation']): string[] => {
  const seenNames: string[] = []
  for (const year of rotation) {
    if (!seenNames.includes(year.cropName)) seenNames.push(year.cropName)
  }
  return seenNames
}

const cropFirstWord = (name: string): string =>
  name
    .trim()
    .split(/\s+/)[0]
    .replace(/[,.-]+$/, '')

const uniqueCropNamesLabel = (
  rotation: FieldRecord['cropRotation'],
): string => {
  const firstWords: string[] = []
  for (const name of uniqueCropNames(rotation)) {
    const word = cropFirstWord(name)
    if (word && !firstWords.includes(word)) firstWords.push(word)
  }
  const shown = firstWords.slice(0, 2).join(' + ')
  return firstWords.length > 2 ? `${shown} m.fl.` : shown
}

const QUOTA_PLACEHOLDER_LABELS: Partial<Record<QuotaStatusLevel, string>> = {
  uncalculated: 'Ikke beregnet',
  noData: 'Ingen data',
  excluded: EXCLUDED_FROM_CALCULATION,
}

const renderQuotaPlaceholder = (level: QuotaStatusLevel) => {
  const label = QUOTA_PLACEHOLDER_LABELS[level]
  if (!label) return null
  return (
    <QuotaStatusIndicator level={level} className="justify-end">
      <span className="font-normal text-muted-foreground">{label}</span>
    </QuotaStatusIndicator>
  )
}

const quotaStatusText = (status: QuotaStatus): string =>
  QUOTA_PLACEHOLDER_LABELS[status.level] ??
  formatQuotaAmount(status.nLoad, status.quotaKgn)

const renderQuotaStatus = (status: QuotaStatus) => {
  const placeholder = renderQuotaPlaceholder(status.level)
  if (placeholder) return placeholder

  const amountText = quotaStatusText(status)

  return (
    <QuotaStatusIndicator level={status.level} className="justify-end">
      {status.level === 'partial' ? (
        <span className="text-muted-foreground">{amountText}</span>
      ) : (
        amountText
      )}
    </QuotaStatusIndicator>
  )
}

const renderQuotaStatusFooter = (quota: FarmQuota) => {
  const { totals, level, quotaKgN } = quota
  const placeholder = renderQuotaPlaceholder(level)
  if (placeholder) return placeholder

  const notes: string[] = [
    quotaKgN === null
      ? describeSeparateQuotas(quota)
      : 'summen af markernes kvoter',
  ]
  const uncalculatedNote = describeUncalculatedCount(totals)
  if (uncalculatedNote) notes.push(uncalculatedNote)

  return (
    <div className="space-y-0.5 text-right">
      <QuotaStatusIndicator
        level={level}
        className={cn(
          'justify-end',
          level === 'partial' && 'text-muted-foreground',
        )}
      >
        {quotaKgN === null
          ? `${formatNumber(totals.nLoad)} kg N`
          : formatQuotaAmount(totals.nLoad, quotaKgN)}
      </QuotaStatusIndicator>
      <div className="flex flex-wrap justify-end gap-x-1 text-xs font-normal text-muted-foreground">
        {notes.map((note, index) => (
          <span key={note} className="whitespace-nowrap">
            {index < notes.length - 1 ? note + ',' : note}
          </span>
        ))}
      </div>
    </div>
  )
}

type NumericMetricColumnConfig = {
  key: PerHaMetric
  label: string
  heading: string
  emptyCell: (placement: Placement) => ReactNode
  quotaGated?: boolean
}

const renderMetricFigure = (
  { value, total }: PerHaFigure,
  placement: Placement,
): ReactNode => (
  <>
    <div className="font-medium">{value}</div>
    {total ? (
      <div className={secondaryLineClass(placement)}>{total}</div>
    ) : null}
  </>
)

const renderCellContent = (content: CellContent): ReactNode => {
  if (content === null) return null
  return typeof content === 'string' ? (
    <span className="text-muted-foreground">{content}</span>
  ) : (
    renderMetricFigure(content, 'cell')
  )
}

const numericMetricColumn = (
  config: NumericMetricColumnConfig,
  isSimulationView: boolean,
  totals: FieldTotals,
): ColumnDef<FieldRecord, unknown> => {
  const { key, label, heading, emptyCell, quotaGated } = config
  const contentOf = (field: FieldRecord): CellContent => {
    if (quotaGated && !field.quotaEligible) return EXCLUDED_FROM_CALCULATION
    return isFieldCalculated(field, isSimulationView)
      ? fieldFigure(field, key)
      : null
  }
  return {
    accessorKey: key,
    header: ({ column }) => (
      <SortableColumnHeaderContent
        label={heading}
        unit={perHaUnit(key)}
        align="right"
        column={column}
      />
    ),
    cell: ({ row }) =>
      renderCellContent(contentOf(row.original)) ?? emptyCell('cell'),
    footer: () =>
      totals.calculatedCount === 0
        ? emptyCell('footer')
        : renderMetricFigure(totalsFigure(totals, key), 'footer'),
    meta: {
      headerClassName: NUMERIC_HEADER_CLASS,
      cellClassName: NUMERIC_CELL_CLASS,
      toggleLabel: label,
      widthHints: contentWidthHints(contentOf),
    },
  }
}

const renderRotationSwatches = (
  rotation: FieldRecord['cropRotation'],
  rotationStartYear: number,
  highlightIndex: number | null = null,
) => (
  <div className="flex items-center gap-2.5">
    <RotationSwatches
      rotation={rotation}
      startYear={rotationStartYear}
      highlightIndex={highlightIndex}
      tileClassName="size-4 full:size-[18px]"
    />
    <AppTooltip content={uniqueCropNames(rotation).join(' · ')}>
      <span className="hidden min-w-0 max-w-40 truncate text-sm full:block">
        {uniqueCropNamesLabel(rotation)}
      </span>
    </AppTooltip>
  </div>
)

const nameWidth = (field: FieldRecord) =>
  textWidth(fieldDisplayName(field), 'semibold')

const nameColumn = (
  footer: () => ReactNode,
): ColumnDef<FieldRecord, unknown> => ({
  id: 'name',
  accessorFn: fieldDisplayName,
  header: ({ column }) => (
    <SortableColumnHeaderContent label="Mark" column={column} />
  ),
  cell: ({ row }) => {
    const rowField = row.original
    return (
      <span className="flex items-center gap-1.5">
        <span>{fieldDisplayName(rowField)}</span>
        {isFieldLocked(rowField) ? (
          <AppTooltip content={formatLockTooltip(rowField)}>
            <Lock
              className="h-3.5 w-3.5 shrink-0 text-locked"
              aria-hidden="true"
            />
            <span className="sr-only">Låst</span>
          </AppTooltip>
        ) : null}
      </span>
    )
  },
  footer,
  meta: {
    headerClassName: HEADER_CELL_CLASS,
    cellClassName: cn(BODY_CELL_CLASS, 'font-semibold'),
    widthHints: [
      (field) => (isFieldLocked(field) ? 0 : nameWidth(field)),
      (field) => (isFieldLocked(field) ? nameWidth(field) : 0),
    ],
  },
})

const areaColumn = (
  footer: () => ReactNode,
): ColumnDef<FieldRecord, unknown> => ({
  accessorKey: 'areaHa',
  header: ({ column }) => (
    <SortableColumnHeaderContent label="Areal" column={column} />
  ),
  cell: ({ row }) => `${formatNumber(row.original.areaHa)} ha`,
  footer,
  meta: {
    headerClassName: HEADER_CELL_CLASS,
    cellClassName: BODY_CELL_CLASS,
    widthHints: [(field) => textWidth(formatNumber(field.areaHa))],
  },
})

const rowAffordanceColumn: ColumnDef<FieldRecord, unknown> = {
  id: 'rowAffordance',
  header: () => null,
  cell: () => (
    <ChevronRight
      className="h-4 w-4 text-muted-foreground/60 transition-colors group-hover:text-primary"
      aria-hidden="true"
    />
  ),
  enableSorting: false,
  meta: {
    headerClassName: 'hidden w-8 px-2 py-2 full:table-cell',
    cellClassName: 'hidden w-8 px-2 py-1 text-right full:table-cell',
  },
}

const detachColumn = (
  detachingFieldIds: string[],
  onRequestDetach: (field: FieldRecord) => void,
): ColumnDef<FieldRecord, unknown> => ({
  id: 'detach',
  header: () => <span className="sr-only">Fjern fra bedriften</span>,
  cell: ({ row }) => {
    const rowField = row.original
    return (
      <AppTooltip content="Fjern fra bedriften">
        <span className="inline-flex">
          <Button
            variant="ghost"
            size="xs"
            className="size-7 p-0 text-muted-foreground opacity-0 group-focus-within:opacity-100 group-hover:opacity-100 hover:text-destructive focus-visible:opacity-100 pointer-coarse:opacity-100"
            disabled={detachingFieldIds.includes(rowField.id)}
            aria-label={`Fjern mark ${fieldDisplayName(rowField)} fra bedriften`}
            onClick={(event) => {
              event.stopPropagation()
              onRequestDetach(rowField)
            }}
            onDoubleClick={(event) => event.stopPropagation()}
            onKeyDown={(event) => event.stopPropagation()}
          >
            <X className="size-4" aria-hidden="true" />
          </Button>
        </span>
      </AppTooltip>
    )
  },
  enableSorting: false,
  meta: {
    headerClassName: 'w-9 px-1 py-2',
    cellClassName: 'w-9 px-1 py-0.5 text-right',
  },
})

const nLoadQuotaContent = (field: FieldRecord): PerHaFigure | string => {
  if (!field.quotaEligible) return 'Ikke kvotegivende areal'
  if (field.nLoadQuotaKgN === 0) return 'Ingen data'
  return {
    value: `${formatNumber(field.nLoadQuotaKgN)} kg N`,
    total:
      field.areaHa > 0
        ? `${formatNumber(field.nLoadQuotaKgN / field.areaHa)} kg N/ha`
        : undefined,
  }
}

const soilSummary = (field: FieldRecord): string | null =>
  field.soilTypeNumber === null || field.retention === null
    ? null
    : `JB ${field.soilTypeNumber} - retention ${formatNumber(field.retention)}`

const retentionText = (field: FieldRecord): string =>
  field.retention === null ? UNKNOWN_LABEL : formatNumber(field.retention)

const soilTypeText = (field: FieldRecord): string =>
  String(field.soilTypeNumber ?? UNKNOWN_LABEL)

type FertiliserColumnConfig = {
  id: string
  heading: string
  unit: string
  totalUnit: string
  tooltip?: string
  pick: (figures: FertiliserFigures) => number | null
  format: (value: number) => string
  // Replaces the mark's total on the second line.
  secondary?: (figures: FertiliserFigures) => string | null
  // A norm or level per hectare, not something to total over the marker.
  noFarmTotal?: boolean
}

const describeShareOfNorm = (figures: FertiliserFigures): string | null => {
  const share = availableNShareOfNorm(figures)
  return share === null ? null : `${formatShare(share)} af norm`
}

// In the order of the Gødning card in the mark's year detail.
const FERTILISER_COLUMNS: FertiliserColumnConfig[] = [
  {
    id: 'cropNorm',
    heading: 'Afgrøde-norm',
    unit: 'kg N/ha',
    totalUnit: 'kg N',
    pick: (figures) => figures.cropNormKgNHa,
    format: formatWholeNumber,
    noFarmTotal: true,
  },
  {
    id: 'precedingCropValue',
    heading: 'Forfrugt',
    unit: 'kg N/ha',
    totalUnit: 'kg N',
    tooltip: 'Forfrugtsværdi',
    pick: (figures) => figures.precedingCropValueKgNHa,
    format: formatWholeNumber,
  },
  {
    id: 'mineralFertiliser',
    heading: 'Handelsgødning',
    unit: 'kg N/ha',
    totalUnit: 'kg N',
    pick: (figures) => figures.mineralFertiliserKgNHa,
    format: formatWholeNumber,
  },
  {
    id: 'manureUtilised',
    heading: 'Org. gødning',
    unit: 'kg N/ha',
    totalUnit: 'kg N',
    tooltip:
      'Mineralsk andel af organisk gødning, som tæller med i normen. Den organisk bundne andel tæller ikke med, men indgår i udvaskningen.',
    pick: (figures) => figures.manureUtilisedKgNHa,
    format: formatWholeNumber,
  },
  {
    id: 'availableN',
    heading: 'Tilgængeligt N',
    unit: 'kg N/ha',
    totalUnit: 'kg N',
    tooltip:
      'Forfrugt + handelsgødning + mineralsk andel af organisk gødning',
    pick: availableNKgNHa,
    format: formatWholeNumber,
    secondary: describeShareOfNorm,
    noFarmTotal: true,
  },
  {
    id: 'manureTons',
    heading: 'Ton gødning',
    unit: 'ton/ha',
    totalUnit: 'ton',
    tooltip: 'Organisk gødning i ton',
    pick: (figures) => figures.manureTonsPerHa,
    format: formatNumber,
  },
]

const loadingFigure = (
  <Skeleton className="ml-auto h-4 w-14 bg-muted-foreground/20" />
)

const fertiliserColumn = (
  config: FertiliserColumnConfig,
  fertiliser: Map<string, FertiliserFigures>,
  fields: FieldRecord[],
  loading: boolean,
): ColumnDef<FieldRecord, unknown> => {
  const {
    id,
    heading,
    unit,
    totalUnit,
    tooltip,
    pick,
    format,
    secondary,
    noFarmTotal,
  } = config
  const describeTotal = (amount: number) =>
    `${format(amount)} ${totalUnit} i alt`
  const figureOf = (field: FieldRecord): PerHaFigure | null => {
    const figures = fertiliser.get(field.id)
    const value = figures ? pick(figures) : null
    if (figures === undefined || value === null) return null
    return {
      value: `${format(value)} ${unit}`,
      total:
        (secondary
          ? secondary(figures)
          : describeTotal(value * field.areaHa)) ?? undefined,
    }
  }
  const label = (
    <div className="flex flex-col whitespace-nowrap">
      <span>{heading}</span>
      <span className={HEADER_SUBLINE_CLASS}>{unit}</span>
    </div>
  )
  return {
    id,
    header: () =>
      tooltip ? <AppTooltip content={tooltip}>{label}</AppTooltip> : label,
    cell: ({ row }) =>
      loading
        ? loadingFigure
        : (renderCellContent(figureOf(row.original)) ?? (
            <span className="text-muted-foreground">-</span>
          )),
    footer: () => {
      if (noFarmTotal) return null
      if (loading) return loadingFigure
      const total = totalFertiliser(fields, fertiliser, pick)
      if (total === null) return null
      return renderMetricFigure(
        {
          value: `${format(total.amount / total.areaHa)} ${unit}`,
          total: describeTotal(total.amount),
        },
        'footer',
      )
    },
    enableSorting: false,
    meta: {
      headerClassName: NUMERIC_HEADER_CLASS,
      cellClassName: NUMERIC_CELL_CLASS,
      // One entry in the column menu, so the gødning reads as a whole.
      toggleLabel: 'Gødning',
      toggleGroup: 'fertiliser',
      widthHints: loading ? undefined : contentWidthHints(figureOf),
    },
  }
}

export type FarmFieldsColumnsArgs = {
  isSimulationView: boolean
  maxYears: number
  selectedYearIndex: number | null
  fields: FieldRecord[]
  fertiliser: Map<string, FertiliserFigures>
  fertiliserLoading: boolean
  quota: FarmQuota
  catchmentLabel: (catchmentId: number | null) => string
  detachingFieldIds: string[]
  onRequestDetach?: (field: FieldRecord) => void
}

export const buildFarmFieldsColumns = ({
  isSimulationView,
  maxYears,
  selectedYearIndex,
  fields,
  fertiliser,
  fertiliserLoading,
  quota,
  catchmentLabel,
  detachingFieldIds,
  onRequestDetach,
}: FarmFieldsColumnsArgs): ColumnDef<FieldRecord, unknown>[] => {
  const { totals } = quota
  const list: ColumnDef<FieldRecord, unknown>[] = []

  list.push(
    nameColumn(() =>
      totals.uncalculatedCount > 0 ? (
        <>
          I alt
          <span className="hidden full:inline">
            {` (${totals.uncalculatedCount} ikke beregnet)`}
          </span>
        </>
      ) : (
        'I alt'
      ),
    ),
    areaColumn(() => `${formatNumber(totals.areaHa)} ha`),
  )

  const rotationStartYear = firstCalendarYear(!isSimulationView)
  const highlightIndex = selectedYearIndex
  const selectedCalendarYear =
    highlightIndex !== null ? rotationStartYear + highlightIndex : null
  const selectedYearOf = (field: FieldRecord) =>
    highlightIndex !== null ? field.cropRotation[highlightIndex] : undefined

  list.push({
    id: 'cropRotation',
    header: () => (
      <div className="flex flex-col">
        <span>{isSimulationView ? 'Sædskifte' : 'Afgrødehistorik'}</span>
        <span className={HEADER_SUBLINE_CLASS}>
          {selectedCalendarYear !== null
            ? `${selectedCalendarYear} valgt`
            : maxYears > 1
              ? `${rotationStartYear}-${rotationStartYear + maxYears - 1}`
              : rotationStartYear}
        </span>
      </div>
    ),
    cell: ({ row }) => {
      const rotation = row.original.cropRotation
      if (rotation.length === 0) {
        return (
          <span className="text-muted-foreground">
            {isSimulationView
              ? 'Intet sædskifte endnu'
              : 'Ingen afgrødehistorik endnu'}
          </span>
        )
      }
      return renderRotationSwatches(rotation, rotationStartYear, highlightIndex)
    },
    footer: () => {
      if (isSimulationView) return null
      const withoutRotation = fields.filter(
        (field) => field.cropRotation.length === 0,
      ).length
      return withoutRotation > 0 ? (
        <span className="text-muted-foreground">
          {withoutRotation} marker uden afgrødehistorik
        </span>
      ) : null
    },
    enableSorting: false,
    meta: {
      headerClassName: HEADER_CELL_CLASS,
      cellClassName: BODY_CELL_CLASS,
      toggleLabel: isSimulationView ? 'Sædskifte' : 'Afgrødehistorik',
      widthHints: [
        (field) => (field.cropRotation.length === 0 ? 1 : 0),
        ...Array.from(
          { length: maxYears },
          (_, index) => (field: FieldRecord) =>
            field.cropRotation.length === index + 1
              ? 1 + textWidth(uniqueCropNamesLabel(field.cropRotation))
              : 0,
        ),
      ],
    },
  })

  list.push({
    id: 'cropYear',
    header: () => (
      <div className="flex flex-col">
        <span>Afgrøde</span>
        <span className={HEADER_SUBLINE_CLASS}>
          {selectedCalendarYear !== null ? selectedCalendarYear : 'vælg et år'}
        </span>
      </div>
    ),
    cell: ({ row }) => {
      const year = selectedYearOf(row.original)
      if (!year) return <span className="text-muted-foreground">-</span>
      const label = formatRotationYear(year)
      return (
        <TruncatedTooltip
          content={label}
          className="block max-w-24 truncate full:max-w-40"
        >
          {label}
        </TruncatedTooltip>
      )
    },
    footer: () => null,
    enableSorting: false,
    meta: {
      headerClassName: cn(
        HEADER_CELL_CLASS,
        'whitespace-nowrap full:w-44',
        highlightIndex === null && 'hidden full:table-cell',
      ),
      cellClassName: cn(
        BODY_CELL_CLASS,
        'full:w-44',
        highlightIndex === null && 'hidden full:table-cell',
      ),
      widthHints: [
        (field) => {
          const year = selectedYearOf(field)
          return year ? textWidth(formatRotationYear(year)) : 0
        },
      ],
    },
  })

  if (isSimulationView) {
    list.push({
      id: 'nNormPct',
      accessorFn: (field) => fieldNNormPct(field),
      header: ({ column }) => (
        <SortableColumnHeaderContent label="N-norm%" column={column} />
      ),
      cell: ({ row }) => {
        const pct = fieldNNormPct(row.original)
        return pct === null ? (
          <span className="text-muted-foreground">-</span>
        ) : (
          `${formatNumber(pct)} %`
        )
      },
      // A level per mark, not something to total.
      footer: () => null,
      meta: {
        headerClassName: cn(NUMERIC_HEADER_CLASS, 'w-16 whitespace-nowrap'),
        cellClassName: cn(NUMERIC_CELL_CLASS, 'w-16'),
        toggleLabel: 'N-norm%',
      },
    })
  }

  list.push(
    numericMetricColumn(
      {
        key: 'db2',
        label: 'DB2 (kr/ha)',
        heading: 'DB2',
        emptyCell: (placement) =>
          placement === 'cell' ? (
            <Badge
              variant="outline"
              className="font-normal text-muted-foreground"
            >
              Ikke beregnet
            </Badge>
          ) : (
            <span className="font-normal text-muted-foreground">
              Ikke beregnet
            </span>
          ),
      },
      isSimulationView,
      totals,
    ),
    {
      id: 'quotaStatus',
      header: () => 'Udledning mod kvote',
      cell: ({ row }) =>
        renderQuotaStatus(getFieldQuotaStatus(row.original, isSimulationView)),
      footer: () => renderQuotaStatusFooter(quota),
      enableSorting: false,
      meta: {
        headerClassName: NUMERIC_HEADER_CLASS,
        cellClassName: NUMERIC_CELL_CLASS,
        toggleLabel: 'Udledning mod kvote',
        widthHints: [
          (field) =>
            textWidth(
              quotaStatusText(getFieldQuotaStatus(field, isSimulationView)),
            ),
        ],
      },
    },
    // Per hectare for the selected year, or the average per year. Only in a
    // simulation, not in the afgrødehistorik.
    ...(isSimulationView
      ? FERTILISER_COLUMNS.map((config) =>
          fertiliserColumn(config, fertiliser, fields, fertiliserLoading),
        )
      : []),
    {
      id: 'catchment',
      accessorFn: (field) => field.catchmentId,
      header: ({ column }) => (
        <SortableColumnHeaderContent label="Kystvandopland" column={column} />
      ),
      cell: ({ row }) => {
        const { catchmentId } = row.original
        const label = catchmentLabel(catchmentId)
        if (catchmentId === null) {
          return <span className="text-muted-foreground">{label}</span>
        }
        return (
          <TruncatedTooltip content={label} className="block max-w-40 truncate">
            {label}
          </TruncatedTooltip>
        )
      },
      footer: () => null,
      meta: {
        headerClassName: HEADER_CELL_CLASS,
        cellClassName: BODY_CELL_CLASS,
        toggleLabel: 'Kystvandopland',
        widthHints: [(field) => textWidth(catchmentLabel(field.catchmentId))],
      },
    },
    numericMetricColumn(
      {
        key: 'nLoad',
        label: 'Kvælstofudledning (kg N/ha)',
        heading: 'Kvælstofudledning',
        emptyCell: () => <span className="text-muted-foreground">-</span>,
        quotaGated: true,
      },
      isSimulationView,
      totals,
    ),
    numericMetricColumn(
      {
        key: 'leaching',
        label: 'Udvaskning (kg N/ha)',
        heading: 'Udvaskning',
        emptyCell: () => <span className="text-muted-foreground">-</span>,
        quotaGated: true,
      },
      isSimulationView,
      totals,
    ),
    numericMetricColumn(
      {
        key: 'feedUnits',
        label: 'Foderenheder (FE/ha)',
        heading: 'Foderenheder',
        emptyCell: () => <span className="text-muted-foreground">-</span>,
      },
      isSimulationView,
      totals,
    ),
    {
      accessorKey: 'nLoadQuotaKgN',
      header: ({ column }) => (
        <SortableColumnHeaderContent
          label="Kvotebidrag"
          unit="kg N"
          align="right"
          column={column}
        />
      ),
      cell: ({ row }) => renderCellContent(nLoadQuotaContent(row.original)),
      footer: () =>
        quota.quotaKgN === null ? null : (
          <div>{formatNumber(totals.nLoadQuotaKgN)} kg N</div>
        ),
      meta: {
        headerClassName: NUMERIC_HEADER_CLASS,
        cellClassName: NUMERIC_CELL_CLASS,
        toggleLabel: 'Kvote (kg N)',
        widthHints: contentWidthHints(nLoadQuotaContent),
      },
    },
    {
      id: 'soilSummary',
      header: () => 'Jord',
      cell: ({ row }) => {
        const summary = soilSummary(row.original)
        return summary === null ? (
          <span className="text-muted-foreground">{UNKNOWN_LABEL}</span>
        ) : (
          <span>{summary}</span>
        )
      },
      enableSorting: false,
      meta: {
        headerClassName: HEADER_CELL_CLASS,
        cellClassName: BODY_CELL_CLASS,
        toggleLabel: 'Jord',
        widthHints: [(field) => textWidth(soilSummary(field) ?? UNKNOWN_LABEL)],
      },
    },
    {
      accessorKey: 'inTakeoutPlan',
      header: ({ column }) => (
        <SortableColumnHeaderContent label="Omlægningsplan" column={column} />
      ),
      cell: ({ row }) => row.original.inTakeoutPlan,
      meta: {
        headerClassName: HEADER_CELL_CLASS,
        cellClassName: BODY_CELL_CLASS,
        toggleLabel: 'Omlægningsplan',
        widthHints: [(field) => textWidth(field.inTakeoutPlan)],
      },
    },
    {
      accessorKey: 'retention',
      header: ({ column }) => (
        <SortableColumnHeaderContent
          label="Retention"
          align="right"
          column={column}
        />
      ),
      cell: ({ row }) => retentionText(row.original),
      meta: {
        headerClassName: NUMERIC_HEADER_CLASS,
        cellClassName: NUMERIC_CELL_CLASS,
        toggleLabel: 'Retention',
        widthHints: [(field) => textWidth(retentionText(field))],
      },
    },
    {
      accessorKey: 'soilTypeNumber',
      header: ({ column }) => (
        <SortableColumnHeaderContent
          label="JB nr."
          align="right"
          column={column}
        />
      ),
      cell: ({ row }) => soilTypeText(row.original),
      meta: {
        headerClassName: NUMERIC_HEADER_CLASS,
        cellClassName: NUMERIC_CELL_CLASS,
        toggleLabel: 'JB nr.',
        widthHints: [(field) => textWidth(soilTypeText(field))],
      },
    },
  )

  if (onRequestDetach) {
    list.push(detachColumn(detachingFieldIds, onRequestDetach))
  }
  list.push(rowAffordanceColumn)

  return list
}
