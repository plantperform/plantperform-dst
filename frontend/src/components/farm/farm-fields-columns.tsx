import type { ColumnDef, RowData } from '@tanstack/react-table'
import { ChevronRight, Lock } from 'lucide-react'
import type { ReactNode } from 'react'

import type { FieldRecord } from '@/api/types'
import { CropYearSwatch } from '@/components/farm/CropYearSwatch'
import { QuotaStatusIndicator } from '@/components/farm/QuotaStatusIndicator'
import { SortableColumnHeaderContent } from '@/components/farm/SortableColumnHeaderContent'
import { Badge } from '@/components/ui/badge'
import {
  aggregateQuotaStatusLevel,
  CROP_YEAR_FALLBACK_COLOR,
  formatNumber,
  formatQuotaAmount,
  getFieldQuotaStatus,
  isFieldCalculated,
  QUOTA_WARNING_LEVEL_COLORS,
  ROTATION_START_CALENDAR_YEAR,
  type QuotaStatus,
  type QuotaStatusLevel,
  type ResolvedFarmQuota,
} from '@/lib/field-domain'

declare module '@tanstack/react-table' {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  interface ColumnMeta<TData extends RowData, TValue> {
    headerClassName?: string
    cellClassName?: string
    toggleLabel?: string
  }
}

