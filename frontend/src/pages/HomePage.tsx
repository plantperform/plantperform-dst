import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { mutate } from 'swr'

import {
  ArrowRight,
  CircleAlert,
  LoaderCircle,
  Plus,
  Search,
  Tractor,
  Users,
} from 'lucide-react'

import { useAuth } from '@/auth/context'
import { farmsKey, useFarms } from '@/api/hooks'
import { createFarm } from '@/api/mutations'
import { FarmCardStats } from '@/components/farm/FarmCardStats'
import { RoleCard } from '@/components/onboarding/RoleCard'
import { WorkspaceHeader } from '@/components/WorkspaceHeader'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import {
  clearPendingFarm,
  getAutoOpenSingleFarm,
  getLastOpenedMap,
  getPendingFarm,
  getStoredRole,
  hasVisitedHomeThisSession,
  markHomeVisitedThisSession,
  setPendingFarm,
  setStoredRole,
  type OnboardingRole,
  type PendingFarm,
} from '@/lib/onboarding'

const formatFarmCount = (count: number) =>
  `${count} ${count === 1 ? 'bedrift' : 'bedrifter'}`

export const HomePage = () => {
  const navigate = useNavigate()
  const location = useLocation()
  const { user } = useAuth()
  const { data: farms, error, isLoading } = useFarms()
  const email = user?.email ?? ''
  const showOverview = Boolean(
    (location.state as { showOverview?: boolean } | null)?.showOverview,
  )
  const [pendingState, setPendingState] = useState<
    'idle' | 'creating' | 'failed'
  >('idle')
  const [pendingClaim, setPendingClaim] = useState<PendingFarm | null>(null)
  const [pendingBannerHidden, setPendingBannerHidden] = useState(false)
  const [selectedRole, setSelectedRole] = useState<OnboardingRole | null>(() =>
    email ? getStoredRole(email) : null,
  )
  const [searchText, setSearchText] = useState('')
  const [wasSearchShown, setWasSearchShown] = useState(false)
  const hasStartedCreate = useRef(false)

  const farmList = farms ?? []
  const { lastOpenedMap, sortedFarms } = useMemo(() => {
    const map = email ? getLastOpenedMap(email) : {}
    const sorted = [...(farms ?? [])].sort((left, right) => {
      const leftOpened = map[left.id] ?? 0
      const rightOpened = map[right.id] ?? 0
      if (leftOpened !== rightOpened) return rightOpened - leftOpened
      return left.name.localeCompare(right.name, 'da-DK')
    })
    return { lastOpenedMap: map, sortedFarms: sorted }
  }, [email, farms])
  const latestOpenedFarmId =
    sortedFarms.length > 1 && (lastOpenedMap[sortedFarms[0].id] ?? 0) > 0
      ? sortedFarms[0].id
      : null
  const showSearch = farmList.length > 5
  if (wasSearchShown !== showSearch) {
    setWasSearchShown(showSearch)
    if (!showSearch) setSearchText('')
  }
  const normalizedSearch = searchText.trim().toLowerCase()
  const visibleFarms =
    showSearch && normalizedSearch
      ? sortedFarms.filter((farm) =>
          [farm.name, farm.ownerName, farm.cvr ?? ''].some((value) =>
            value.toLowerCase().includes(normalizedSearch),
          ),
        )
      : sortedFarms
  const isReady = Boolean(email) && !isLoading && !error && farms !== undefined
  const pending = email ? getPendingFarm(email) : null
  const shouldCreatePendingFarm =
    isReady && farmList.length === 0 && pending !== null
  const singleFarmId = isReady && farmList.length === 1 ? farmList[0].id : null
  const autoOpenSingleFarm = email ? getAutoOpenSingleFarm(email) : true
  const hasVisitedHome = email ? hasVisitedHomeThisSession(email) : false
  const shouldOpenSingleFarm =
    singleFarmId !== null &&
    !showOverview &&
    autoOpenSingleFarm &&
    !hasVisitedHome

  useEffect(() => {
    if (!isReady) return
    markHomeVisitedThisSession(email)
    if (shouldCreatePendingFarm && pending) {
      if (hasStartedCreate.current) return
      hasStartedCreate.current = true
      clearPendingFarm(email)
      setPendingClaim(pending)
      setPendingState('creating')
      const run = async () => {
        try {
          const farm = await createFarm({
            name: pending.name,
            ownerName: pending.ownerName,
            cvr: pending.cvr,
          })
          await mutate(farmsKey)
          navigate(`/farms/${farm.id}`, { replace: true })
        } catch {
          setPendingFarm(email, pending)
          setPendingState('failed')
        }
      }
      void run()
      return
    }
    if (shouldOpenSingleFarm && singleFarmId) {
      navigate(`/farms/${singleFarmId}`, { replace: true })
    }
  }, [
    isReady,
    shouldCreatePendingFarm,
    shouldOpenSingleFarm,
    singleFarmId,
    pending,
    email,
    navigate,
  ])

  if (pendingState === 'failed') {
    return (
      <main className="flex min-h-screen items-center justify-center bg-background px-6 py-10 sm:px-10">
        <div className="w-full max-w-md">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <CircleAlert
                  className="h-5 w-5 text-red-700"
                  aria-hidden="true"
                />
                Bedriften kunne ikke oprettes
              </CardTitle>
              <CardDescription>
                Vi kunne ikke oprette bedriften fra din registrering. Du kan
                oprette den manuelt i stedet.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Button asChild>
                <Link
                  to="/farms/new"
                  state={{ prefill: pendingClaim }}
                  onClick={() => clearPendingFarm(email)}
                >
                  Opret bedrift
                </Link>
              </Button>
            </CardContent>
          </Card>
        </div>
      </main>
    )
  }

  if (pendingState === 'creating' || shouldCreatePendingFarm) {
    return (
      <main className="flex min-h-screen flex-col items-center justify-center bg-background p-10">
        <p className="flex items-center gap-2.5 text-lg text-muted-foreground">
          <LoaderCircle
            className="h-5 w-5 motion-safe:animate-spin"
            aria-hidden="true"
          />
          Opretter din bedrift...
        </p>
      </main>
    )
  }

  if (shouldOpenSingleFarm) {
    return (
      <main className="flex min-h-screen flex-col items-center justify-center bg-background p-10">
        <p className="flex items-center gap-2.5 text-lg text-muted-foreground">
          <LoaderCircle
            className="h-5 w-5 motion-safe:animate-spin"
            aria-hidden="true"
          />
          Åbner din bedrift...
        </p>
      </main>
    )
  }

  return (
    <main className="min-h-screen bg-background">
      <WorkspaceHeader
        title="Dine bedrifter"
        description={
          farmList.length > 0
            ? `${formatFarmCount(farmList.length)} - vælg en for at arbejde videre med marker og sædskifte.`
            : 'Vælg en bedrift for at arbejde videre med marker og sædskifte.'
        }
        actions={
          <Button
            asChild
            className="shrink-0 bg-primary-foreground text-primary hover:bg-primary-foreground/90 focus-visible:ring-primary-foreground/60"
          >
            <Link to="/farms/new">
              <Plus className="h-4 w-4" aria-hidden="true" />
              Opret ny bedrift
            </Link>
          </Button>
        }
      />

      <div className="mx-auto max-w-6xl space-y-6 px-6 pb-12 pt-10 sm:px-10">
        {pending && farmList.length > 0 && !pendingBannerHidden ? (
          <div className="flex flex-col gap-3 rounded-xl border border-amber-200 bg-amber-50 p-4 text-amber-900 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-sm">
              Ved oprettelsen angav du bedriften "{pending.name}". Vil du
              oprette den nu?
            </p>
            <div className="flex shrink-0 gap-2">
              <Button asChild size="sm">
                <Link
                  to="/farms/new"
                  state={{ prefill: pending }}
                  onClick={() => clearPendingFarm(email)}
                >
                  Opret bedriften
                </Link>
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  clearPendingFarm(email)
                  setPendingBannerHidden(true)
                }}
              >
                Fjern
              </Button>
            </div>
          </div>
        ) : null}

        {isLoading ? (
          <div role="status">
            <p className="sr-only">Indlæser bedrifter...</p>
            <div
              className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3"
              aria-hidden="true"
            >
              {[0, 1, 2].map((index) => (
                <div
                  key={index}
                  className="space-y-3 rounded-xl border bg-card p-5 shadow-sm"
                >
                  <div className="h-5 w-2/3 motion-safe:animate-pulse rounded bg-muted" />
                  <div className="h-4 w-1/2 motion-safe:animate-pulse rounded bg-muted" />
                  <div className="h-4 w-1/3 motion-safe:animate-pulse rounded bg-muted" />
                </div>
              ))}
            </div>
          </div>
        ) : null}

        {error ? (
          <div className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">
            <CircleAlert
              className="mt-0.5 h-4 w-4 shrink-0"
              aria-hidden="true"
            />
            <p>Kunne ikke indlæse bedrifter. Prøv at genindlæse siden.</p>
          </div>
        ) : null}

        {!isLoading && !error && farmList.length === 0 ? (
          <div className="rounded-xl border bg-card p-6 shadow-sm sm:p-8">
            <p id="kom-i-gang-heading" className="text-lg font-semibold">
              Kom i gang
            </p>
            {!selectedRole ? (
              <>
                <p className="mt-2 text-sm text-muted-foreground">
                  Fortæl os, hvordan du bruger værktøjet, så tilpasser vi
                  visningen. Valget gemmes og kan ikke ændres bagefter.
                </p>
                <div
                  className="mt-5 grid gap-3 sm:grid-cols-2"
                  role="group"
                  aria-labelledby="kom-i-gang-heading"
                >
                  <RoleCard
                    selected={false}
                    title="Jeg er landmand"
                    description="Jeg driver en bedrift og vil i gang med min egen planlægning."
                    icon={Tractor}
                    onSelect={() => {
                      setStoredRole(email, 'landmand')
                      setSelectedRole('landmand')
                    }}
                  />
                  <RoleCard
                    selected={false}
                    title="Jeg er konsulent"
                    description="Jeg rådgiver flere landmænd og skal bruge oversigten."
                    icon={Users}
                    onSelect={() => {
                      setStoredRole(email, 'konsulent')
                      setSelectedRole('konsulent')
                    }}
                  />
                </div>
              </>
            ) : null}
            {selectedRole ? (
              <div
                key={selectedRole}
                className="mt-5 motion-safe:animate-[rise-in_280ms_ease-out]"
              >
                <p className="text-sm text-muted-foreground">
                  {selectedRole === 'landmand'
                    ? 'Opret din bedrift for at komme i gang - fremover lander du direkte i den, når du logger ind.'
                    : 'Opret en bedrift pr. landmand, du hjælper. Du kan altid vende tilbage til denne oversigt.'}
                </p>
                <Button asChild className="mt-4">
                  <Link to="/farms/new">
                    {selectedRole === 'landmand'
                      ? 'Opret din bedrift'
                      : 'Opret bedrift'}
                  </Link>
                </Button>
              </div>
            ) : null}
          </div>
        ) : null}

        {farmList.length > 0 ? (
          <>
            {showSearch ? (
              <div className="relative">
                <Search
                  className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
                  aria-hidden="true"
                />
                <Input
                  type="search"
                  value={searchText}
                  onChange={(event) => setSearchText(event.target.value)}
                  placeholder="Søg efter navn, ejer eller CVR"
                  aria-label="Søg i bedrifter"
                  className="pl-9"
                />
              </div>
            ) : null}
            {visibleFarms.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                Ingen bedrifter matcher søgningen.
              </p>
            ) : (
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {visibleFarms.map((farm) => (
                  <Link
                    key={farm.id}
                    to={`/farms/${farm.id}`}
                    className="group flex flex-col gap-4 rounded-xl border bg-card p-6 shadow-sm transition-colors hover:border-primary/40 hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="truncate font-display text-xl">
                          {farm.name}
                        </p>
                        <p className="mt-0.5 truncate text-sm text-muted-foreground">
                          {farm.ownerName}
                        </p>
                      </div>
                      <ArrowRight
                        className="mt-1 h-4 w-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5 group-hover:text-foreground"
                        aria-hidden="true"
                      />
                    </div>
                    {farm.id === latestOpenedFarmId ? (
                      <span className="w-fit rounded-full border bg-muted/60 px-2.5 py-0.5 text-xs text-muted-foreground">
                        Senest åbnet
                      </span>
                    ) : null}
                    <FarmCardStats farm={farm} />
                    {farm.cvr ? (
                      <div className="mt-auto flex flex-wrap items-center gap-2">
                        <span className="rounded-full border bg-muted/60 px-2.5 py-0.5 text-xs text-muted-foreground">
                          CVR {farm.cvr}
                        </span>
                      </div>
                    ) : null}
                  </Link>
                ))}
              </div>
            )}
          </>
        ) : null}
      </div>
    </main>
  )
}
