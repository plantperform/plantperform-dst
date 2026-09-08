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
import {
  CROP_YEAR_FALLBACK_COLOR,
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

export const OPTIONAL_COLUMN_IDS = [
  'cropRotation',
  'db2',
  'quotaStatus',
  'nLoad',
  'leaching',
  'fen',
  'udledningskvoteMarkKgn',
  'soilSummary',
  'inTakeoutPlan',
  'retention',
  'jbnr',
]

const uniqueCropNamesLabel = (rotation: FieldRecord['cropRotation']): string => {
  const seenNames: string[] = []
  for (const year of rotation) {
    if (!seenNames.includes(year.afgrodeNavn)) seenNames.push(year.afgrodeNavn)
  }
  const firstWords = seenNames
    .slice(0, 2)
    .map((name) => name.trim().split(/\s+/)[0])
  return seenNames.length > 2 ? `${firstWords.join(' + ')} m.fl.` : firstWords.join(' + ')
}

const renderQuotaStatus = (status: QuotaStatus) => {
  if (status.level === 'uncalculated') {
    return (
      <QuotaStatusIndicator level={status.level}>
        <span className="text-muted-foreground">Ikke beregnet</span>
      </QuotaStatusIndicator>
    )
  }
  if (status.level === 'noData') {
    return (
      <QuotaStatusIndicator level={status.level}>
        <span className="text-muted-foreground">Ingen data</span>
      </QuotaStatusIndicator>
    )
  }

  const amountText = formatQuotaAmount(status)

  if (status.level === 'partial') {
    return (
      <QuotaStatusIndicator level={status.level}>
        <span className="text-muted-foreground">{amountText}</span>
      </QuotaStatusIndicator>
    )
  }

  return (
    <QuotaStatusIndicator level={status.level} badge>
      {amountText}
    </QuotaStatusIndicator>
  )
}

const renderQuotaStatusFooter = (
  totals: FieldTotals,
  level: QuotaStatusLevel,
  catchmentNote: string | null,
) => {
  if (level === 'uncalculated') {
    return (
      <QuotaStatusIndicator level={level}>
        <span className="font-normal text-muted-foreground">Ikke beregnet</span>
      </QuotaStatusIndicator>
    )
  }
  if (level === 'noData') {
    return (
      <QuotaStatusIndicator level={level}>
        <span className="font-normal text-muted-foreground">Ingen data</span>
      </QuotaStatusIndicator>
    )
  }

  const quota = resolveFarmQuota(totals.udledningskvoteMarkKgn)
  const notes: string[] = [quota.basis]
  if (totals.calculatedCount > 0 && totals.uncalculatedCount > 0) {
    notes.push(`${totals.uncalculatedCount} ikke beregnet`)
  }
  if (catchmentNote) notes.push(catchmentNote)

  return (
    <div className="space-y-0.5">
      <QuotaStatusIndicator
        level={level}
        badge={level !== 'partial'}
        className={level === 'partial' ? 'text-muted-foreground' : undefined}
      >
        {formatQuotaAmount({
          level,
          nLoad: totals.nLoad,
          quotaKgn: quota.quotaKgn,
        })}
      </QuotaStatusIndicator>
      <div className="text-xs font-normal text-muted-foreground">
        {notes.join(', ')}
      </div>
    </div>
  )
}

type NumericMetricColumnConfig = {
  key: 'db2' | 'nLoad' | 'leaching' | 'fen'
  label: string
  unit: string
  emptyCell: (placement: 'cell' | 'footer') => ReactNode
}

const numericMetricColumn = (
  config: NumericMetricColumnConfig,
  isSimulationView: boolean,
  totals: FieldTotals,
): ColumnDef<FieldRecord, unknown> => {
  const { key, label, unit, emptyCell } = config
  return {
    accessorKey: key,
    header: ({ column }) => (
      <SortableColumnHeaderContent label={label} column={column} />
    ),
    cell: ({ row }) => {
      const field = row.original
      if (!isFieldCalculated(field, isSimulationView)) {
        return emptyCell('cell')
      }
      const value = field[key]
      return (
        <>
          <div>{`${formatNumber(value)} ${unit}`}</div>
          {field.areaHa > 0 ? (
            <div className="text-xs text-muted-foreground/80">
              {`${formatNumber(value / field.areaHa)} ${unit}/ha`}
            </div>
          ) : null}
        </>
      )
    },
    footer: () =>
      totals.calculatedCount === 0 ? (
        emptyCell('footer')
      ) : (
        <div>{`${formatNumber(totals[key])} ${unit}`}</div>
      ),
    meta: {
      headerClassName: 'px-4 py-3 font-medium whitespace-normal',
      cellClassName: 'px-4 py-3 whitespace-normal',
      toggleLabel: label,
    },
  }
}

const renderRotationSwatches = (
  rotation: FieldRecord['cropRotation'],
  rotationStartYear: number,
  cropColorMap: Map<number, string>,
  highlightIndex: number | null = null,
) => (
  <div className="flex items-center gap-2.5">
    <div className="flex shrink-0 gap-[3px]">
      {rotation.map((year, index) => {
        const calendarYear = rotationStartYear + index
        const hasUdlaeg = year.udlaegNavn !== null
        const title = hasUdlaeg
          ? `${calendarYear}: ${year.afgrodeNavn} (udlæg: ${year.udlaegNavn})`
          : `${calendarYear}: ${year.afgrodeNavn}`
        const color =
          cropColorMap.get(year.afgrodeKode) ?? CROP_YEAR_FALLBACK_COLOR
        const isHighlighted = highlightIndex === index
        return (
          <span
            key={index}
            className={cn(
              'inline-flex rounded-sm motion-safe:transition-[opacity,box-shadow] motion-safe:duration-300',
              isHighlighted && 'ring-2 ring-primary ring-offset-1',
              highlightIndex !== null && !isHighlighted && 'opacity-60',
            )}
          >
            <CropYearSwatch
              title={title}
              color={color}
              hasUdlaeg={hasUdlaeg}
              size="14x10"
            />
          </span>
        )
      })}
    </div>
    <span className="text-sm">{uniqueCropNamesLabel(rotation)}</span>
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
    headerClassName: 'px-4 py-3 font-medium whitespace-normal',
    cellClassName: 'px-4 py-3 font-medium whitespace-normal',
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
    headerClassName: 'px-4 py-3 font-medium whitespace-normal',
    cellClassName: 'px-4 py-3 whitespace-normal',
  },
})

