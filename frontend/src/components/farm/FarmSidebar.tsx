import {
  CalendarRange,
  ChevronsUpDown,
  Copy,
  FlaskConical,
  History,
  Loader2,
  MoreHorizontal,
  PanelLeft,
  Play,
  Plus,
  Search,
  SlidersHorizontal,
  Table2,
  Trash2,
  Warehouse,
} from 'lucide-react'
import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from 'react'
import { Link } from 'react-router-dom'
import { mutate } from 'swr'

import {
  simulationFieldsKey,
  simulationsKey,
  useSimulationFields,
} from '@/api/hooks'
import {
  createSimulation,
  deleteSimulation,
  updateSimulationConstraints,
} from '@/api/mutations'
import type {
  CreateSimulationInput,
  Farm,
  FieldRecord,
  Simulation,
} from '@/api/types'
import { useAuth } from '@/auth/context'
import { NewScenarioPanel } from '@/components/farm/NewScenarioPanel'
import { SidebarResizeHandle } from '@/components/farm/SidebarResizeHandle'
import type {
  FarmInspectorMode,
  FarmViewSelection,
} from '@/components/farm/types'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarInput,
  SidebarMenu,
  SidebarMenuAction,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
  useSidebar,
} from '@/components/ui/sidebar'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { UserMenuContent } from '@/components/UserMenu'
import {
  changedFieldIds,
  computeFieldTotals,
  formatCompactKr,
  formatFieldCount,
  formatNumber,
  formatQuotaAmount,
  formatWholeNumber,
  isFieldLocked,
  QUOTA_STATUS_STYLES,
  totalsQuotaStatusLevel,
  type FieldTotals,
  type QuotaStatusLevel,
} from '@/lib/field-domain'
import {
  getStoredRole,
  HOME_OVERVIEW_STATE,
  ROLE_LABELS,
} from '@/lib/onboarding'
import { cn } from '@/lib/utils'

const formatCreatedAt = (value: string) => {
  const createdAt = new Date(value).getTime()
  if (Number.isNaN(createdAt)) return 'Oprettet for nylig'

  const diffMinutes = Math.max(0, Math.round((Date.now() - createdAt) / 60_000))
  if (diffMinutes < 1) return 'Oprettet netop nu'
  if (diffMinutes < 60) return `Oprettet for ${diffMinutes} min. siden`

  const diffHours = Math.round(diffMinutes / 60)
  if (diffHours < 24) return `Oprettet for ${diffHours} t. siden`

  const diffDays = Math.round(diffHours / 24)
  return `Oprettet for ${diffDays} d. siden`
}

const useIsIconRail = () => {
  const { state, isMobile } = useSidebar()
  return !isMobile && state === 'collapsed'
}

type ViewKeyFigures = {
  level: QuotaStatusLevel
  label: string
  title: string
}

const describeKeyFigures = (
  fields: FieldRecord[],
  isSimulationView: boolean,
): ViewKeyFigures => {
  const totals = computeFieldTotals(fields, isSimulationView)
  const level = totalsQuotaStatusLevel(totals)
  const quota = totals.udledningskvoteMarkKgn

  if (totals.calculatedCount === 0) {
    return {
      level,
      label: `Ikke beregnet · ${formatFieldCount(totals.fieldCount)}`,
      title: isSimulationView
        ? `Kør Optimér for at beregne markerne (${formatFieldCount(totals.fieldCount)})`
        : `Ingen marker er beregnet endnu (${formatFieldCount(totals.fieldCount)})`,
    }
  }

  const emission =
    quota > 0
      ? `${formatWholeNumber(totals.nLoad)} / ${formatWholeNumber(quota)} kg N`
      : `${formatWholeNumber(totals.nLoad)} kg N`
  const fullEmission = formatQuotaAmount(totals.nLoad, quota)

  return {
    level,
    label: `${emission} · ${formatCompactKr(totals.db2)}`,
    title: `Udledning ${fullEmission} pr. gennemsnitsår, DB2 ${formatWholeNumber(totals.db2)} kr`,
  }
}

