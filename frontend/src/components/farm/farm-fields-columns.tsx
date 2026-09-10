import type { ColumnDef, RowData } from '@tanstack/react-table'
import { ChevronRight, Lock, LockOpen } from 'lucide-react'
import type { ReactNode } from 'react'

import type { FieldRecord } from '@/api/types'
import { CropYearSwatch } from '@/components/farm/CropYearSwatch'
import { QuotaStatusIndicator } from '@/components/farm/QuotaStatusIndicator'
import { SortableColumnHeaderContent } from '@/components/farm/SortableColumnHeaderContent'
import type { FarmInspectorMode } from '@/components/farm/types'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { cropGroupColor } from '@/lib/crop-groups'
import {
  describeUncalculatedCount,
  formatCompactKr,
  formatLockTooltip,
  formatNumber,
  formatQuotaAmount,
  formatRotationYear,
  getFieldQuotaStatus,
  isFieldCalculated,
  isFieldLocked,
  REAL_HISTORY_START_CALENDAR_YEAR,
  resolveFarmQuota,
  ROTATION_START_CALENDAR_YEAR,
  type FieldTotals,
  type QuotaStatus,
  type QuotaStatusLevel,
} from '@/lib/field-domain'
import { cn } from '@/lib/utils'

declare module '@tanstack/react-table' {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  interface ColumnMeta<TData extends RowData, TValue> {
    headerClassName?: string
    cellClassName?: string
    toggleLabel?: string
  }
}

const CELL_X_PADDING = 'px-2 full:px-2.5'
const HEADER_CELL_CLASS = `${CELL_X_PADDING} py-2 align-top text-xs font-medium whitespace-normal text-muted-foreground`
const HEADER_SUBLINE_CLASS = 'block text-[11px] leading-4 font-normal'
const BODY_CELL_CLASS = `${CELL_X_PADDING} py-1 whitespace-nowrap full:py-1.5`
const NUMERIC_HEADER_CLASS = `${HEADER_CELL_CLASS} text-right`
const NUMERIC_CELL_CLASS = `${BODY_CELL_CLASS} text-right`
const PER_HECTARE_CLASS = 'hidden text-xs text-muted-foreground full:block'

const uniqueCropNames = (rotation: FieldRecord['cropRotation']): string[] => {
  const seenNames: string[] = []
  for (const year of rotation) {
    if (!seenNames.includes(year.afgrodeNavn)) seenNames.push(year.afgrodeNavn)
  }
  return seenNames
}

const cropFirstWord = (name: string): string =>
  name.trim().split(/\s+/)[0].replace(/[,.-]+$/, '')

