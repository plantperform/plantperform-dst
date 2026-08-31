import {
  flexRender,
  getCoreRowModel,
  useReactTable,
  type Column,
  type ColumnDef,
  type OnChangeFn,
  type RowData,
  type SortingState,
  type VisibilityState,
} from '@tanstack/react-table'
import {
  ChevronDown,
  ChevronRight,
  Columns3,
  Lock,
  LockOpen,
  Trash2,
} from 'lucide-react'
import {
  Fragment,
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import { mutate } from 'swr'

import { farmFieldsKey, simulationFieldsKey, useFarmFields } from '@/api/hooks'
import { detachField, updateSimulationField } from '@/api/mutations'
import type { FieldRecord, Simulation } from '@/api/types'
import type {
  FieldsSortDirection,
  FieldsSortKey,
  FieldsSortState,
} from '@/components/farm/field-list-state'
import { ManualRotationEditor } from '@/components/farm/ManualRotationEditor'
import { RotationDetailPanel } from '@/components/farm/RotationDetailPanel'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
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
  aggregateQuotaStatusLevel,
  buildCropColorMap,
  changedFieldIds,
  CROP_YEAR_COVER_CROP_BORDER,
  getFieldQuotaStatus,
  isFieldCalculated,
  ROTATION_START_CALENDAR_YEAR,
  type QuotaStatus,
  type QuotaStatusLevel,
} from '@/lib/field-domain'

// Ekstra klassenavne pr. kolonne, så headeren, cellerne og footer-cellen
// kan dele samme layout uden at hver renderfunktion skal gentage dem.
declare module '@tanstack/react-table' {
  // Generiske parametre er påkrævet af TanStack's egen interface-signatur
  // for at kunne udvide den korrekt, selvom de ikke bruges her.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  interface ColumnMeta<TData extends RowData, TValue> {
    headerClassName?: string
    cellClassName?: string
    // Vises som tekst for kolonnens checkboks i "Kolonner"-vælgeren. Kun
    // sat på de kolonner der reelt er valgfrie (alt undtagen Mark, Areal og
    // Handlinger).
    toggleLabel?: string
  }
}

const formatNumber = (value: number) =>
  new Intl.NumberFormat('da-DK', { maximumFractionDigits: 1 }).format(value)

// Sædskiftecellens korte tekst ved siden af årstjernene: første ord af
// hvert unikt afgrødenavn i rotationen, højst to, med "m.fl." hvis marken
// har flere end to forskellige afgrøder. Fuldt navn pr. år findes stadig i
// title-tooltippen på det enkelte årsfirkant.
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

// Statuskolonnens visuelle byggesten pr. niveau. Farverne matcher den
// godkendte mockup (prikker og badge) og deles ikke med field-domain, da de
// er ren visning og ikke forretningslogik.
const QUOTA_STATUS_DOT_COLOR: Record<QuotaStatusLevel, string> = {
  ok: '#16a34a',
  near: '#d97706',
  over: '#c62020',
  uncalculated: '#9ca3af',
  noData: '#9ca3af',
  partial: '#9ca3af',
}

const QUOTA_STATUS_BADGE: Partial<
  Record<QuotaStatusLevel, { label: string; bg: string; border: string; color: string }>
> = {
  near: { label: 'tæt på', bg: '#fffbeb', border: '#fde68a', color: '#92400e' },
  over: { label: 'over', bg: '#fef2f2', border: '#fecaca', color: '#991b1b' },
}

const QuotaStatusIndicator = ({
  level,
  children,
  bold = false,
}: {
  level: QuotaStatusLevel
  children: ReactNode
  bold?: boolean
}) => {
  const badge = QUOTA_STATUS_BADGE[level]
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span
        className="h-[9px] w-[9px] shrink-0 rounded-full"
        style={{ backgroundColor: QUOTA_STATUS_DOT_COLOR[level] }}
        aria-hidden="true"
      />
      <span className={bold ? 'font-semibold' : undefined}>{children}</span>
      {badge ? (
        <span
          className="rounded-full border px-2 py-0.5 text-xs"
          style={{
            backgroundColor: badge.bg,
            borderColor: badge.border,
            color: badge.color,
          }}
        >
          {badge.label}
        </span>
      ) : null}
    </div>
  )
}

