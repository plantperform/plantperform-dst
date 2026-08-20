import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { mutate } from 'swr'

import {
  farmKey,
  farmFieldsKey,
  simulationFieldsKey,
  simulationsKey,
  useSimulationFields,
} from '@/api/hooks'
import {
  createSimulation,
  deleteFarm,
  deleteSimulation,
  updateFarm,
} from '@/api/mutations'
import type { Farm, FieldRecord, Simulation } from '@/api/types'
import type { FarmViewSelection } from '@/components/farm/types'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

const formatNumber = (value: number) =>
  new Intl.NumberFormat('da-DK', { maximumFractionDigits: 1 }).format(value)

const formatFieldCount = (count: number) =>
  `${count} ${count === 1 ? 'mark' : 'marker'}`

const getFieldTotals = (fields: FieldRecord[]) => ({
  area: fields.reduce((sum, field) => sum + field.areaHa, 0),
  db2: fields.reduce((sum, field) => sum + field.db2, 0),
  nLoad: fields.reduce((sum, field) => sum + field.nLoad, 0),
  leaching: fields.reduce((sum, field) => sum + field.leaching, 0),
})

const formatRelativeTime = (value: string) => {
  const createdAt = new Date(value).getTime()
  if (Number.isNaN(createdAt)) return 'oprettet for nylig'

  const diffMinutes = Math.max(0, Math.round((Date.now() - createdAt) / 60_000))
  if (diffMinutes < 1) return 'oprettet netop nu'
  if (diffMinutes < 60) return `oprettet for ${diffMinutes} min. siden`

  const diffHours = Math.round(diffMinutes / 60)
  if (diffHours < 24) return `oprettet for ${diffHours} t. siden`

  const diffDays = Math.round(diffHours / 24)
  return `oprettet for ${diffDays} d. siden`
}

type FarmSidebarProps = {
  farm: Farm
  fields: FieldRecord[]
  simulations: Simulation[]
  selection: FarmViewSelection
  onSelectionChange: (selection: FarmViewSelection) => void
  onError: (message: string | null) => void
}