export type FarmFieldsTotals = {
  areaHa: number
  db2: number
  nLoad: number
  leaching: number
  fen: number
  udledningskvoteMarkKgn: number
  calculatedCount: number
  uncalculatedCount: number
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

const QUOTA_STATUS_BADGE: Partial<
  Record<QuotaStatusLevel, { label: string; bg: string; border: string; color: string }>
> = {
  near: {
    label: 'tæt på',
    bg: QUOTA_WARNING_LEVEL_COLORS.near.bg,
    border: QUOTA_WARNING_LEVEL_COLORS.near.border,
    color: QUOTA_WARNING_LEVEL_COLORS.near.text,
  },
  over: {
    label: 'over',
    bg: QUOTA_WARNING_LEVEL_COLORS.over.bg,
    border: QUOTA_WARNING_LEVEL_COLORS.over.border,
    color: QUOTA_WARNING_LEVEL_COLORS.over.text,
  },
}

const renderQuotaStatus = (
  status: QuotaStatus,
  options: {
    bold?: boolean
    uncalculatedCount?: number
    basisLabel?: string
  } = {},
) => {
  const { bold = false, uncalculatedCount = 0, basisLabel } = options
  const badge = QUOTA_STATUS_BADGE[status.level]

  if (status.level === 'uncalculated') {
    return (
      <QuotaStatusIndicator level={status.level} bold={bold} badge={badge}>
        <span className="text-muted-foreground">Ikke beregnet</span>
      </QuotaStatusIndicator>
    )
  }
  if (status.level === 'noData') {
    return (
      <QuotaStatusIndicator level={status.level} bold={bold} badge={badge}>
        <span className="text-muted-foreground">Ingen data</span>
      </QuotaStatusIndicator>
    )
  }

  const notes: string[] = []
  if (basisLabel) notes.push(basisLabel)
  if (
    (status.level === 'over' || status.level === 'partial') &&
    uncalculatedCount > 0
  ) {
    notes.push(`${uncalculatedCount} ikke beregnet`)
  }
  const noteText = notes.length > 0 ? ` (${notes.join(', ')})` : ''
  const amountText = `${formatQuotaAmount(status)}${noteText}`

  if (status.level === 'partial') {
    return (
      <QuotaStatusIndicator level={status.level} bold={bold} badge={badge}>
        <span className="text-muted-foreground">{amountText}</span>
      </QuotaStatusIndicator>
    )
  }

  return (
    <QuotaStatusIndicator level={status.level} bold={bold} badge={badge}>
      {amountText}
    </QuotaStatusIndicator>
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
  totals: FarmFieldsTotals,
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

export type FarmFieldsColumnsArgs = {
  isSimulationView: boolean
  maxYears: number
  fields: FieldRecord[]
  cropColorMap: Map<number, string>
  totals: FarmFieldsTotals
  resolvedQuota: ResolvedFarmQuota
  isFieldLocked: (field: FieldRecord) => boolean
}

export const buildFarmFieldsColumns = ({
  isSimulationView,
  maxYears,
  fields,
  cropColorMap,
  totals,
  resolvedQuota,
  isFieldLocked,
}: FarmFieldsColumnsArgs): ColumnDef<FieldRecord, unknown>[] => {
  const list: ColumnDef<FieldRecord, unknown>[] = []

  list.push(
    {
      accessorKey: 'name',
      header: ({ column }) => (
        <SortableColumnHeaderContent label="Mark" column={column} />
      ),
      cell: ({ row }) => {
        const rowField = row.original
        const locked = isFieldLocked(rowField)
        return (
          <span className="flex items-center gap-1.5">
            <span>{rowField.name}</span>
            {locked ? (
              <span title="Marken er låst til sit sædskifte - Optimér kan ikke ændre den.">
                <Lock
                  className="h-3.5 w-3.5 shrink-0 text-amber-600"
                  aria-hidden="true"
                />
              </span>
            ) : null}
          </span>
        )
      },
      footer: () =>
        totals.uncalculatedCount > 0
          ? `I alt (${totals.uncalculatedCount} ikke beregnet)`
          : 'I alt',
      meta: {
        headerClassName: 'px-4 py-3 font-medium whitespace-normal',
        cellClassName: 'px-4 py-3 font-medium whitespace-normal',
      },
    },
    {
      accessorKey: 'areaHa',
      header: ({ column }) => (
        <SortableColumnHeaderContent label="Areal" column={column} />
      ),
      cell: ({ row }) => `${formatNumber(row.original.areaHa)} ha`,
      footer: () => `${formatNumber(totals.areaHa)} ha`,
      meta: {
        headerClassName: 'px-4 py-3 font-medium whitespace-normal',
        cellClassName: 'px-4 py-3 whitespace-normal',
      },
    },
  )

  list.push({
    id: 'cropRotation',
    header: () => (
      <div className="flex flex-col">
        <span>Sædskifte</span>
        <span className="block text-xs font-normal text-muted-foreground">
          {maxYears > 1
            ? `${ROTATION_START_CALENDAR_YEAR}-${ROTATION_START_CALENDAR_YEAR + maxYears - 1}`
            : ROTATION_START_CALENDAR_YEAR}
        </span>
      </div>
    ),
    cell: ({ row }) => {
      const rotation = row.original.cropRotation
      if (rotation.length === 0) {
        return (
          <span className="text-muted-foreground">Intet sædskifte endnu</span>
        )
      }
      return (
        <div className="flex items-center gap-2.5">
          <div className="flex shrink-0 gap-[3px]">
            {rotation.map((year, index) => {
              const calendarYear = ROTATION_START_CALENDAR_YEAR + index
              const hasUdlaeg = year.udlaegNavn !== null
              const title = hasUdlaeg
                ? `${calendarYear}: ${year.afgrodeNavn} (udlæg: ${year.udlaegNavn})`
                : `${calendarYear}: ${year.afgrodeNavn}`
              const color =
                cropColorMap.get(year.afgrodeKode) ?? CROP_YEAR_FALLBACK_COLOR
              return (
                <CropYearSwatch
                  key={index}
                  title={title}
                  color={color}
                  hasUdlaeg={hasUdlaeg}
                  size="14x10"
                />
              )
            })}
          </div>
          <span className="text-sm">{uniqueCropNamesLabel(rotation)}</span>
        </div>
      )
    },
    footer: () => {
      if (isSimulationView) return null
      const withoutRotation = fields.filter(
        (field) => field.cropRotation.length === 0,
      ).length
      return withoutRotation > 0 ? (
        <span className="text-muted-foreground">
          {withoutRotation} marker uden sædskifte
        </span>
      ) : null
    },
    enableSorting: false,
    meta: {
      headerClassName: 'px-4 py-3 font-medium whitespace-normal',
      cellClassName: 'px-4 py-3 whitespace-normal',
      toggleLabel: 'Sædskifte',
    },
  })

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
        renderQuotaStatus(
          {
            level: aggregateQuotaStatusLevel(
              totals.nLoad,
              resolvedQuota.quotaKgn,
              totals.calculatedCount,
              fields.length,
            ),
            nLoad: totals.nLoad,
            quotaKgn: resolvedQuota.quotaKgn,
          },
          {
            bold: true,
            uncalculatedCount: totals.uncalculatedCount,
            basisLabel: resolvedQuota.basis,
          },
        ),
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
            <div className="text-xs text-muted-foreground/80">
              {formatNumber(field.udledningsgraenseKgnHa)} kg N/ha
            </div>
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
          label="I omlægningsplan"
          column={column}
        />
      ),
      cell: ({ row }) => (row.original.inTakeoutPlan ? 'Ja' : 'Nej'),
      meta: {
        headerClassName: 'px-4 py-3 font-medium whitespace-normal',
        cellClassName: 'px-4 py-3 whitespace-normal',
        toggleLabel: 'I omlægningsplan',
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

  list.push({
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
  })

  return list
}