const renderQuotaStatus = (
  status: QuotaStatus,
  options: { bold?: boolean; uncalculatedCount?: number } = {},
) => {
  const { bold = false, uncalculatedCount = 0 } = options

  if (status.level === 'uncalculated') {
    return (
      <QuotaStatusIndicator level={status.level} bold={bold}>
        <span className="text-muted-foreground">Ikke beregnet</span>
      </QuotaStatusIndicator>
    )
  }
  if (status.level === 'noData') {
    return (
      <QuotaStatusIndicator level={status.level} bold={bold}>
        <span className="text-muted-foreground">Ingen data</span>
      </QuotaStatusIndicator>
    )
  }

  // "Over" er en gyldig konklusion selv på et delvist grundlag (en delsum
  // kan kun vokse), så den får samme "(N ikke beregnet)"-note som den
  // neutrale 'partial'-tilstand - præcis som EmissionStatusBar i
  // FarmInspector.tsx. For et fuldt beregnet grundlag er
  // uncalculatedCount 0, og noten forsvinder derfor af sig selv.
  const partialNote =
    (status.level === 'over' || status.level === 'partial') &&
    uncalculatedCount > 0
      ? ` (${uncalculatedCount} ikke beregnet)`
      : ''
  const amountText = `${formatNumber(status.nLoad)} af ${formatNumber(status.quotaKgn)} kg N${partialNote}`

  if (status.level === 'partial') {
    // Delsummen ligger under kvoten, men grundlaget er ikke fuldt endnu -
    // en grøn/gul konklusion ville ikke have dækning, så vi viser en
    // neutral, grå tekst i stedet (uden badge).
    return (
      <QuotaStatusIndicator level={status.level} bold={bold}>
        <span className="text-muted-foreground">{amountText}</span>
      </QuotaStatusIndicator>
    )
  }

  return (
    <QuotaStatusIndicator level={status.level} bold={bold}>
      {amountText}
    </QuotaStatusIndicator>
  )
}