export const FarmSidebar = ({
  farm,
  fields,
  simulations,
  selection,
  onSelectionChange,
  onError,
}: FarmSidebarProps) => {
  const navigate = useNavigate()
  const [isDeleting, setIsDeleting] = useState(false)
  const [isCreatingSimulation, setIsCreatingSimulation] = useState(false)
  const [deletingSimulationId, setDeletingSimulationId] = useState<
    string | null
  >(null)
  const [simulationDialogOpen, setSimulationDialogOpen] = useState(false)
  const [simulationName, setSimulationName] = useState('')
  const [quotaDialogOpen, setQuotaDialogOpen] = useState(false)
  const [quotaInput, setQuotaInput] = useState(String(farm.nitrogenQuotaKg))
  const [isSavingQuota, setIsSavingQuota] = useState(false)
  const totals = getFieldTotals(fields)
  const quotaSum = fields.reduce(
    (sum, field) => sum + (field.nQuotaKgN ?? 0),
    0,
  )
  const roundedQuotaSum = Math.round(quotaSum)
  const missingQuotaCount = fields.filter(
    (field) => field.nQuotaKgN === null,
  ).length

  const setQuotaDialogState = (open: boolean) => {
    setQuotaDialogOpen(open)
    if (open) setQuotaInput(String(farm.nitrogenQuotaKg))
  }

  const confirmDelete = async () => {
    setIsDeleting(true)
    try {
      await deleteFarm(farm.id)
      await mutate('/farms')
      await mutate(farmFieldsKey(farm.id))
      navigate('/')
    } catch {
      onError('Kunne ikke slette bedriften.')
    } finally {
      setIsDeleting(false)
    }
  }

  const addSimulation = async () => {
    const name = simulationName.trim()
    if (!name) {
      onError('Indtast et navn til simuleringen.')
      return
    }

    setIsCreatingSimulation(true)
    try {
      const simulation = await createSimulation(farm.id, { name })
      await mutate(
        simulationsKey(farm.id),
        (current: Simulation[] = []) => [...current, simulation],
        { revalidate: false },
      )
      await mutate(simulationFieldsKey(farm.id, simulation.id))
      void mutate(simulationsKey(farm.id))
      onSelectionChange({ kind: 'simulation', id: simulation.id })
      setSimulationName('')
      setSimulationDialogOpen(false)
      onError(null)
    } catch {
      onError('Kunne ikke oprette simuleringen.')
    } finally {
      setIsCreatingSimulation(false)
    }
  }

  const saveQuota = async () => {
    const quota = Number(quotaInput)
    if (!Number.isFinite(quota) || quota < 0) {
      onError('Kvælstofkvoten skal være et positivt tal eller nul.')
      return
    }

    setIsSavingQuota(true)
    try {
      const updatedFarm = await updateFarm(farm.id, { nitrogenQuotaKg: quota })
      await mutate(farmKey(farm.id), updatedFarm, { revalidate: false })
      await mutate('/farms')
      setQuotaDialogOpen(false)
      onError(null)
    } catch {
      onError('Kunne ikke opdatere kvælstofkvoten.')
    } finally {
      setIsSavingQuota(false)
    }
  }

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

  return (
    <aside className="border-b bg-muted/30 p-6 lg:min-h-screen lg:border-b-0 lg:border-r">
      <Button
        asChild
        variant="outline"
        size="sm"
        className="mb-6 bg-background/80"
      >
        <Link to="/">Tilbage til bedrifter</Link>
      </Button>

      <div className="space-y-6">
        <div>
          <p className="text-sm font-medium text-muted-foreground">Bedrift</p>
          <h1 className="mt-2 text-3xl font-semibold tracking-tight">
            {farm.name}
          </h1>
          <p className="mt-2 text-sm text-muted-foreground">{farm.ownerName}</p>
        </div>

        <div className="grid gap-3 text-sm">
          <div className="rounded-lg border bg-background p-4">
            <p className="text-muted-foreground">CVR</p>
            <p className="mt-1 font-medium">{farm.cvr ?? '—'}</p>
          </div>
          <div className="rounded-lg border bg-background p-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-muted-foreground">Kvælstofkvote</p>
                <p className="mt-1 font-medium">
                  {formatNumber(farm.nitrogenQuotaKg)} kg N
                </p>
              </div>
              <Dialog open={quotaDialogOpen} onOpenChange={setQuotaDialogState}>
                <DialogTrigger asChild>
                  <Button
                    size="sm"
                    variant="outline"
                    className="bg-background/80"
                  >
                    Rediger
                  </Button>
                </DialogTrigger>
                <DialogContent>
                  <DialogHeader>
                    <DialogTitle>Rediger kvælstofkvote</DialogTitle>
                    <DialogDescription>
                      Justér bedriftens samlede kvælstofkvote, eller beregn den
                      ud fra summen af markernes kvoter.
                    </DialogDescription>
                  </DialogHeader>
                  <div className="space-y-4">
                    <div className="space-y-2">
                      <Label htmlFor="farm-quota">Kvælstofkvote (kg N)</Label>
                      <Input
                        id="farm-quota"
                        type="number"
                        min="0"
                        step="0.1"
                        value={quotaInput}
                        onChange={(event) => setQuotaInput(event.target.value)}
                      />
                    </div>
                    <div className="space-y-1 text-sm">
                      <p className="text-muted-foreground">
                        Sum af markernes kvoter: {formatNumber(roundedQuotaSum)}{' '}
                        kg N
                      </p>
                      {missingQuotaCount > 0 ? (
                        <p className="text-amber-700">
                          {missingQuotaCount}{' '}
                          {missingQuotaCount === 1 ? 'mark' : 'marker'} uden
                          kvote indgår som 0 kg N. Summen kan derfor være for
                          lav.
                        </p>
                      ) : null}
                    </div>
                  </div>
                  <DialogFooter>
                    <DialogClose asChild>
                      <Button variant="outline">Annuller</Button>
                    </DialogClose>
                    <Button
                      variant="outline"
                      onClick={() => setQuotaInput(String(roundedQuotaSum))}
                      disabled={fields.length === 0}
                    >
                      Brug sum fra marker
                    </Button>
                    <Button
                      onClick={() => void saveQuota()}
                      disabled={isSavingQuota}
                    >
                      {isSavingQuota ? 'Gemmer...' : 'Gem'}
                    </Button>
                  </DialogFooter>
                </DialogContent>
              </Dialog>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="rounded-lg border bg-background p-4">
              <p className="text-muted-foreground">Marker</p>
              <p className="mt-1 text-xl font-semibold">{fields.length}</p>
            </div>
            <div className="rounded-lg border bg-background p-4">
              <p className="text-muted-foreground">Areal</p>
              <p className="mt-1 text-xl font-semibold">
                {formatNumber(totals.area)} ha
              </p>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="rounded-lg border bg-background p-4">
              <p className="text-muted-foreground">DB2</p>
              <p className="mt-1 text-xl font-semibold">
                {formatNumber(totals.db2)} kr
              </p>
            </div>
            <div className="rounded-lg border bg-background p-4">
              <p className="text-muted-foreground">Udledning</p>
              <p className="mt-1 text-xl font-semibold">
                {formatNumber(totals.nLoad)} kg N
              </p>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="rounded-lg border bg-background p-4">
              <p className="text-muted-foreground">Udvaskning</p>
              <p className="mt-1 text-xl font-semibold">
                {formatNumber(totals.leaching)} kg N
              </p>
            </div>
          </div>
        </div>

        <div className="space-y-3">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-sm font-medium text-muted-foreground">
                Visninger
              </p>
              <p className="text-xs text-muted-foreground">
                Aktuelle marker og optimeringsalternativer.
              </p>
            </div>
            <Dialog
              open={simulationDialogOpen}
              onOpenChange={setSimulationDialogOpen}
            >
              <DialogTrigger asChild>
                <Button
                  size="sm"
                  variant="outline"
                  className="bg-background/80"
                >
                  Ny
                </Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Opret simulering</DialogTitle>
                  <DialogDescription>
                    Dette kopierer alle aktuelle marker til et redigerbart
                    alternativ.
                  </DialogDescription>
                </DialogHeader>
                <div className="space-y-2">
                  <Label htmlFor="simulation-name">Navn</Label>
                  <Input
                    id="simulation-name"
                    value={simulationName}
                    placeholder="Reduceret kvælstofscenarie"
                    onChange={(event) => setSimulationName(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') void addSimulation()
                    }}
                  />
                </div>
                <DialogFooter>
                  <DialogClose asChild>
                    <Button variant="outline">Annuller</Button>
                  </DialogClose>
                  <Button
                    onClick={() => void addSimulation()}
                    disabled={isCreatingSimulation}
                  >
                    {isCreatingSimulation ? 'Opretter...' : 'Opret simulering'}
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          </div>

          <div className="space-y-2">
            <button
              type="button"
              className={`w-full rounded-lg border p-3 text-left text-sm transition-colors ${
                selection.kind === 'current'
                  ? 'border-primary bg-primary/10'
                  : 'bg-background/70 hover:bg-background'
              }`}
              onClick={() => onSelectionChange({ kind: 'current' })}
            >
              <span
                className={
                  selection.kind === 'current' ? 'font-semibold' : 'font-medium'
                }
              >
                Aktuel
              </span>
              <span className="mt-1 block text-xs text-muted-foreground">
                {formatFieldCount(fields.length)} · {formatNumber(totals.area)}{' '}
                ha
              </span>
              <span className="mt-1 block text-xs text-muted-foreground">
                DB2 {formatNumber(totals.db2)} kr · Udledning{' '}
                {formatNumber(totals.nLoad)} kg N · Udvaskning{' '}
                {formatNumber(totals.leaching)} kg N
              </span>
            </button>

            {simulations.map((simulation) => (
              <SimulationViewRow
                key={simulation.id}
                farmId={farm.id}
                simulation={simulation}
                selected={
                  selection.kind === 'simulation' &&
                  selection.id === simulation.id
                }
                deleting={deletingSimulationId === simulation.id}
                onSelect={() =>
                  onSelectionChange({ kind: 'simulation', id: simulation.id })
                }
                onDelete={() => void removeSimulation(simulation.id)}
              />
            ))}
          </div>
        </div>

        <Dialog>
          <DialogTrigger asChild>
            <Button variant="outline" className="w-full bg-background/80">
              Slet bedrift
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Slet bedrift?</DialogTitle>
              <DialogDescription>
                Dette sletter bedriften og alle marker, der er importeret til
                den. Handlingen kan ikke fortrydes.
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <DialogClose asChild>
                <Button variant="outline">Annuller</Button>
              </DialogClose>
              <Button onClick={confirmDelete} disabled={isDeleting}>
                {isDeleting ? 'Sletter...' : 'Slet bedrift'}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </aside>
  )
}