const totalsEqual = (left: FieldTotals, right: FieldTotals) =>
  left.fieldCount === right.fieldCount &&
  left.calculatedCount === right.calculatedCount &&
  left.uncalculatedCount === right.uncalculatedCount &&
  left.areaHa === right.areaHa &&
  left.db2 === right.db2 &&
  left.nLoad === right.nLoad &&
  left.leaching === right.leaching &&
  left.fen === right.fen &&
  left.udledningskvoteMarkKgn === right.udledningskvoteMarkKgn

const isFullyCalculated = (totals: FieldTotals) =>
  totals.fieldCount > 0 && totals.calculatedCount === totals.fieldCount

const meetsQuota = (totals: FieldTotals) => {
  const level = totalsQuotaStatusLevel(totals)
  return level === 'ok' || level === 'near'
}

const pickBestSimulationId = (
  totalsBySimulation: Record<string, FieldTotals>,
): string | null => {
  const complete = Object.entries(totalsBySimulation).filter(([, totals]) =>
    isFullyCalculated(totals),
  )
  if (complete.length < 2) return null
  const compliant = complete.filter(([, totals]) => meetsQuota(totals))
  if (compliant.length === 0) return null
  return compliant.reduce((best, entry) =>
    entry[1].db2 > best[1].db2 ? entry : best,
  )[0]
}

const buildCopyInput = (simulation: Simulation): CreateSimulationInput => ({
  name: `${simulation.name} (kopi)`,
  saedskiftevarianter: simulation.rotationSaedskiftevarianter,
  nNormProcenter: simulation.rotationNNormProcenter,
  godning: simulation.godning,
  eeaFdato: simulation.eeaFdato,
  eeaPrecisionDagsbasis: simulation.eeaPrecisionDagsbasis,
})

type FarmSidebarProps = {
  farm: Farm
  fields: FieldRecord[]
  activeFields: FieldRecord[]
  simulations: Simulation[]
  selection: FarmViewSelection
  loadingSelection?: boolean
  onSelectionChange: (selection: FarmViewSelection) => void
  mode: FarmInspectorMode
  onModeChange: (mode: FarmInspectorMode) => void
  onSelectField: (fieldId: string) => void
  onOptimize: () => void
  onYearlyOptimize: () => void
  onError: (message: string | null) => void
  width: number
  onWidthChange: (width: number) => void
}

/**
 * Navigation for the bedrift: back to the bedrift list, then the visninger.
 * Rows are single-line so the list stays dense; only the selected visning
 * expands to describe itself, which keeps the detail where it is being read.
 * Collapses to an icon rail, so every visning keeps a row even when minimised.
 */