const uniqueCropNamesLabel = (rotation: FieldRecord['cropRotation']): string => {
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

const renderQuotaStatus = (status: QuotaStatus) => {
  const placeholder = renderQuotaPlaceholder(status.level)
  if (placeholder) return placeholder

  const amountText = formatQuotaAmount(status.nLoad, status.quotaKgn)

  if (status.level === 'partial') {
    return (
      <QuotaStatusIndicator level={status.level} className="justify-end">
        <span className="text-muted-foreground">{amountText}</span>
      </QuotaStatusIndicator>
    )
  }

  return (
    <QuotaStatusIndicator
      level={status.level}
      badge
      className="flex-nowrap justify-end"
      badgeClassName="sr-only full:not-sr-only"
    >
      {amountText}
    </QuotaStatusIndicator>
  )
}

const renderQuotaStatusFooter = (
  totals: FieldTotals,
  level: QuotaStatusLevel,
  catchmentNote: string | null,
) => {
  const placeholder = renderQuotaPlaceholder(level)
  if (placeholder) return placeholder

  const quota = resolveFarmQuota(totals.udledningskvoteMarkKgn)
  const notes: string[] = [quota.basis]
  const uncalculatedNote = describeUncalculatedCount(totals)
  if (uncalculatedNote) notes.push(uncalculatedNote)
  if (catchmentNote) notes.push(catchmentNote)

  return (
    <div className="space-y-0.5 text-right">
      <QuotaStatusIndicator
        level={level}
        badge={level !== 'partial'}
        className={cn(
          'flex-nowrap justify-end',
          level === 'partial' && 'text-muted-foreground',
        )}
        badgeClassName="sr-only full:not-sr-only"
      >
        {formatQuotaAmount(totals.nLoad, quota.quotaKgn)}
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
  key: 'db2' | 'nLoad' | 'leaching' | 'fen'
  label: string
  heading: string
  unit: string
  emptyCell: (placement: 'cell' | 'footer') => ReactNode
  compactValue?: (value: number) => string
}

const renderMetricValue = (
  value: number,
  unit: string,
  compactValue?: (value: number) => string,
): ReactNode => {
  const full = `${formatNumber(value)} ${unit}`
  if (!compactValue) return <div className="font-medium">{full}</div>
  return (
    <div className="font-medium">
      <span className="full:hidden">{compactValue(value)}</span>
      <span className="hidden full:inline">{full}</span>
    </div>
  )
}

const numericMetricColumn = (
  config: NumericMetricColumnConfig,
  isSimulationView: boolean,
  totals: FieldTotals,
): ColumnDef<FieldRecord, unknown> => {
  const { key, label, heading, unit, emptyCell, compactValue } = config
  return {
    accessorKey: key,
    header: ({ column }) => (
      <SortableColumnHeaderContent
        label={heading}
        unit={unit}
        align="right"
        column={column}
      />
    ),
    cell: ({ row }) => {
      const field = row.original
      if (!isFieldCalculated(field, isSimulationView)) {
        return emptyCell('cell')
      }
      const value = field[key]
      return (
        <>
          {renderMetricValue(value, unit, compactValue)}
          {field.areaHa > 0 ? (
            <div className={PER_HECTARE_CLASS}>
              {`${formatNumber(value / field.areaHa)} ${unit}/ha`}
            </div>
          ) : null}
        </>
      )
    },
    footer: () =>
      totals.calculatedCount === 0
        ? emptyCell('footer')
        : renderMetricValue(totals[key], unit, compactValue),
    meta: {
      headerClassName: NUMERIC_HEADER_CLASS,
      cellClassName: NUMERIC_CELL_CLASS,
      toggleLabel: label,
    },
  }
}

const renderRotationSwatches = (
  rotation: FieldRecord['cropRotation'],
  rotationStartYear: number,
  highlightIndex: number | null = null,
) => (
  <div className="flex items-center gap-2.5">
    <div className="flex shrink-0 gap-0.5">
      {rotation.map((year, index) => {
        const calendarYear = rotationStartYear + index
        const hasUdlaeg = year.udlaegNavn !== null
        const title = hasUdlaeg
          ? `${calendarYear}: ${year.afgrodeNavn} (udlæg: ${year.udlaegNavn})`
          : `${calendarYear}: ${year.afgrodeNavn}`
        const color = cropGroupColor(year.afgrodeKode, year.afgrodeNavn)
        const isHighlighted = highlightIndex === index
        return (
          <span
            key={index}
            className={cn(
              'inline-flex rounded-xs motion-safe:transition-[opacity,box-shadow] motion-safe:duration-300',
              isHighlighted && 'ring-2 ring-primary ring-offset-1',
              highlightIndex !== null && !isHighlighted && 'opacity-60',
            )}
          >
            <CropYearSwatch
              title={title}
              color={color}
              hasUdlaeg={hasUdlaeg}
              size="12x16"
              className="w-3 full:w-4"
            />
          </span>
        )
      })}
    </div>
    <span
      className="hidden min-w-0 max-w-40 truncate text-sm full:block"
      title={uniqueCropNames(rotation).join(' · ')}
    >
      {uniqueCropNamesLabel(rotation)}
    </span>
  </div>
)

const nameColumn = (
  footer: () => ReactNode,
): ColumnDef<FieldRecord, unknown> => ({
  accessorKey: 'name',
  header: ({ column }) => (
    <SortableColumnHeaderContent label="Mark" column={column} />
  ),
  cell: ({ row }) => {
    const rowField = row.original
    return (
      <span className="flex items-center gap-1.5">
        <span>{rowField.name}</span>
        {isFieldLocked(rowField) ? (
          <span title={formatLockTooltip(rowField)}>
            <Lock
              className="h-3.5 w-3.5 shrink-0 text-amber-600"
              aria-hidden="true"
            />
            <span className="sr-only">Låst</span>
          </span>
        ) : null}
      </span>
    )
  },
  footer,
  meta: {
    headerClassName: HEADER_CELL_CLASS,
    cellClassName: cn(BODY_CELL_CLASS, 'font-semibold'),
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

type RulesColumnsArgs = {
  fields: FieldRecord[]
  canEditRules: boolean
  lockingFieldId: string | null
  onToggleLock: (field: FieldRecord) => void
  onBindRotation: (field: FieldRecord) => void
}

const buildRulesColumns = ({
  fields,
  canEditRules,
  lockingFieldId,
  onToggleLock,
  onBindRotation,
}: RulesColumnsArgs): ColumnDef<FieldRecord, unknown>[] => {
  const lockedCount = fields.filter(isFieldLocked).length
  const list: ColumnDef<FieldRecord, unknown>[] = [
    nameColumn(() => `${lockedCount} af ${fields.length} marker låst`),
    areaColumn(() => null),
    {
      id: 'lockStatus',
      header: () => 'Status',
      cell: ({ row }) =>
        isFieldLocked(row.original) ? (
          <span
            title={formatLockTooltip(row.original)}
            className="inline-flex items-center gap-1.5 rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800"
          >
            <Lock className="h-3 w-3" aria-hidden="true" />
            Låst
          </span>
        ) : (
          <span className="inline-flex items-center gap-1.5 rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">
            <LockOpen className="h-3 w-3" aria-hidden="true" />
            Fri
          </span>
        ),
      enableSorting: false,
      meta: {
        headerClassName: HEADER_CELL_CLASS,
        cellClassName: BODY_CELL_CLASS,
      },
    },
    {
      id: 'boundRotation',
      header: () => 'Bundet sædskifte',
      cell: ({ row }) => {
        const field = row.original
        if (!isFieldLocked(field) || field.cropRotation.length === 0) {
          return (
            <span className="text-muted-foreground">Optimeringen vælger</span>
          )
        }
        return renderRotationSwatches(
          field.cropRotation,
          ROTATION_START_CALENDAR_YEAR,
        )
      },
      enableSorting: false,
      meta: {
        headerClassName: cn('hidden md:table-cell', HEADER_CELL_CLASS),
        cellClassName: cn('hidden md:table-cell', BODY_CELL_CLASS),
      },
    },
    {
      id: 'allowedRotations',
      header: () => (
        <span title="Kan ikke ændres endnu - låsning giver 1, ellers alle">
          Tilladte sædskifter
        </span>
      ),
      cell: ({ row }) =>
        row.original.allowedRotationIds.length === 0 ? (
          <span className="text-muted-foreground">Alle i simuleringen</span>
        ) : (
          `${row.original.allowedRotationIds.length} valgt`
        ),
      enableSorting: false,
      meta: {
        headerClassName: cn('hidden md:table-cell', HEADER_CELL_CLASS),
        cellClassName: cn('hidden md:table-cell', BODY_CELL_CLASS),
      },
    },
  ]

  if (canEditRules) {
    list.push({
      id: 'ruleActions',
      header: () => 'Handlinger',
      cell: ({ row }) => {
        const field = row.original
        const locked = isFieldLocked(field)
        const noRotation = field.rotationId === null
        return (
          <div className="flex flex-nowrap items-center justify-end gap-2">
            <Button
              size="xs"
              variant="outline"
              className="px-2.5"
              disabled={noRotation}
              onClick={() => onBindRotation(field)}
              title={
                noRotation
                  ? 'Kør Optimér for denne mark, før du kan binde et sædskifte.'
                  : 'Vælg et bestemt sædskifte og lås marken til det, så optimeringen respekterer valget.'
              }
            >
              Vælg og lås sædskifte...
            </Button>
            <Button
              size="xs"
              variant="ghost"
              onClick={() => onToggleLock(field)}
              disabled={noRotation || lockingFieldId === field.id}
              className={
                locked
                  ? 'gap-1.5 px-2.5 bg-amber-100 text-amber-800 hover:bg-amber-200 hover:text-amber-900'
                  : 'gap-1.5 px-2.5 text-muted-foreground'
              }
              title={
                locked
                  ? 'Marken er låst til det valgte sædskifte - Optimér ændrer den ikke. Klik for at låse op.'
                  : 'Marken er ikke låst - Optimér kan frit ændre den. Klik for at låse til det nuværende sædskifte.'
              }
            >
              {locked ? (
                <Lock className="h-4 w-4" aria-hidden="true" />
              ) : (
                <LockOpen className="h-4 w-4" aria-hidden="true" />
              )}
              {locked ? 'Lås op' : 'Lås'}
            </Button>
          </div>
        )
      },
      enableSorting: false,
      meta: {
        headerClassName: cn(HEADER_CELL_CLASS, 'text-right whitespace-nowrap'),
        cellClassName: NUMERIC_CELL_CLASS,
      },
    })
  }

  return list
}

export type FarmFieldsColumnsArgs = {
  isSimulationView: boolean
  mode: FarmInspectorMode
  maxYears: number
  selectedYearIndex: number | null
  fields: FieldRecord[]
  totals: FieldTotals
  quotaFooterLevel: QuotaStatusLevel
  quotaFooterNote: string | null
  catchmentLabel: (kystvandId: number | null) => string
  canEditRules: boolean
  lockingFieldId: string | null
  onToggleLock: (field: FieldRecord) => void
  onBindRotation: (field: FieldRecord) => void
}

export const buildFarmFieldsColumns = ({
  isSimulationView,
  mode,
  maxYears,
  selectedYearIndex,
  fields,
  totals,
  quotaFooterLevel,
  quotaFooterNote,
  catchmentLabel,
  canEditRules,
  lockingFieldId,
  onToggleLock,
  onBindRotation,
}: FarmFieldsColumnsArgs): ColumnDef<FieldRecord, unknown>[] => {
  if (mode === 'rules') {
    return buildRulesColumns({
      fields,
      canEditRules,
      lockingFieldId,
      onToggleLock,
      onBindRotation,
    })
  }

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

  const rotationStartYear = isSimulationView
    ? ROTATION_START_CALENDAR_YEAR
    : REAL_HISTORY_START_CALENDAR_YEAR
  const highlightIndex = selectedYearIndex
  const selectedCalendarYear =
    highlightIndex !== null ? rotationStartYear + highlightIndex : null

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
        const year =
          highlightIndex !== null
            ? row.original.cropRotation[highlightIndex]
            : undefined
        if (!year) return <span className="text-muted-foreground">-</span>
        const label = formatRotationYear(year)
        return (
          <span className="block max-w-24 truncate full:max-w-40" title={label}>
            {label}
          </span>
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
      },
    })

  list.push(
    numericMetricColumn(
      {
        key: 'db2',
        label: 'DB2 (kr)',
        heading: 'DB2',
        unit: 'kr',
        emptyCell: (placement) =>
          placement === 'cell' ? (
            <Badge variant="outline" className="font-normal text-muted-foreground">
              Ikke beregnet
            </Badge>
          ) : (
            <span className="font-normal text-muted-foreground">Ikke beregnet</span>
          ),
        compactValue: formatCompactKr,
      },
      isSimulationView,
      totals,
    ),
    {
      id: 'quotaStatus',
      header: () => 'Udledning mod kvote',
      cell: ({ row }) =>
        renderQuotaStatus(
          getFieldQuotaStatus(row.original, isSimulationView),
        ),
      footer: () =>
        renderQuotaStatusFooter(totals, quotaFooterLevel, quotaFooterNote),
      enableSorting: false,
      meta: {
        headerClassName: NUMERIC_HEADER_CLASS,
        cellClassName: NUMERIC_CELL_CLASS,
        toggleLabel: 'Udledning mod kvote',
      },
    },
    {
      id: 'kystvandopland',
      accessorFn: (field) => field.kystvandId,
      header: ({ column }) => (
        <SortableColumnHeaderContent label="Kystvandopland" column={column} />
      ),
      cell: ({ row }) => {
        const { kystvandId } = row.original
        const label = catchmentLabel(kystvandId)
        if (kystvandId === null) {
          return <span className="text-muted-foreground">{label}</span>
        }
        return (
          <span className="block max-w-40 truncate" title={label}>
            {label}
          </span>
        )
      },
      footer: () => null,
      meta: {
        headerClassName: HEADER_CELL_CLASS,
        cellClassName: BODY_CELL_CLASS,
        toggleLabel: 'Kystvandopland',
      },
    },
    numericMetricColumn(
      {
        key: 'nLoad',
        label: 'Kvælstofudledning (kg N)',
        heading: 'Kvælstofudledning',
        unit: 'kg N',
        emptyCell: () => <span className="text-muted-foreground">-</span>,
      },
      isSimulationView,
      totals,
    ),
    numericMetricColumn(
      {
        key: 'leaching',
        label: 'Udvaskning (kg N)',
        heading: 'Udvaskning',
        unit: 'kg N',
        emptyCell: () => <span className="text-muted-foreground">-</span>,
      },
      isSimulationView,
      totals,
    ),
    numericMetricColumn(
      {
        key: 'fen',
        label: 'Foderenheder (FE)',
        heading: 'Foderenheder',
        unit: 'FE',
        emptyCell: () => <span className="text-muted-foreground">-</span>,
      },
      isSimulationView,
      totals,
    ),
    {
      accessorKey: 'udledningskvoteMarkKgn',
      header: ({ column }) => (
        <SortableColumnHeaderContent
          label="Kvote"
          unit="kg N"
          align="right"
          column={column}
        />
      ),
      cell: ({ row }) => {
        const field = row.original
        if (field.udledningskvoteMarkKgn === 0) {
          return <span className="text-muted-foreground">Ingen data</span>
        }
        return (
          <>
            <div className="font-medium">
              {formatNumber(field.udledningskvoteMarkKgn)} kg N
            </div>
            {field.areaHa > 0 ? (
              <div className={PER_HECTARE_CLASS}>
                {formatNumber(field.udledningskvoteMarkKgn / field.areaHa)} kg
                N/ha
              </div>
            ) : null}
          </>
        )
      },
      footer: () => (
        <div>{formatNumber(totals.udledningskvoteMarkKgn)} kg N</div>
      ),
      meta: {
        headerClassName: NUMERIC_HEADER_CLASS,
        cellClassName: NUMERIC_CELL_CLASS,
        toggleLabel: 'Kvote (kg N)',
      },
    },
    {
      id: 'soilSummary',
      header: () => 'Jord',
      cell: ({ row }) => {
        const { jbnr, retention } = row.original
        if (jbnr === null || retention === null) {
          return <span className="text-muted-foreground">Ukendt</span>
        }
        return (
          <span>
            JB {jbnr} - retention {formatNumber(retention)}
          </span>
        )
      },
      enableSorting: false,
      meta: {
        headerClassName: HEADER_CELL_CLASS,
        cellClassName: BODY_CELL_CLASS,
        toggleLabel: 'Jord',
      },
    },
    {
      accessorKey: 'inTakeoutPlan',
      header: ({ column }) => (
        <SortableColumnHeaderContent
          label="Omlægningsplan"
          column={column}
        />
      ),
      cell: ({ row }) => row.original.inTakeoutPlan,
      meta: {
        headerClassName: HEADER_CELL_CLASS,
        cellClassName: BODY_CELL_CLASS,
        toggleLabel: 'Omlægningsplan',
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
      cell: ({ row }) =>
        row.original.retention === null
          ? 'Ukendt'
          : formatNumber(row.original.retention),
      meta: {
        headerClassName: NUMERIC_HEADER_CLASS,
        cellClassName: NUMERIC_CELL_CLASS,
        toggleLabel: 'Retention',
      },
    },
    {
      accessorKey: 'jbnr',
      header: ({ column }) => (
        <SortableColumnHeaderContent
          label="JB nr."
          align="right"
          column={column}
        />
      ),
      cell: ({ row }) =>
        row.original.jbnr === null ? 'Ukendt' : row.original.jbnr,
      meta: {
        headerClassName: NUMERIC_HEADER_CLASS,
        cellClassName: NUMERIC_CELL_CLASS,
        toggleLabel: 'JB nr.',
      },
    },
  )

  list.push(rowAffordanceColumn)

  return list
}