type SimulationViewRowProps = {
  farmId: string
  simulation: Simulation
  selected: boolean
  deleting: boolean
  onSelect: () => void
  onDelete: () => void
}

const SimulationViewRow = ({
  farmId,
  simulation,
  selected,
  deleting,
  onSelect,
  onDelete,
}: SimulationViewRowProps) => {
  const { data: fields = [], isLoading } = useSimulationFields(
    farmId,
    simulation.id,
  )
  const totals = getFieldTotals(fields)

  return (
    <div
      className={`flex items-center gap-2 rounded-lg border bg-background/70 p-2 transition-colors ${
        selected ? 'border-primary bg-primary/10' : 'hover:bg-background'
      }`}
    >
      <button
        type="button"
        className="min-w-0 flex-1 text-left"
        onClick={onSelect}
      >
        <span
          className={`block truncate text-sm ${selected ? 'font-semibold' : 'font-medium'}`}
        >
          {simulation.name}
        </span>
        <span className="block text-xs text-muted-foreground">
          {formatRelativeTime(simulation.createdAt)}
        </span>
        <span className="mt-1 block text-xs text-muted-foreground">
          {isLoading
            ? 'Indlæser nøgletal...'
            : `${formatFieldCount(fields.length)} · ${formatNumber(totals.area)} ha`}
        </span>
        {!isLoading ? (
          <span className="mt-1 block text-xs text-muted-foreground">
            DB2 {formatNumber(totals.db2)} kr · Udledning{' '}
            {formatNumber(totals.nLoad)} kg N · Udvaskning{' '}
            {formatNumber(totals.leaching)} kg N
          </span>
        ) : null}
      </button>
      <Button
        size="sm"
        variant="outline"
        className="bg-background/80 px-2"
        onClick={onDelete}
        disabled={deleting}
        aria-label={`Slet ${simulation.name}`}
      >
        {deleting ? '...' : 'Slet'}
      </Button>
    </div>
  )
}