export const FarmSidebar = ({
  farm,
  fields,
  activeFields,
  simulations,
  selection,
  loadingSelection = false,
  onSelectionChange,
  mode,
  onModeChange,
  onSelectField,
  onOptimize,
  onYearlyOptimize,
  onError,
  width,
  onWidthChange,
}: FarmSidebarProps) => {
  const { user } = useAuth()
  const email = user?.email ?? ''
  const role = email ? getStoredRole(email) : null
  const showAllFarms = role !== 'landmand'
  const [deletingSimulationId, setDeletingSimulationId] = useState<
    string | null
  >(null)
  const [copyingSimulationId, setCopyingSimulationId] = useState<string | null>(
    null,
  )
  const [simulationToDelete, setSimulationToDelete] =
    useState<Simulation | null>(null)
  const [newSimulationOpen, setNewSimulationOpen] = useState(false)
  const [totalsBySimulation, setTotalsBySimulation] = useState<
    Record<string, FieldTotals>
  >({})
  const historyFigures = describeKeyFigures(fields, false)
  const bestSimulationId = useMemo(
    () => pickBestSimulationId(totalsBySimulation),
    [totalsBySimulation],
  )

  const reportTotals = useCallback(
    (simulationId: string, totals: FieldTotals | null) => {
      setTotalsBySimulation((current) => {
        const existing = current[simulationId]
        if (totals === null) {
          if (!existing) return current
          const next = { ...current }
          delete next[simulationId]
          return next
        }
        if (existing && totalsEqual(existing, totals)) return current
        return { ...current, [simulationId]: totals }
      })
    },
    [],
  )

  const removeSimulation = async (simulationId: string) => {
    setDeletingSimulationId(simulationId)
    try {
      await deleteSimulation(farm.id, simulationId)
      await mutate(simulationsKey(farm.id))
      await mutate(simulationFieldsKey(farm.id, simulationId), undefined, {
        revalidate: false,
      })
      if (selection.kind === 'simulation' && selection.id === simulationId) {
        onSelectionChange({ kind: 'current' })
      }
      onError(null)
    } catch {
      onError('Kunne ikke slette simuleringen.')
    } finally {
      setDeletingSimulationId(null)
    }
  }

  const copySimulation = async (simulation: Simulation) => {
    setCopyingSimulationId(simulation.id)
    let created: Simulation
    try {
      created = await createSimulation(farm.id, buildCopyInput(simulation))
      await mutate(simulationsKey(farm.id))
      onSelectionChange({ kind: 'simulation', id: created.id })
      onError(null)
    } catch {
      onError('Kunne ikke kopiere simuleringen.')
      setCopyingSimulationId(null)
      return
    }
    try {
      await updateSimulationConstraints(
        farm.id,
        created.id,
        simulation.constraints,
      )
      await mutate(simulationsKey(farm.id))
    } catch {
      onError('Simuleringen blev kopieret, men reglerne kunne ikke kopieres.')
    } finally {
      setCopyingSimulationId(null)
    }
  }

  return (
    <Sidebar collapsible="icon" aria-label="Navigation for bedriften">
      <SidebarHeader className="h-13 justify-center border-b border-sidebar-border px-2 py-0">
        <SidebarBrand />
      </SidebarHeader>

      <SidebarContent>
        <FieldSearch
          fields={activeFields}
          loading={loadingSelection}
          onSelectField={onSelectField}
        />

        {showAllFarms ? (
          <SidebarGroup className="py-1">
            <SidebarGroupLabel>Bedrift</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                <SidebarMenuItem>
                  <SidebarMenuButton asChild tooltip="Bedrifter">
                    <Link to="/" state={HOME_OVERVIEW_STATE}>
                      <Warehouse />
                      <span>Bedrifter</span>
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        ) : null}

        <SidebarGroup className="py-1">
          <SidebarGroupLabel>Visninger</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              <SidebarMenuItem>
                <SidebarMenuButton
                  size="lg"
                  isActive={selection.kind === 'current'}
                  aria-current={
                    selection.kind === 'current' ? 'page' : undefined
                  }
                  className="group-data-[collapsible=icon]:justify-center"
                  tooltip={{
                    children: (
                      <div className="grid gap-0.5">
                        <span>Afgrødehistorik</span>
                        <span>{historyFigures.label}</span>
                      </div>
                    ),
                  }}
                  onClick={() => onSelectionChange({ kind: 'current' })}
                >
                  <History />
                  <ViewMenuLabel name="Afgrødehistorik">
                    <KeyFiguresLine figures={historyFigures} />
                  </ViewMenuLabel>
                </SidebarMenuButton>
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        <SidebarGroup className="py-1">
          <SidebarGroupLabel>Simuleringer</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {simulations.map((simulation) => {
                const selected =
                  selection.kind === 'simulation' &&
                  selection.id === simulation.id
                return (
                  <SimulationMenuItem
                    key={simulation.id}
                    farmId={farm.id}
                    simulation={simulation}
                    liveFields={fields}
                    isBest={bestSimulationId === simulation.id}
                    selected={selected}
                    loading={loadingSelection && selected}
                    deleting={deletingSimulationId === simulation.id}
                    copying={copyingSimulationId === simulation.id}
                    mode={mode}
                    onModeChange={onModeChange}
                    onOptimize={onOptimize}
                    onYearlyOptimize={onYearlyOptimize}
                    onTotals={reportTotals}
                    onSelect={() =>
                      onSelectionChange({
                        kind: 'simulation',
                        id: simulation.id,
                      })
                    }
                    onCopy={() => void copySimulation(simulation)}
                    onDelete={() => setSimulationToDelete(simulation)}
                  />
                )
              })}
              <SidebarMenuItem>
                <SidebarMenuButton
                  className="text-sidebar-foreground/70"
                  tooltip="Ny simulering"
                  onClick={() => setNewSimulationOpen(true)}
                >
                  <Plus />
                  <span>Ny simulering</span>
                </SidebarMenuButton>
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>

      <SidebarFooter className="p-1 pb-3">
        <CollapseMenuButton />
        <SidebarUserMenu />
      </SidebarFooter>

      <SidebarWidthHandle width={width} onWidthChange={onWidthChange} />

      <NewScenarioPanel
        farmId={farm.id}
        fields={fields}
        open={newSimulationOpen}
        onOpenChange={setNewSimulationOpen}
        onSimulationCreated={(simulation) =>
          onSelectionChange({ kind: 'simulation', id: simulation.id })
        }
        onError={onError}
      />
      <DeleteSimulationDialog
        simulation={simulationToDelete}
        onOpenChange={(open) => {
          if (!open) setSimulationToDelete(null)
        }}
        onConfirm={(simulationId) => void removeSimulation(simulationId)}
      />
    </Sidebar>
  )
}