// Kolonner der kan slås til/fra i "Kolonner"-vælgeren - alt undtagen Mark,
// Areal og Handlinger. Rækkefølgen her styrer også rækkefølgen i dropdownen.
const OPTIONAL_COLUMN_IDS = [
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

// Standardsynlighed pr. visning. Simulering fremhæver DB2 og udledning mod
// kvote; Aktuel (hvor intet er beregnet endnu) viser i stedet markens kvote
// og jordbund. Alt andet er skjult indtil brugeren selv slår det til.
const SIMULATION_DEFAULT_VISIBLE_COLUMNS = new Set([
  'cropRotation',
  'db2',
  'quotaStatus',
])
const CURRENT_DEFAULT_VISIBLE_COLUMNS = new Set([
  'cropRotation',
  'udledningskvoteMarkKgn',
  'soilSummary',
])

const buildDefaultColumnVisibility = (isSimulationView: boolean): VisibilityState => {
  const visible = isSimulationView
    ? SIMULATION_DEFAULT_VISIBLE_COLUMNS
    : CURRENT_DEFAULT_VISIBLE_COLUMNS
  return Object.fromEntries(
    OPTIONAL_COLUMN_IDS.map((id) => [id, visible.has(id)]),
  )
}

// Marknavne som "10-0" skal komme efter "9-0", ikke før "6-0" - deraf numeric.
const nameCollator = new Intl.Collator('da-DK', {
  numeric: true,
  sensitivity: 'base',
})
const idCollator = new Intl.Collator('da-DK', { sensitivity: 'base' })

const compareNullableNumber = (
  left: number | null,
  right: number | null,
  direction: FieldsSortDirection,
) => {
  if (left === null && right === null) return 0
  if (left === null) return 1
  if (right === null) return -1
  return direction === 'asc' ? left - right : right - left
}

const compareNumber = (
  left: number,
  right: number,
  direction: FieldsSortDirection,
) => (direction === 'asc' ? left - right : right - left)

const compareName = (
  left: string,
  right: string,
  direction: FieldsSortDirection,
) => {
  const result = nameCollator.compare(left, right)
  return direction === 'asc' ? result : -result
}

const comparePrimary = (
  left: FieldRecord,
  right: FieldRecord,
  sort: FieldsSortState,
) => {
  switch (sort.key) {
    case 'name':
      return compareName(left.name, right.name, sort.direction)
    case 'areaHa':
      return compareNumber(left.areaHa, right.areaHa, sort.direction)
    case 'db2':
      return compareNumber(left.db2, right.db2, sort.direction)
    case 'nLoad':
      return compareNumber(left.nLoad, right.nLoad, sort.direction)
    case 'leaching':
      return compareNumber(left.leaching, right.leaching, sort.direction)
    case 'fen':
      return compareNumber(left.fen, right.fen, sort.direction)
    case 'udledningskvoteMarkKgn':
      return compareNullableNumber(
        left.udledningskvoteMarkKgn,
        right.udledningskvoteMarkKgn,
        sort.direction,
      )
    case 'inTakeoutPlan':
      return compareNumber(
        Number(left.inTakeoutPlan),
        Number(right.inTakeoutPlan),
        sort.direction,
      )
    case 'retention':
      return compareNullableNumber(
        left.retention,
        right.retention,
        sort.direction,
      )
    case 'jbnr':
      return compareNullableNumber(left.jbnr, right.jbnr, sort.direction)
  }
}

const compareFields = (
  left: FieldRecord,
  right: FieldRecord,
  sort: FieldsSortState,
) => {
  const primary = comparePrimary(left, right, sort)
  if (primary !== 0) return primary
  const imkTie = compareNullableNumber(left.imkId, right.imkId, 'asc')
  if (imkTie !== 0) return imkTie
  return idCollator.compare(left.id, right.id)
}

// Header-indhold for en sorterbar kolonne. Sorteringstilstanden læses fra
// TanStack's kolonne-API (afledt af sort-proppen), men selve klik-toggeringen
// styres eksplicit her, så den matcher den hidtidige to-trins asc/desc-adfærd
// (ingen "usorteret" mellemtrin), uanset TanStack's egne type-heuristikker.
const SortableColumnHeaderContent = ({
  label,
  column,
}: {
  label: string
  column: Column<FieldRecord, unknown>
}) => {
  const sorted = column.getIsSorted()
  const glyph = sorted === 'asc' ? '▲' : sorted === 'desc' ? '▼' : ''
  const handleClick = () => {
    column.toggleSorting(sorted === 'asc')
  }

  return (
    <button
      type="button"
      onClick={handleClick}
      className="-mx-1 flex w-full items-center gap-1 rounded px-1 py-0.5 text-left hover:bg-muted/70"
    >
      <span>{label}</span>
      {glyph ? (
        <span aria-hidden="true" className="text-xs text-muted-foreground">
          {glyph}
        </span>
      ) : null}
    </button>
  )
}

type FarmFieldsListProps = {
  farmId: string
  fields: FieldRecord[]
  isSimulationView?: boolean
  simulationId?: string
  simulation?: Simulation
  sort: FieldsSortState
  onSortChange: (sort: FieldsSortState) => void
  onSwitchToMap: () => void
  onError: (message: string | null) => void
}

const NOT_YET_AVAILABLE_TITLE =
  "Ikke tilgængelig i det nye optimeringsflow — sædskiftet genereres nu som scenarie-kandidater ved 'Opret scenarie', og Optimér vælger automatisk den bedste blandt dem."

export const FarmFieldsList = ({
  farmId,
  fields,
  isSimulationView = false,
  simulationId,
  simulation,
  sort,
  onSortChange,
  onSwitchToMap,
  onError,
}: FarmFieldsListProps) => {
  const [detachingFieldId, setDetachingFieldId] = useState<string | null>(null)
  const [lockingFieldId, setLockingFieldId] = useState<string | null>(null)
  const [editingFieldId, setEditingFieldId] = useState<string | null>(null)
  const [expandedFieldId, setExpandedFieldId] = useState<string | null>(null)
  const [manualEditFieldId, setManualEditFieldId] = useState<string | null>(
    null,
  )
  const [confirmDetachField, setConfirmDetachField] =
    useState<FieldRecord | null>(null)

  const sortedFields = useMemo(
    () => [...fields].sort((left, right) => compareFields(left, right, sort)),
    [fields, sort],
  )

  // Bruges både til "Sædskifte"-kolonnens årsspænd i headeren og til at
  // afgøre om det er meningsfuldt at vise et interval frem for et enkelt år.
  const maxYears = Math.max(
    0,
    ...fields.map((field) => field.cropRotation.length),
  )

  const { data: liveFields = [] } = useFarmFields(farmId)
  const changedFields = useMemo(
    () => changedFieldIds(fields, liveFields),
    [fields, liveFields],
  )

  // DB2, udledning, udvaskning og foderenheder summeres kun over marker der
  // rent faktisk er beregnet - ellers ville et par u-beregnede marker med
  // stiltiende 0-værdier trække totalen ned uden at brugeren kan se det.
  // Er ingen marker beregnet (calculatedCount === 0), er summen 0 kr/0 kg N
  // uden at betyde noget, og footerne for de fire kolonner viser derfor
  // samme ærlige "ikke beregnet"-markering som cellerne i stedet for et
  // falsk nul. Areal og markkvoter findes uafhængigt af beregning og
  // tælles derfor altid med, jf. delleverance C.
  const totals = useMemo(() => {
    const calculatedFields = fields.filter((field) =>
      isFieldCalculated(field, isSimulationView),
    )
    return {
      areaHa: fields.reduce((sum, field) => sum + field.areaHa, 0),
      db2: calculatedFields.reduce((sum, field) => sum + field.db2, 0),
      nLoad: calculatedFields.reduce((sum, field) => sum + field.nLoad, 0),
      leaching: calculatedFields.reduce(
        (sum, field) => sum + field.leaching,
        0,
      ),
      fen: calculatedFields.reduce((sum, field) => sum + field.fen, 0),
      udledningskvoteMarkKgn: fields.reduce(
        (sum, field) => sum + field.udledningskvoteMarkKgn,
        0,
      ),
      calculatedCount: calculatedFields.length,
      uncalculatedCount: fields.length - calculatedFields.length,
    }
  }, [fields, isSimulationView])

  // Farvepaletten til sædskiftets årstern er indekseret pr. unik afgrødekode
  // i hele bedriften (ikke pr. mark), så samme afgrøde altid får samme
  // farve i tabellen.
  const cropColorMap = useMemo(() => buildCropColorMap(fields), [fields])

  // Kolonnevisning er ren lokal React-state (nulstilles ved reload, jf.
  // opgavebeskrivelsen). Simulering og Aktuel har hver deres standardsæt,
  // så et skift af visning nulstiller til den nye visnings standard i
  // stedet for at beholde et valg der ikke giver mening i den nye kontekst.
  const [columnVisibility, setColumnVisibility] = useState<VisibilityState>(
    () => buildDefaultColumnVisibility(isSimulationView),
  )
  useEffect(() => {
    setColumnVisibility(buildDefaultColumnVisibility(isSimulationView))
  }, [isSimulationView])

  const detachFarmField = useCallback(
    async (fieldId: string) => {
      setDetachingFieldId(fieldId)
      try {
        await detachField(farmId, fieldId)
        await mutate(farmFieldsKey(farmId))
        onError(null)
      } catch {
        onError('Kunne ikke fjerne marken fra bedriften.')
      } finally {
        setDetachingFieldId(null)
      }
    },
    [farmId, onError],
  )

  // Ingen eksterne afhængigheder ud over den mark der undersøges, så
  // funktionsreferencen kan holdes helt stabil.
  const isFieldLocked = useCallback(
    (field: FieldRecord) =>
      field.allowedRotationIds.length === 1 &&
      field.rotationId !== null &&
      field.allowedRotationIds[0] === field.rotationId,
    [],
  )

  const toggleFieldLock = useCallback(
    async (field: FieldRecord) => {
      if (!simulationId || field.rotationId === null) return

      const locked = isFieldLocked(field)
      const target = locked ? [] : [field.rotationId]

      setLockingFieldId(field.id)
      try {
        const updatedField = await updateSimulationField(
          farmId,
          simulationId,
          field.id,
          { allowedRotationIds: target },
        )
        await mutate(
          simulationFieldsKey(farmId, simulationId),
          (current: FieldRecord[] = []) =>
            current.map((currentField) =>
              currentField.id === updatedField.id ? updatedField : currentField,
            ),
          { revalidate: false },
        )
        onError(null)
      } catch {
        onError('Kunne ikke ændre låsningen af marken.')
      } finally {
        setLockingFieldId(null)
      }
    },
    [farmId, simulationId, isFieldLocked, onError],
  )

  // Kolonnedefinitionerne genopbygges kun når noget de faktisk bruger
  // ændrer sig (isSimulationView, simulationId, årskolonnernes antal,
  // totalrækkens summer og den lokale UI-tilstand cellerne læser).
  // Handlerne ovenfor er stabiliseret med useCallback, så de kan indgå i
  // afhængighedslisten uden at tvinge en genopbygning hver render.
  const columns = useMemo<ColumnDef<FieldRecord, unknown>[]>(() => {
    const list: ColumnDef<FieldRecord, unknown>[] = []

    if (isSimulationView) {
      list.push({
        id: 'expand',
        header: () => <span className="sr-only">Beregningsdetaljer</span>,
        cell: ({ row }) => {
          const field = row.original
          const canShowDetail = isSimulationView && field.rotationId !== null
          if (!canShowDetail) return null
          const isExpanded = expandedFieldId === field.id
          return (
            <Button
              size="sm"
              variant="ghost"
              className="h-7 w-7 p-0"
              onClick={() => setExpandedFieldId(isExpanded ? null : field.id)}
              aria-label={
                isExpanded
                  ? 'Skjul beregningsdetaljer'
                  : 'Vis beregningsdetaljer'
              }
              title="Vis beregningsgennemgang for udvaskning og dækningsbidrag pr. år"
            >
              {isExpanded ? (
                <ChevronDown className="h-4 w-4" aria-hidden="true" />
              ) : (
                <ChevronRight className="h-4 w-4" aria-hidden="true" />
              )}
            </Button>
          )
        },
        enableSorting: false,
        meta: { headerClassName: 'w-8 px-2 py-3', cellClassName: 'px-2 py-3' },
      })
    }

    list.push(
      {
        accessorKey: 'name',
        header: ({ column }) => (
          <SortableColumnHeaderContent label="Mark" column={column} />
        ),
        cell: ({ row }) => row.original.name,
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
                  cropColorMap.get(year.afgrodeKode) ?? '#a7c69b'
                return (
                  <span
                    key={index}
                    title={title}
                    className="box-border h-[14px] w-[10px] shrink-0 rounded-[3px]"
                    style={{
                      backgroundColor: color,
                      borderBottom: hasUdlaeg
                        ? `3px solid ${CROP_YEAR_COVER_CROP_BORDER}`
                        : undefined,
                    }}
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
      {
        accessorKey: 'db2',
        header: ({ column }) => (
          <SortableColumnHeaderContent label="DB2 (kr)" column={column} />
        ),
        cell: ({ row }) => {
          const field = row.original
          if (!isFieldCalculated(field, isSimulationView)) {
            return (
              <Badge
                variant="outline"
                className="font-normal text-muted-foreground"
              >
                Ikke beregnet
              </Badge>
            )
          }
          return (
            <>
              <div>{formatNumber(field.db2)} kr</div>
              {field.areaHa > 0 ? (
                <div className="text-xs text-muted-foreground/80">
                  {formatNumber(field.db2 / field.areaHa)} kr/ha
                </div>
              ) : null}
            </>
          )
        },
        footer: () =>
          totals.calculatedCount === 0 ? (
            <span className="font-normal text-muted-foreground">
              Ikke beregnet
            </span>
          ) : (
            <div>{formatNumber(totals.db2)} kr</div>
          ),
        meta: {
          headerClassName: 'px-4 py-3 font-medium whitespace-normal',
          cellClassName: 'px-4 py-3 whitespace-normal',
          toggleLabel: 'DB2 (kr)',
        },
      },
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
                totals.udledningskvoteMarkKgn,
                totals.calculatedCount,
                fields.length,
              ),
              nLoad: totals.nLoad,
              quotaKgn: totals.udledningskvoteMarkKgn,
            },
            { bold: true, uncalculatedCount: totals.uncalculatedCount },
          ),
        enableSorting: false,
        meta: {
          headerClassName: 'px-4 py-3 font-medium whitespace-normal',
          cellClassName: 'px-4 py-3 whitespace-normal',
          toggleLabel: 'Udledning mod kvote',
        },
      },
      {
        accessorKey: 'nLoad',
        header: ({ column }) => (
          <SortableColumnHeaderContent
            label="Kvælstofudledning (kg N)"
            column={column}
          />
        ),
        cell: ({ row }) => {
          const field = row.original
          if (!isFieldCalculated(field, isSimulationView)) {
            return <span className="text-muted-foreground">-</span>
          }
          return (
            <>
              <div>{formatNumber(field.nLoad)} kg N</div>
              {field.areaHa > 0 ? (
                <div className="text-xs text-muted-foreground/80">
                  {formatNumber(field.nLoad / field.areaHa)} kg N/ha
                </div>
              ) : null}
            </>
          )
        },
        footer: () =>
          totals.calculatedCount === 0 ? (
            <span className="text-muted-foreground">-</span>
          ) : (
            <div>{formatNumber(totals.nLoad)} kg N</div>
          ),
        meta: {
          headerClassName: 'px-4 py-3 font-medium whitespace-normal',
          cellClassName: 'px-4 py-3 whitespace-normal',
          toggleLabel: 'Kvælstofudledning (kg N)',
        },
      },
      {
        accessorKey: 'leaching',
        header: ({ column }) => (
          <SortableColumnHeaderContent
            label="Udvaskning (kg N)"
            column={column}
          />
        ),
        cell: ({ row }) => {
          const field = row.original
          if (!isFieldCalculated(field, isSimulationView)) {
            return <span className="text-muted-foreground">-</span>
          }
          return (
            <>
              <div>{formatNumber(field.leaching)} kg N</div>
              {field.areaHa > 0 ? (
                <div className="text-xs text-muted-foreground/80">
                  {formatNumber(field.leaching / field.areaHa)} kg N/ha
                </div>
              ) : null}
            </>
          )
        },
        footer: () =>
          totals.calculatedCount === 0 ? (
            <span className="text-muted-foreground">-</span>
          ) : (
            <div>{formatNumber(totals.leaching)} kg N</div>
          ),
        meta: {
          headerClassName: 'px-4 py-3 font-medium whitespace-normal',
          cellClassName: 'px-4 py-3 whitespace-normal',
          toggleLabel: 'Udvaskning (kg N)',
        },
      },
      {
        accessorKey: 'fen',
        header: ({ column }) => (
          <SortableColumnHeaderContent
            label="Foderenheder (FE)"
            column={column}
          />
        ),
        cell: ({ row }) => {
          const field = row.original
          if (!isFieldCalculated(field, isSimulationView)) {
            return <span className="text-muted-foreground">-</span>
          }
          return (
            <>
              <div>{formatNumber(field.fen)} FE</div>
              {field.areaHa > 0 ? (
                <div className="text-xs text-muted-foreground/80">
                  {formatNumber(field.fen / field.areaHa)} FE/ha
                </div>
              ) : null}
            </>
          )
        },
        footer: () =>
          totals.calculatedCount === 0 ? (
            <span className="text-muted-foreground">-</span>
          ) : (
            <div>{formatNumber(totals.fen)} FE</div>
          ),
        meta: {
          headerClassName: 'px-4 py-3 font-medium whitespace-normal',
          cellClassName: 'px-4 py-3 whitespace-normal',
          toggleLabel: 'Foderenheder (FE)',
        },
      },
      {
        accessorKey: 'udledningskvoteMarkKgn',
        header: ({ column }) => (
          <SortableColumnHeaderContent label="Kvote (kg N)" column={column} />
        ),
        cell: ({ row }) => {
          const field = row.original
          // 0 er backend-defaulten for registermarker uden en sat
          // udledningsgrænse - ikke et reelt "0 kg N i kvote". Vis det
          // derfor som manglende data, uden den vildledende kg N/ha-linje.
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
      {
        id: 'actions',
        header: () => 'Handlinger',
        cell: ({ row }) => {
          const field = row.original
          const isEditing = editingFieldId === field.id
          const canEdit = isSimulationView && Boolean(simulationId)
          return (
            <div className="flex flex-nowrap justify-end gap-2">
              <Button
                size="sm"
                variant={isEditing ? 'default' : 'outline'}
                onClick={() => setEditingFieldId(isEditing ? null : field.id)}
                disabled={!canEdit && !isEditing}
                title={
                  canEdit
                    ? undefined
                    : 'Opret en simulering for at redigere sædskifter.'
                }
              >
                {isEditing ? 'Færdig' : 'Rediger'}
              </Button>
              {isEditing && canEdit ? (
                <>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={field.rotationId === null}
                    onClick={() => setManualEditFieldId(field.id)}
                    title={
                      field.rotationId === null
                        ? 'Kør Optimér for denne mark, før du kan redigere manuelt.'
                        : undefined
                    }
                  >
                    Rediger manuelt
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled
                    title={NOT_YET_AVAILABLE_TITLE}
                  >
                    Tilladte sædskifter
                  </Button>
                </>
              ) : null}
              {canEdit ? (
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => void toggleFieldLock(field)}
                  disabled={
                    field.rotationId === null || lockingFieldId === field.id
                  }
                  aria-label={isFieldLocked(field) ? 'Lås op' : 'Lås'}
                  className={
                    isFieldLocked(field)
                      ? 'h-8 w-8 p-0 bg-amber-100 text-amber-700'
                      : 'h-8 w-8 p-0 text-muted-foreground'
                  }
                  title={
                    isFieldLocked(field)
                      ? 'Marken er låst til det valgte sædskifte — Optimér ændrer den ikke. Klik for at låse op.'
                      : 'Marken er ikke låst — Optimér kan frit ændre den. Klik for at låse.'
                  }
                >
                  {isFieldLocked(field) ? (
                    <Lock className="h-4 w-4" aria-hidden="true" />
                  ) : (
                    <LockOpen className="h-4 w-4" aria-hidden="true" />
                  )}
                </Button>
              ) : null}
              {!isSimulationView ? (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setConfirmDetachField(field)}
                  disabled={detachingFieldId === field.id}
                  aria-label="Fjern"
                  className="h-8 w-8 p-0 text-muted-foreground hover:bg-red-50 hover:text-red-700"
                  title={
                    detachingFieldId === field.id
                      ? 'Fjerner...'
                      : 'Fjern marken fra bedriften.'
                  }
                >
                  <Trash2 className="h-4 w-4" aria-hidden="true" />
                </Button>
              ) : null}
            </div>
          )
        },
        enableSorting: false,
        meta: {
          headerClassName: 'px-4 py-3 text-right font-medium whitespace-normal',
          cellClassName: 'whitespace-nowrap px-4 py-3 text-right',
        },
      },
    )

    return list
  }, [
    isSimulationView,
    simulationId,
    maxYears,
    fields,
    cropColorMap,
    totals,
    expandedFieldId,
    editingFieldId,
    lockingFieldId,
    detachingFieldId,
    toggleFieldLock,
    isFieldLocked,
  ])

  // Sorteringen er styret fra parent (sort/onSortChange). TanStack's eget
  // sorteringsstate afledes af prop'en her og mappes tilbage til det samme
  // prop-format i onSortingChange, så FarmInspector ikke skal ændres.
  // Selve rækkefølgen beregnes fortsat manuelt via compareFields ovenfor
  // (manualSorting), bl.a. for at bevare den særlige tiebreak-logik.
  const sorting: SortingState = useMemo(
    () => [{ id: sort.key, desc: sort.direction === 'desc' }],
    [sort],
  )

  const handleSortingChange: OnChangeFn<SortingState> = (updater) => {
    const next = typeof updater === 'function' ? updater(sorting) : updater
    const nextSort = next[0]
    if (!nextSort) return
    onSortChange({
      key: nextSort.id as FieldsSortKey,
      direction: nextSort.desc ? 'desc' : 'asc',
    })
  }

  const table = useReactTable({
    data: sortedFields,
    columns,
    state: { sorting, columnVisibility },
    onSortingChange: handleSortingChange,
    onColumnVisibilityChange: setColumnVisibility,
    manualSorting: true,
    getCoreRowModel: getCoreRowModel(),
  })

  // De valgfrie kolonner i "Kolonner"-dropdownen, i den rækkefølge de er
  // defineret ovenfor - alt undtagen Mark, Areal og Handlinger.
  const optionalColumns = table
    .getAllLeafColumns()
    .filter((column) => OPTIONAL_COLUMN_IDS.includes(column.id))
  const visibleOptionalCount = optionalColumns.filter((column) =>
    column.getIsVisible(),
  ).length

  if (fields.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Tilføj marker fra kortet</CardTitle>
          <CardDescription>
            {isSimulationView
              ? 'Denne simulering blev oprettet, før der var tilknyttet aktuelle marker.'
              : 'Skift til kortvisning og slå Tilføj marker til for at gennemgå registermarker, før du tilføjer dem.'}
          </CardDescription>
        </CardHeader>
        {!isSimulationView ? (
          <CardContent>
            <Button onClick={onSwitchToMap}>Åbn kortvisning</Button>
          </CardContent>
        ) : null}
      </Card>
    )
  }

  return (
    <>
      <Card>
        <CardHeader className="flex-row items-center justify-between gap-4 space-y-0">
          <div>
            <CardTitle>Marker</CardTitle>
            <CardDescription>
              {isSimulationView
                ? 'Marker kopieret ind i denne simulering.'
                : 'Marker, der aktuelt er tilknyttet bedriften.'}
            </CardDescription>
          </div>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm" className="gap-1.5">
                <Columns3 className="h-3.5 w-3.5" aria-hidden="true" />
                Kolonner
                <span className="text-muted-foreground">
                  {visibleOptionalCount} af {optionalColumns.length}
                </span>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {optionalColumns.map((column) => (
                <DropdownMenuCheckboxItem
                  key={column.id}
                  checked={column.getIsVisible()}
                  onSelect={(event) => event.preventDefault()}
                  onCheckedChange={(checked) =>
                    column.toggleVisibility(Boolean(checked))
                  }
                >
                  {column.columnDef.meta?.toggleLabel ?? column.id}
                </DropdownMenuCheckboxItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        </CardHeader>
        <CardContent>
          <div className="overflow-hidden rounded-lg border">
            <Table className="border-collapse text-left">
              <TableHeader className="bg-muted/60">
                {table.getHeaderGroups().map((headerGroup) => (
                  <TableRow key={headerGroup.id}>
                    {headerGroup.headers.map((header) => {
                      const meta = header.column.columnDef.meta
                      const sortable = header.column.getCanSort()
                      const sorted = header.column.getIsSorted()
                      return (
                        <TableHead
                          key={header.id}
                          aria-sort={
                            sortable
                              ? sorted === 'asc'
                                ? 'ascending'
                                : sorted === 'desc'
                                  ? 'descending'
                                  : 'none'
                              : undefined
                          }
                          className={meta?.headerClassName}
                        >
                          {header.isPlaceholder
                            ? null
                            : flexRender(
                                header.column.columnDef.header,
                                header.getContext(),
                              )}
                        </TableHead>
                      )
                    })}
                  </TableRow>
                ))}
              </TableHeader>
              <TableBody>
                {table.getRowModel().rows.map((row) => {
                  const field = row.original
                  const isChanged = changedFields.has(field.id)
                  const isExpanded = expandedFieldId === field.id
                  return (
                    <Fragment key={field.id}>
                      <TableRow
                        className={isChanged ? 'bg-blue-50' : undefined}
                      >
                        {row.getVisibleCells().map((cell) => {
                          const meta = cell.column.columnDef.meta
                          return (
                            <TableCell
                              key={cell.id}
                              className={meta?.cellClassName}
                            >
                              {flexRender(
                                cell.column.columnDef.cell,
                                cell.getContext(),
                              )}
                            </TableCell>
                          )
                        })}
                      </TableRow>
                      {isExpanded && simulationId ? (
                        <TableRow>
                          <TableCell
                            colSpan={table.getVisibleLeafColumns().length}
                            className="p-0"
                          >
                            <RotationDetailPanel
                              farmId={farmId}
                              simulationId={simulationId}
                              fieldId={field.id}
                              rotationId={field.rotationId}
                              areaHa={field.areaHa}
                              retention={field.retention}
                            />
                          </TableCell>
                        </TableRow>
                      ) : null}
                      {simulationId &&
                      simulation &&
                      manualEditFieldId === field.id ? (
                        // Kun den åbne rækkes dialog mountes, i stedet for en
                        // dialog pr. række som før.
                        <ManualRotationEditor
                          farmId={farmId}
                          simulationId={simulationId}
                          simulation={simulation}
                          field={field}
                          open
                          onOpenChange={(nextOpen) =>
                            setManualEditFieldId(nextOpen ? field.id : null)
                          }
                          onError={onError}
                        />
                      ) : null}
                    </Fragment>
                  )
                })}
              </TableBody>
              <TableFooter>
                {table.getFooterGroups().map((footerGroup) => (
                  <TableRow key={footerGroup.id}>
                    {footerGroup.headers.map((footer) => {
                      const meta = footer.column.columnDef.meta
                      return (
                        <TableCell
                          key={footer.id}
                          className={meta?.cellClassName}
                        >
                          {footer.isPlaceholder
                            ? null
                            : flexRender(
                                footer.column.columnDef.footer,
                                footer.getContext(),
                              )}
                        </TableCell>
                      )
                    })}
                  </TableRow>
                ))}
              </TableFooter>
            </Table>
          </div>
        </CardContent>
      </Card>
      <Dialog
        open={confirmDetachField !== null}
        onOpenChange={(open) => {
          if (!open) setConfirmDetachField(null)
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Fjern mark?</DialogTitle>
            <DialogDescription>
              Marken {confirmDetachField?.name} fjernes fra bedriften. Det
              ændrer ikke registret.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setConfirmDetachField(null)}
            >
              Annuller
            </Button>
            <Button
              variant="destructive"
              onClick={() => {
                const fieldToDetach = confirmDetachField
                setConfirmDetachField(null)
                if (fieldToDetach) void detachFarmField(fieldToDetach.id)
              }}
            >
              Fjern
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
