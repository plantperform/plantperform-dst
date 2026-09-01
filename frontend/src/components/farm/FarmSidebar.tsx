import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { mutate } from 'swr'

import {
  farmFieldsKey,
  farmMembersKey,
  simulationFieldsKey,
  simulationsKey,
  useFarmMembers,
  useFarmUdledning,
  useSimulationFields,
} from '@/api/hooks'
import {
  addFarmMember,
  deleteFarm,
  deleteSimulation,
  removeFarmMember,
} from '@/api/mutations'
import { useAuth } from '@/auth/context'
import type { Farm, FieldRecord, Simulation } from '@/api/types'
import type { FarmViewSelection } from '@/components/farm/types'
import { NewScenarioPanel } from '@/components/farm/NewScenarioPanel'
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
import {
  formatFieldCount,
  formatNumber,
  formatRelativeTime,
  getFieldTotals,
} from '@/lib/farm-totals'

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
  const { user } = useAuth()
  const [isDeleting, setIsDeleting] = useState(false)
  const [deletingSimulationId, setDeletingSimulationId] = useState<
    string | null
  >(null)
  const [newScenarioOpen, setNewScenarioOpen] = useState(false)
  const [membersDialogOpen, setMembersDialogOpen] = useState(false)
  const [memberEmail, setMemberEmail] = useState('')
  const [isSharing, setIsSharing] = useState(false)
  const totals = getFieldTotals(fields)
  const { data: members = [], isLoading: membersLoading } = useFarmMembers(farm.id)
  const { data: udledningPerKystvandopland = [] } = useFarmUdledning(farm.id)

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

  const shareFarm = async () => {
    const email = memberEmail.trim().toLowerCase()
    if (!email || !email.includes('@')) {
      onError('Indtast en gyldig e-mailadresse.')
      return
    }
    setIsSharing(true)
    try {
      await addFarmMember(farm.id, email)
      await mutate(farmMembersKey(farm.id))
      setMemberEmail('')
      onError(null)
    } catch {
      onError('Kunne ikke dele bedriften. Brugeren skal have en bekræftet konto.')
    } finally {
      setIsSharing(false)
    }
  }

  const revokeMember = async (email: string) => {
    if (members.length <= 1) return
    try {
      await removeFarmMember(farm.id, email)
      await mutate(farmMembersKey(farm.id))
      if (user?.email.toLowerCase() === email.toLowerCase()) {
        await mutate('/farms')
        navigate('/')
      }
      onError(null)
    } catch {
      onError('Kunne ikke fjerne brugeren fra bedriften.')
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
            <p className="text-muted-foreground">Udledningskvote pr. kystvandopland</p>
            <div className="mt-3 space-y-2">
              {udledningPerKystvandopland.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  Ingen marker med et kystvandopland endnu.
                </p>
              ) : (
                udledningPerKystvandopland.map((entry) => (
                  <div
                    key={entry.kystvandId ?? 'ukendt'}
                    className="rounded border p-3 text-sm"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-medium">
                        {entry.kystvandNavn ??
                          (entry.kystvandId !== null
                            ? `Kystvandopland ${entry.kystvandId}`
                            : 'Uden kystvandopland')}
                      </span>
                      <span
                        className={`rounded px-2 py-0.5 text-xs font-medium ${
                          entry.overholder
                            ? 'bg-emerald-100 text-emerald-800'
                            : 'bg-red-100 text-red-800'
                        }`}
                      >
                        {entry.overholder ? 'Overholder' : 'Overskrider'}
                      </span>
                    </div>
                    <p className="mt-2 text-xl font-semibold">
                      {formatNumber(entry.udledningskvoteKgN)} kg N
                    </p>
                    <p className="text-xs text-muted-foreground">Udledningskvote</p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      Historisk &quot;estimeret&quot; udledning:{' '}
                      {formatNumber(entry.beregnetUdledningKgN)} kg N
                    </p>
                  </div>
                ))
              )}
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
            <Button
              size="sm"
              variant="outline"
              className="bg-background/80"
              onClick={() => setNewScenarioOpen(true)}
            >
              Ny
            </Button>
            <NewScenarioPanel
              farmId={farm.id}
              fields={fields}
              open={newScenarioOpen}
              onOpenChange={setNewScenarioOpen}
              onSimulationCreated={(simulation) =>
                onSelectionChange({ kind: 'simulation', id: simulation.id })
              }
              onError={onError}
            />
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
                Afgrødehistorik
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

        <Dialog open={membersDialogOpen} onOpenChange={setMembersDialogOpen}>
            <DialogTrigger asChild>
              <Button variant="outline" className="w-full bg-background/80">
                Del bedrift
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Del bedrift</DialogTitle>
                <DialogDescription>
                  Alle medlemmer har samme adgang og kan selv dele bedriften videre.
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-3">
                {membersLoading ? <p className="text-sm text-muted-foreground">Indlæser medlemmer...</p> : null}
                {members.map((member) => (
                  <div key={member.email} className="flex items-center justify-between gap-3 rounded border p-2 text-sm">
                    <span className="truncate">{member.email}</span>
                    <Button size="sm" variant="outline" disabled={members.length <= 1} onClick={() => void revokeMember(member.email)}>
                      Fjern
                    </Button>
                  </div>
                ))}
                <div className="flex gap-2">
                  <Input type="email" placeholder="bruger@example.com" value={memberEmail} onChange={(event) => setMemberEmail(event.target.value)} />
                  <Button onClick={() => void shareFarm()} disabled={isSharing}>{isSharing ? '...' : 'Del'}</Button>
                </div>
              </div>
            </DialogContent>
          </Dialog>

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