const SidebarBrand = () => (
  <div className="flex items-center gap-2.5 group-data-[collapsible=icon]:justify-center">
    <img
      src="/plantperform-mark.svg"
      alt=""
      className="size-9 shrink-0 group-data-[collapsible=icon]:size-8"
    />
    <div className="grid min-w-0 leading-tight group-data-[collapsible=icon]:hidden">
      <span className="truncate text-base font-semibold tracking-tight">
        PlantPerform
      </span>
      <span className="truncate text-xs text-muted-foreground">
        Sædskifteplanlægning
      </span>
    </div>
  </div>
)

const MAX_SEARCH_RESULTS = 8

const matchFields = (fields: FieldRecord[], query: string): FieldRecord[] => {
  const needle = query.trim().toLowerCase()
  if (needle === '') return []
  const ranked = fields.flatMap((field) => {
    const name = field.name.toLowerCase()
    if (name.startsWith(needle)) return [{ field, rank: 0 }]
    if (name.includes(needle)) return [{ field, rank: 1 }]
    return []
  })
  return ranked
    .sort((left, right) => left.rank - right.rank)
    .slice(0, MAX_SEARCH_RESULTS)
    .map((entry) => entry.field)
}

type FieldSearchProps = {
  fields: FieldRecord[]
  loading: boolean
  onSelectField: (fieldId: string) => void
}