const rowAffordanceColumn: ColumnDef<FieldRecord, unknown> = {
  id: 'rowAffordance',
  header: () => null,
  cell: () => (
    <ChevronRight
      className="h-4 w-4 text-muted-foreground/60"
      aria-hidden="true"
    />
  ),
  enableSorting: false,
  meta: {
    headerClassName: 'w-8 px-2 py-3',
    cellClassName: 'w-8 px-2 py-3 text-right',
  },
}

type RulesColumnsArgs = {
  fields: FieldRecord[]
  cropColorMap: Map<number, string>
  canEditRules: boolean
  lockingFieldId: string | null
  onToggleLock: (field: FieldRecord) => void
  onBindRotation: (field: FieldRecord) => void
}

const buildRulesColumns = ({
  fields,
  cropColorMap,
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
        headerClassName: 'px-4 py-3 font-medium whitespace-normal',
        cellClassName: 'px-4 py-3 whitespace-normal',
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
          cropColorMap,
        )
      },
      enableSorting: false,
      meta: {
        headerClassName:
          'hidden px-4 py-3 font-medium whitespace-normal md:table-cell',
        cellClassName: 'hidden px-4 py-3 whitespace-normal md:table-cell',
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
        headerClassName:
          'hidden px-4 py-3 font-medium whitespace-normal md:table-cell',
        cellClassName: 'hidden px-4 py-3 whitespace-normal md:table-cell',
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
        headerClassName: 'px-4 py-3 text-right font-medium whitespace-nowrap',
        cellClassName: 'px-4 py-3 text-right whitespace-nowrap',
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
  cropColorMap: Map<number, string>
  totals: FieldTotals
  quotaFooterLevel: QuotaStatusLevel
  quotaFooterNote: string | null
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
  cropColorMap,
  totals,
  quotaFooterLevel,
  quotaFooterNote,
  canEditRules,
  lockingFieldId,
  onToggleLock,
  onBindRotation,
}: FarmFieldsColumnsArgs): ColumnDef<FieldRecord, unknown>[] => {
  if (mode === 'rules') {
    return buildRulesColumns({
      fields,
      cropColorMap,
      canEditRules,
      lockingFieldId,
      onToggleLock,
      onBindRotation,
    })
  }

  const list: ColumnDef<FieldRecord, unknown>[] = []

  list.push(
    nameColumn(() =>
      totals.uncalculatedCount > 0
        ? `I alt (${totals.uncalculatedCount} ikke beregnet)`
        : 'I alt',
    ),
    areaColumn(() => `${formatNumber(totals.areaHa)} ha`),
  )

  const rotationStartYear = isSimulationView
    ? ROTATION_START_CALENDAR_YEAR
    : REAL_HISTORY_START_CALENDAR_YEAR
  const highlightIndex = isSimulationView ? selectedYearIndex : null
  const selectedCalendarYear =
    highlightIndex !== null ? rotationStartYear + highlightIndex : null

  list.push({
    id: 'cropRotation',
    header: () => (
      <div className="flex flex-col">
        <span>{isSimulationView ? 'Sædskifte' : 'Afgrødehistorik'}</span>
        <span className="block text-xs font-normal text-muted-foreground">
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
      return renderRotationSwatches(
        rotation,
        rotationStartYear,
        cropColorMap,
        highlightIndex,
      )
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
      headerClassName: 'px-4 py-3 font-medium whitespace-normal',
      cellClassName: 'px-4 py-3 whitespace-normal',
      toggleLabel: isSimulationView ? 'Sædskifte' : 'Afgrødehistorik',
    },
  })

  if (isSimulationView) {
    list.push({
      id: 'cropYear',
      header: () => (
        <div className="flex flex-col">
          <span>Afgrøde</span>
          <span className="block text-xs font-normal text-muted-foreground">
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
          <span className="block max-w-40 truncate" title={label}>
            {label}
          </span>
        )
      },
      footer: () => null,
      enableSorting: false,
      meta: {
        headerClassName: 'w-44 px-4 py-3 font-medium whitespace-nowrap',
        cellClassName: 'w-44 px-4 py-3 whitespace-nowrap',
      },
    })
  }

  list.push(
    numericMetricColumn(
      {
        key: 'db2',
        label: 'DB2 (kr)',
        unit: 'kr',
        emptyCell: (placement) =>
          placement === 'cell' ? (
            <Badge variant="outline" className="font-normal text-muted-foreground">
              Ikke beregnet
            </Badge>
          ) : (
            <span className="font-normal text-muted-foreground">Ikke beregnet</span>
          ),
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
        headerClassName: 'px-4 py-3 font-medium whitespace-normal',
        cellClassName: 'px-4 py-3 whitespace-normal',
        toggleLabel: 'Udledning mod kvote',
      },
    },
    numericMetricColumn(
      {
        key: 'nLoad',
        label: 'Kvælstofudledning (kg N)',
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
        unit: 'FE',
        emptyCell: () => <span className="text-muted-foreground">-</span>,
      },
      isSimulationView,
      totals,
    ),
    {
      accessorKey: 'udledningskvoteMarkKgn',
      header: ({ column }) => (
        <SortableColumnHeaderContent label="Kvote (kg N)" column={column} />
      ),
      cell: ({ row }) => {
        const field = row.original
        if (field.udledningskvoteMarkKgn === 0) {
          return <span className="text-muted-foreground">Ingen data</span>
        }
        return (
          <>
            <div>{formatNumber(field.udledningskvoteMarkKgn)} kg N</div>
            {field.areaHa > 0 ? (
              <div className="text-xs text-muted-foreground/80">
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
        headerClassName: 'px-4 py-3 font-medium whitespace-normal',
        cellClassName: 'px-4 py-3 whitespace-normal',
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
        headerClassName: 'px-4 py-3 font-medium whitespace-normal',
        cellClassName: 'px-4 py-3 whitespace-normal',
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
        headerClassName: 'px-4 py-3 font-medium whitespace-normal',
        cellClassName: 'px-4 py-3 whitespace-normal',
        toggleLabel: 'Omlægningsplan',
      },
    },
    {
      accessorKey: 'retention',
      header: ({ column }) => (
        <SortableColumnHeaderContent label="Retention" column={column} />
      ),
      cell: ({ row }) =>
        row.original.retention === null
          ? 'Ukendt'
          : formatNumber(row.original.retention),
      meta: {
        headerClassName: 'px-4 py-3 font-medium whitespace-normal',
        cellClassName: 'px-4 py-3 whitespace-normal',
        toggleLabel: 'Retention',
      },
    },
    {
      accessorKey: 'jbnr',
      header: ({ column }) => (
        <SortableColumnHeaderContent label="JB nr." column={column} />
      ),
      cell: ({ row }) =>
        row.original.jbnr === null ? 'Ukendt' : row.original.jbnr,
      meta: {
        headerClassName: 'px-4 py-3 font-medium whitespace-normal',
        cellClassName: 'px-4 py-3 whitespace-normal',
        toggleLabel: 'JB nr.',
      },
    },
  )

  list.push(rowAffordanceColumn)

  return list
}
