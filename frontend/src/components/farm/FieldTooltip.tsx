import { Fragment, type ReactNode } from 'react'

import type { FieldRecord } from '@/api/types'
import {
  formatCompactKr,
  formatNumber,
  formatQuotaAmount,
  formatWholeNumber,
  getFieldQuotaStatus,
  QUOTA_STATUS_STYLES,
  type QuotaStatusLevel,
} from '@/lib/field-domain'
import {
  COLOR_SPECS,
  describeSpecValue,
  jbSoilLabel,
  registryPropertyFor,
  specColorFor,
  toFiniteNumber,
  yearQuotaStatusLabel,
  type ColorAttribute,
  type ColorSpec,
} from '@/lib/map-coloring'
import { cn } from '@/lib/utils'

export type HoveredField = {
  longitude: number
  latitude: number
  primary: string
  fieldId: string | null
  properties: Record<string, unknown>
  registry: boolean
  hasRotation: boolean
  yearCrop: string | null
  yearNLoadKgHa: number | null
  yearQuotaStatus: number | null
}

type TooltipRow = {
  key: ColorAttribute
  label: string
  value: ReactNode
  level?: QuotaStatusLevel
}

const describeYearQuotaStatus = (status: number | null): string => {
  const label = yearQuotaStatusLabel(status)
  if (label === null) return ''
  return ` - ${label.charAt(0).toLowerCase()}${label.slice(1)}`
}

const tooltipSpecFor = (attribute: ColorAttribute): ColorSpec | null =>
  attribute === 'none' ||
  attribute === 'vandopland' ||
  attribute === 'yearCrop' ||
  attribute === 'yearNLoad'
    ? null
    : COLOR_SPECS[attribute]

const rawSpecValue = (spec: ColorSpec, hovered: HoveredField): unknown => {
  const property = hovered.registry ? registryPropertyFor(spec) : spec.property
  return property ? hovered.properties[property] : undefined
}

const buildRows = (
  hovered: HoveredField,
  field: FieldRecord | null,
  colorBy: ColorAttribute,
  isSimulationView: boolean,
): TooltipRow[] => {
  const rows: TooltipRow[] = []
  if (field) {
    const status = getFieldQuotaStatus(field, isSimulationView)
    const calculated = status.level !== 'uncalculated'
    const perHaNote = (key: 'nLoad' | 'db2') => {
      const description =
        colorBy === key
          ? describeSpecValue(
              COLOR_SPECS[key],
              rawSpecValue(COLOR_SPECS[key], hovered),
            )
          : null
      return description ? (
        <span className="font-normal text-muted-foreground"> {description}</span>
      ) : null
    }
    rows.push({
      key: 'nLoad',
      label: 'Udledning',
      level: status.level,
      value: calculated ? (
        <>
          {formatQuotaAmount(status.nLoad, status.quotaKgn)}
          {perHaNote('nLoad')}
        </>
      ) : (
        'ikke beregnet'
      ),
    })
    rows.push({
      key: 'db2',
      label: 'DB2',
      value: calculated ? (
        <>
          {formatCompactKr(field.db2)}
          {perHaNote('db2')}
        </>
      ) : (
        '-'
      ),
    })
  } else {
    const limit = toFiniteNumber(hovered.properties.udledningsgraense_kgn_ha)
    rows.push({
      key: 'udledningsgraenseKgnHa',
      label: 'Udledningsgrænse',
      value: limit === null ? 'ukendt' : `${formatNumber(limit)} kg N/ha`,
    })
  }
  const retention = field
    ? field.retention
    : toFiniteNumber(hovered.properties.retention)
  rows.push({
    key: 'retention',
    label: 'Retention',
    value: retention === null ? 'ukendt' : `${formatWholeNumber(retention)} %`,
  })
  const jbnr = field ? field.jbnr : toFiniteNumber(hovered.properties.jbnr)
  const soil = jbnr === null ? null : jbSoilLabel(jbnr)
  rows.push({
    key: 'jbnr',
    label: 'JB nr.',
    value:
      jbnr === null ? (
        'ukendt'
      ) : (
        <>
          JB {jbnr}
          {soil ? (
            <span className="font-normal text-muted-foreground"> {soil}</span>
          ) : null}
        </>
      ),
  })
  const extraSpec = tooltipSpecFor(colorBy)
  if (extraSpec && !rows.some((row) => row.key === colorBy)) {
    rows.push({
      key: colorBy,
      label: extraSpec.label,
      value:
        describeSpecValue(extraSpec, rawSpecValue(extraSpec, hovered)) ??
        'ingen værdi',
    })
  }
  return rows
}