const FieldSearch = ({ fields, loading, onSelectField }: FieldSearchProps) => {
  const iconRail = useIsIconRail()
  const { toggleSidebar } = useSidebar()
  const listId = useId()
  const inputRef = useRef<HTMLInputElement>(null)
  const focusAfterExpandRef = useRef(false)
  const [query, setQuery] = useState('')
  const [activeIndex, setActiveIndex] = useState(0)
  const matches = useMemo(() => matchFields(fields, query), [fields, query])
  const hasQuery = query.trim() !== ''
  const hasMatches = matches.length > 0
  const highlightedIndex = hasMatches
    ? Math.min(activeIndex, matches.length - 1)
    : -1
  const optionId = (index: number) => `${listId}-option-${index}`

  useEffect(() => {
    if (iconRail || !focusAfterExpandRef.current) return
    focusAfterExpandRef.current = false
    inputRef.current?.focus()
  }, [iconRail])

  const clear = () => {
    setQuery('')
    setActiveIndex(0)
  }

  const choose = (field: FieldRecord | undefined) => {
    if (!field) return
    onSelectField(field.id)
    clear()
  }

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Escape') {
      if (!hasQuery) return
      event.preventDefault()
      clear()
      return
    }
    if (matches.length === 0) return
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      setActiveIndex((highlightedIndex + 1) % matches.length)
      return
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault()
      setActiveIndex((highlightedIndex - 1 + matches.length) % matches.length)
      return
    }
    if (event.key === 'Enter') {
      event.preventDefault()
      choose(matches[Math.max(0, highlightedIndex)])
    }
  }

  if (iconRail) {
    return (
      <SidebarGroup className="py-1">
        <SidebarGroupContent>
          <SidebarMenu>
            <SidebarMenuItem>
              <SidebarMenuButton
                tooltip="Find mark"
                aria-label="Find mark"
                className="group-data-[collapsible=icon]:justify-center"
                onClick={() => {
                  focusAfterExpandRef.current = true
                  toggleSidebar()
                }}
              >
                <Search />
                <span>Find mark</span>
              </SidebarMenuButton>
            </SidebarMenuItem>
          </SidebarMenu>
        </SidebarGroupContent>
      </SidebarGroup>
    )
  }

  return (
    <SidebarGroup className="py-1">
      <SidebarGroupContent className="space-y-1">
        <div className="relative">
          <Search
            className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden="true"
          />
          <SidebarInput
            ref={inputRef}
            type="search"
            role="combobox"
            placeholder="Find mark..."
            aria-label="Find mark"
            aria-expanded={hasMatches}
            aria-controls={hasMatches ? listId : undefined}
            aria-autocomplete="list"
            aria-activedescendant={
              highlightedIndex >= 0 ? optionId(highlightedIndex) : undefined
            }
            autoComplete="off"
            className="pl-8"
            value={query}
            onChange={(event) => {
              setQuery(event.target.value)
              setActiveIndex(0)
            }}
            onKeyDown={onKeyDown}
          />
        </div>
        {hasQuery ? (
          !hasMatches ? (
            <p
              role="status"
              className="px-2 py-1 text-xs text-muted-foreground"
            >
              {loading ? 'Henter marker' : 'Ingen marker matcher'}
            </p>
          ) : (
            <SidebarMenu
              id={listId}
              role="listbox"
              aria-label="Marker der matcher"
            >
              {matches.map((field, index) => {
                const highlighted = index === highlightedIndex
                return (
                  <SidebarMenuItem key={field.id} role="none">
                    <SidebarMenuButton
                      id={optionId(index)}
                      role="option"
                      size="sm"
                      aria-selected={highlighted}
                      isActive={highlighted}
                      tabIndex={-1}
                      onMouseDown={(event) => event.preventDefault()}
                      onMouseEnter={() => setActiveIndex(index)}
                      onClick={() => choose(field)}
                    >
                      <span className="truncate">{field.name}</span>
                      <span className="ml-auto shrink-0 text-xs font-normal text-sidebar-foreground/70 tabular-nums">
                        {formatNumber(field.areaHa)} ha
                      </span>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                )
              })}
            </SidebarMenu>
          )
        ) : null}
      </SidebarGroupContent>
    </SidebarGroup>
  )
}

const CollapseMenuButton = () => {
  const { toggleSidebar } = useSidebar()

  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <SidebarMenuButton
          className="text-sidebar-foreground/70"
          tooltip="Vis sidepanel"
          onClick={toggleSidebar}
        >
          <PanelLeft />
          <span>Skjul sidepanel</span>
        </SidebarMenuButton>
      </SidebarMenuItem>
    </SidebarMenu>
  )
}

const SidebarUserMenu = () => {
  const { user } = useAuth()
  const iconRail = useIsIconRail()
  const email = user?.email ?? ''
  const initial = email.charAt(0).toUpperCase()
  const role = email ? getStoredRole(email) : null

  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <SidebarMenuButton
              size="lg"
              aria-label={email ? `Brugermenu, ${email}` : 'Brugermenu'}
              tooltip={email}
              className="data-[state=open]:bg-sidebar-accent data-[state=open]:text-sidebar-accent-foreground group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:px-0! group-data-[collapsible=icon]:py-0!"
            >
              <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-primary text-sm font-semibold text-primary-foreground">
                {initial}
              </span>
              <div className="grid min-w-0 flex-1 leading-tight group-data-[collapsible=icon]:hidden">
                <span className="truncate text-sm">{email}</span>
                {role ? (
                  <span className="truncate text-xs text-sidebar-foreground/70">
                    {ROLE_LABELS[role]}
                  </span>
                ) : null}
              </div>
              <ChevronsUpDown
                className="ml-auto text-sidebar-foreground/70 group-data-[collapsible=icon]:hidden"
                aria-hidden="true"
              />
            </SidebarMenuButton>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            side={iconRail ? 'right' : 'top'}
            align="start"
            className="w-(--radix-dropdown-menu-trigger-width) min-w-56"
          >
            <UserMenuContent />
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarMenuItem>
    </SidebarMenu>
  )
}

type ViewMenuLabelProps = {
  name: string
  badge?: ReactNode
  children: ReactNode
}

const ViewMenuLabel = ({ name, badge, children }: ViewMenuLabelProps) => (
  <div className="grid min-w-0 flex-1 leading-tight group-data-[collapsible=icon]:hidden">
    <span className="flex min-w-0 items-center gap-1.5">
      <span className="truncate">{name}</span>
      {badge}
    </span>
    {children}
  </div>
)

const BestBadge = () => (
  <span
    className="shrink-0 rounded-full border border-sidebar-border bg-sidebar-accent px-1.5 text-xs font-medium text-sidebar-accent-foreground"
    title="Overholder kvoten med højest DB2"
  >
    Bedste<span className="sr-only">, bedste simulering</span>
  </span>
)

type KeyFiguresLineProps = {
  figures?: ViewKeyFigures
  loading?: boolean
  error?: boolean
}

const KeyFiguresLine = ({
  figures,
  loading = false,
  error = false,
}: KeyFiguresLineProps) => {
  if (loading || (!figures && !error)) {
    return (
      <span className="flex h-4 items-center">
        <span
          className="h-3 w-24 rounded bg-sidebar-accent motion-safe:animate-pulse"
          aria-hidden="true"
        />
        <span className="sr-only">Henter nøgletal</span>
      </span>
    )
  }

  if (!figures) {
    return (
      <span className="truncate text-xs font-normal text-sidebar-foreground/70">
        Kunne ikke hente nøgletal
      </span>
    )
  }

  return (
    <span
      className="flex min-w-0 items-center gap-1.5 text-xs font-normal text-sidebar-foreground/70"
      title={figures.title}
    >
      <span
        className={cn(
          'size-1.5 shrink-0 rounded-full',
          QUOTA_STATUS_STYLES[figures.level].dot,
        )}
        aria-hidden="true"
      />
      <span className="truncate">{figures.label}</span>
    </span>
  )
}

type SimulationDetailLineProps = {
  changedCount: number
  lockedCount: number
  fieldCount: number
}

const SimulationDetailLine = ({
  changedCount,
  lockedCount,
  fieldCount,
}: SimulationDetailLineProps) => {
  if (changedCount === 0 && lockedCount === 0) return null

  const parts: string[] = []
  if (changedCount > 0) parts.push(`${formatFieldCount(changedCount)} ændret`)
  if (lockedCount > 0) parts.push(`${formatFieldCount(lockedCount)} låst`)

  return (
    <span
      className="truncate text-xs font-normal text-sidebar-foreground/70 tabular-nums"
      title={`${changedCount} af ${fieldCount} marker har et andet sædskifte end afgrødehistorikken${
        lockedCount > 0 ? `, ${lockedCount} er låst` : ''
      }`}
    >
      {parts.join(' · ')}
    </span>
  )
}

type SimulationMenuItemProps = {
  farmId: string
  simulation: Simulation
  liveFields: FieldRecord[]
  isBest: boolean
  selected: boolean
  loading: boolean
  deleting: boolean
  copying: boolean
  mode: FarmInspectorMode
  onModeChange: (mode: FarmInspectorMode) => void
  onOptimize: () => void
  onYearlyOptimize: () => void
  onTotals: (simulationId: string, totals: FieldTotals | null) => void
  onSelect: () => void
  onCopy: () => void
  onDelete: () => void
}