type FieldTooltipProps = {
  hovered: HoveredField
  field: FieldRecord | null
  rotationName: string | null
  catchmentLabel: (kystvandId: number | null) => string
  colorBy: ColorAttribute
  isSimulationView: boolean
  selectedCalendarYear: number | null
  yearValuesLoading: boolean
}

export const FieldTooltip = ({
  hovered,
  field,
  rotationName,
  catchmentLabel,
  colorBy,
  isSimulationView,
  selectedCalendarYear,
  yearValuesLoading,
}: FieldTooltipProps) => {
  const areaHa = field
    ? field.areaHa
    : toFiniteNumber(hovered.properties.area_ha)
  const kystvandId = field
    ? field.kystvandId
    : toFiniteNumber(hovered.properties.kystvand_id)
  const rows = buildRows(hovered, field, colorBy, isSimulationView)

  return (
    <div className="min-w-60 text-xs whitespace-nowrap">
      <div className="px-3 pt-2.5 pb-2">
        <div className="flex items-baseline justify-between gap-3">
          <span className="truncate text-sm font-semibold">
            {hovered.primary}
          </span>
          {areaHa !== null ? (
            <span className="shrink-0 text-muted-foreground tabular-nums">
              {formatNumber(areaHa)} ha
            </span>
          ) : null}
        </div>
        <div className="truncate text-muted-foreground">
          {catchmentLabel(kystvandId)}
        </div>
        {rotationName ? (
          <div className="truncate text-muted-foreground">
            Sædskifte: {rotationName}
          </div>
        ) : null}
      </div>
      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 border-t px-3 py-2">
        {rows.map((row) => {
          const highlighted = row.key === colorBy
          const spec = highlighted ? tooltipSpecFor(row.key) : null
          const swatch = spec
            ? specColorFor(spec, rawSpecValue(spec, hovered))
            : null
          return (
            <Fragment key={row.key}>
              <dt
                className={cn(
                  'text-muted-foreground',
                  highlighted && 'font-semibold text-primary',
                )}
              >
                {row.label}
              </dt>
              <dd
                className={cn(
                  'flex items-center justify-end gap-1.5 text-right font-medium tabular-nums',
                  row.level && QUOTA_STATUS_STYLES[row.level].text,
                )}
              >
                {swatch ? (
                  <span
                    aria-hidden="true"
                    className="size-2 shrink-0 rounded-sm"
                    style={{ backgroundColor: swatch }}
                  />
                ) : null}
                {row.level ? (
                  <span
                    aria-hidden="true"
                    className={cn(
                      'size-1.5 shrink-0 rounded-full',
                      QUOTA_STATUS_STYLES[row.level].dot,
                    )}
                  />
                ) : null}
                <span>{row.value}</span>
              </dd>
            </Fragment>
          )
        })}
      </dl>
      {selectedCalendarYear !== null ? (
        <div className="border-t px-3 py-2">
          <div className="font-medium">
            {selectedCalendarYear}:{' '}
            {hovered.yearCrop ?? 'ingen afgrøde for året'}
          </div>
          <div className="text-muted-foreground">
            {hovered.yearNLoadKgHa !== null
              ? `Udledning ${formatNumber(hovered.yearNLoadKgHa)} kg N/ha${describeYearQuotaStatus(hovered.yearQuotaStatus)}`
              : yearValuesLoading
                ? 'Henter udledning for året...'
                : hovered.hasRotation
                  ? 'Uden for markens rotationscyklus'
                  : 'Ingen udledning beregnet for året'}
          </div>
        </div>
      ) : null}
    </div>
  )
}