const SimulationMenuItem = ({
  farmId,
  simulation,
  liveFields,
  isBest,
  selected,
  loading,
  deleting,
  copying,
  mode,
  onModeChange,
  onOptimize,
  onYearlyOptimize,
  onTotals,
  onSelect,
  onCopy,
  onDelete,
}: SimulationMenuItemProps) => {
  const iconRail = useIsIconRail()
  const createdLabel = formatCreatedAt(simulation.createdAt)
  const {
    data: simulationFields,
    error: fieldsError,
    isLoading: fieldsLoading,
  } = useSimulationFields(farmId, simulation.id)
  const figures = simulationFields
    ? describeKeyFigures(simulationFields, true)
    : undefined
  const totals = useMemo(
    () =>
      simulationFields ? computeFieldTotals(simulationFields, true) : null,
    [simulationFields],
  )
  const changedCount = useMemo(
    () =>
      simulationFields ? changedFieldIds(simulationFields, liveFields).size : 0,
    [simulationFields, liveFields],
  )
  const lockedCount = useMemo(
    () =>
      simulationFields ? simulationFields.filter(isFieldLocked).length : 0,
    [simulationFields],
  )

  useEffect(() => {
    onTotals(simulation.id, totals)
    return () => onTotals(simulation.id, null)
  }, [simulation.id, totals, onTotals])

  return (
    <SidebarMenuItem>
      <Tooltip>
        <TooltipTrigger asChild>
          <SidebarMenuButton
            size="lg"
            isActive={selected}
            aria-current={selected ? 'page' : undefined}
            className="h-auto min-h-12 py-1.5 group-data-[collapsible=icon]:min-h-0 group-data-[collapsible=icon]:justify-center"
            title={iconRail ? undefined : createdLabel}
            onClick={onSelect}
          >
            {loading ? (
              <Loader2 className="motion-safe:animate-spin" />
            ) : (
              <FlaskConical />
            )}
            <ViewMenuLabel
              name={simulation.name}
              badge={isBest ? <BestBadge /> : undefined}
            >
              <KeyFiguresLine
                figures={figures}
                loading={fieldsLoading}
                error={Boolean(fieldsError)}
              />
              {simulationFields ? (
                <SimulationDetailLine
                  changedCount={changedCount}
                  lockedCount={lockedCount}
                  fieldCount={simulationFields.length}
                />
              ) : null}
            </ViewMenuLabel>
          </SidebarMenuButton>
        </TooltipTrigger>
        <TooltipContent side="right" align="center" hidden={!iconRail}>
          {iconRail ? (
            <div className="grid gap-0.5">
              <span>{simulation.name}</span>
              <span>{createdLabel}</span>
              {figures ? <span>{figures.label}</span> : null}
            </div>
          ) : (
            createdLabel
          )}
        </TooltipContent>
      </Tooltip>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <SidebarMenuAction
            showOnHover
            disabled={deleting || copying}
            className="peer-data-[size=lg]/menu-button:top-3.5"
            aria-label={`Handlinger for ${simulation.name}`}
          >
            {copying ? (
              <Loader2 className="motion-safe:animate-spin" />
            ) : (
              <MoreHorizontal />
            )}
          </SidebarMenuAction>
        </DropdownMenuTrigger>
        <DropdownMenuContent side="right" align="start">
          <DropdownMenuItem
            disabled={copying}
            title="Opretter en ny simulering med samme indstillinger og regler. Markernes låse følger ikke med."
            onSelect={onCopy}
          >
            <Copy className="mr-2 size-4" aria-hidden="true" />
            Kopier som ny
          </DropdownMenuItem>
          <DropdownMenuItem
            className="text-destructive focus:text-destructive"
            disabled={deleting}
            onSelect={onDelete}
          >
            <Trash2 className="mr-2 size-4" aria-hidden="true" />
            Slet
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      {selected ? (
        <SimulationSubMenu
          mode={mode}
          disabled={loading}
          onModeChange={onModeChange}
          onOptimize={onOptimize}
          onYearlyOptimize={onYearlyOptimize}
        />
      ) : null}
    </SidebarMenuItem>
  )
}

type SimulationSubMenuProps = {
  mode: FarmInspectorMode
  disabled: boolean
  onModeChange: (mode: FarmInspectorMode) => void
  onOptimize: () => void
  onYearlyOptimize: () => void
}

const SimulationSubMenu = ({
  mode,
  disabled,
  onModeChange,
  onOptimize,
  onYearlyOptimize,
}: SimulationSubMenuProps) => (
  <SidebarMenuSub>
    <SidebarMenuSubItem>
      <SidebarMenuSubButton
        asChild
        className="w-full"
        isActive={mode === 'values'}
      >
        <button
          type="button"
          aria-current={mode === 'values' ? 'page' : undefined}
          title="Vis hvad optimeringen har beregnet for markerne"
          onClick={() => onModeChange('values')}
        >
          <Table2 />
          <span>Værdier</span>
        </button>
      </SidebarMenuSubButton>
    </SidebarMenuSubItem>
    <SidebarMenuSubItem>
      <SidebarMenuSubButton
        asChild
        isActive={mode === 'rules'}
        className="w-full data-[active=true]:text-rules! data-[active=true]:[&>svg]:text-rules!"
      >
        <button
          type="button"
          aria-current={mode === 'rules' ? 'page' : undefined}
          title="Sæt hvad optimeringen må gøre"
          onClick={() => onModeChange('rules')}
        >
          <SlidersHorizontal />
          <span>Regler</span>
        </button>
      </SidebarMenuSubButton>
    </SidebarMenuSubItem>
    <SidebarMenuSubItem>
      <SidebarMenuSubButton asChild className="w-full">
        <button type="button" disabled={disabled} onClick={onOptimize}>
          <Play />
          <span>Optimér</span>
        </button>
      </SidebarMenuSubButton>
    </SidebarMenuSubItem>
    <SidebarMenuSubItem>
      <SidebarMenuSubButton asChild className="w-full">
        <button type="button" disabled={disabled} onClick={onYearlyOptimize}>
          <CalendarRange />
          <span>Års-optimering</span>
        </button>
      </SidebarMenuSubButton>
    </SidebarMenuSubItem>
  </SidebarMenuSub>
)

type DeleteSimulationDialogProps = {
  simulation: Simulation | null
  onOpenChange: (open: boolean) => void
  onConfirm: (simulationId: string) => void
}

const DeleteSimulationDialog = ({
  simulation,
  onOpenChange,
  onConfirm,
}: DeleteSimulationDialogProps) => (
  <Dialog open={simulation !== null} onOpenChange={onOpenChange}>
    <DialogContent>
      <DialogHeader>
        <DialogTitle>Slet {simulation?.name}?</DialogTitle>
        <DialogDescription>
          Simuleringen og dens kopierede marker slettes. Bedriftens egne marker
          berøres ikke. Handlingen kan ikke fortrydes.
        </DialogDescription>
      </DialogHeader>
      <DialogFooter>
        <DialogClose asChild>
          <Button variant="outline">Annuller</Button>
        </DialogClose>
        <DialogClose asChild>
          <Button
            variant="destructive"
            onClick={() => {
              if (simulation) onConfirm(simulation.id)
            }}
          >
            Slet simulering
          </Button>
        </DialogClose>
      </DialogFooter>
    </DialogContent>
  </Dialog>
)

type SidebarWidthHandleProps = {
  width: number
  onWidthChange: (width: number) => void
}

const SidebarWidthHandle = ({
  width,
  onWidthChange,
}: SidebarWidthHandleProps) => {
  const { state, isMobile } = useSidebar()
  if (isMobile || state !== 'expanded') return null

  return <SidebarResizeHandle width={width} onWidthChange={onWidthChange} />
}
