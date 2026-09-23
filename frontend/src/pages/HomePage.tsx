import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { mutate } from 'swr'

import {
  CircleAlert,
  Plus,
  Search,
  Tractor,
  Users,
} from 'lucide-react'

import { useAuth } from '@/auth/context'
import { farmsKey, useFarms, useFarmsFields } from '@/api/hooks'
import { createFarm } from '@/api/mutations'
import { AppTopBar } from '@/components/AppTopBar'
import { IcoelMark } from '@/components/BrandMark'
import {
  FARM_LIST_CLASS,
  FarmRow,
  FarmRowSkeleton,
} from '@/components/farm/FarmList'
import { FarmOverviewHeader } from '@/components/farm/FarmOverviewHeader'
import { RoleCard } from '@/components/onboarding/RoleCard'
import { Button } from '@/components/ui/button'
import { LoadError } from '@/components/ui/load-error'
import { Spinner } from '@/components/ui/spinner'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { cn } from '@/lib/utils'
import {
  latestOpenedFarm,
  sortFarms,
  summarizeFarmFields,
  type FarmOverview,
} from '@/lib/farm-overview'
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

export const HomePage = () => {
  const navigate = useNavigate()
  const location = useLocation()
  const { user } = useAuth()
  const {
    data: farms,
    error,
    isLoading,
    isValidating: farmsValidating,
    mutate: retryFarms,
  } = useFarms()
  const { data: fieldsByFarm, isLoading: fieldsLoading } = useFarmsFields(farms)
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
  const hasStartedCreate = useRef(false)

  const farmList = useMemo(() => farms ?? [], [farms])
  const lastOpenedMap = useMemo(
    () => (email ? getLastOpenedMap(email) : {}),
    [email],
  )
  const overviews = useMemo(
    () =>
      Object.fromEntries(
        farmList.map((farm) => [
          farm.id,
          summarizeFarmFields(fieldsByFarm?.[farm.id]),
        ]),
      ) as Record<string, FarmOverview>,
    [farmList, fieldsByFarm],
  )
  const sortedFarms = useMemo(
    () => sortFarms(farmList, lastOpenedMap),
    [farmList, lastOpenedMap],
  )
  const latestFarm = latestOpenedFarm(farmList, lastOpenedMap)
  const normalizedSearch = searchText.trim().toLowerCase()
  const visibleFarms = normalizedSearch
    ? sortedFarms.filter((farm) =>
        [farm.name, farm.ownerName, farm.cvr ?? ''].some((value) =>
          value.toLowerCase().includes(normalizedSearch),
        ),
      )
    : sortedFarms
  const totals = farmList.reduce(
    (sum, farm) => {
      const overview = overviews[farm.id]
      return {
        fieldCount: sum.fieldCount + (overview.totals?.fieldCount ?? 0),
        areaHa: sum.areaHa + (overview.totals?.areaHa ?? 0),
        overQuota: sum.overQuota + (overview.level === 'over' ? 1 : 0),
      }
    },
    { fieldCount: 0, areaHa: 0, overQuota: 0 },
  )
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
                  className="h-5 w-5 text-destructive"
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
          <Spinner className="size-5" />
          Opretter din bedrift...
        </p>
      </main>
    )
  }

  if (shouldOpenSingleFarm) {
    return (
      <main className="flex min-h-screen flex-col items-center justify-center bg-background p-10">
        <p className="flex items-center gap-2.5 text-lg text-muted-foreground">
          <Spinner className="size-5" />
          Åbner din bedrift...
        </p>
      </main>
    )
  }

  return (
    <main className="min-h-screen bg-background">
      <AppTopBar />

      <div className="mx-auto flex max-w-6xl flex-col gap-10 px-6 pt-12 pb-16 sm:px-10">
        <FarmOverviewHeader
          farmCount={farmList.length}
          fieldCount={totals.fieldCount}
          areaHa={totals.areaHa}
          overQuota={totals.overQuota}
          loading={isLoading || fieldsLoading}
        />

        {pending && farmList.length > 0 && !pendingBannerHidden ? (
          <div className="flex flex-col gap-3 rounded-lg border border-primary/20 bg-primary/5 p-4 text-foreground sm:flex-row sm:items-center sm:justify-between">
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
            <div className={FARM_LIST_CLASS} aria-hidden="true">
              {[0, 1, 2].map((index) => (
                <FarmRowSkeleton key={index} />
              ))}
            </div>
          </div>
        ) : null}

        {error ? (
          <LoadError
            message="Kunne ikke indlæse bedrifter."
            onRetry={() => void retryFarms()}
            retrying={farmsValidating}
          />
        ) : null}

        {!isLoading && !error && farmList.length === 0 ? (
          <div className="relative isolate overflow-hidden rounded-2xl border bg-card p-6 shadow-xs sm:p-8">
            <IcoelMark className="pointer-events-none absolute -right-16 -bottom-20 -z-10 size-72 text-brand opacity-[0.07]" />
            <p id="get-started-heading" className="text-lg font-semibold">
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
                  aria-labelledby="get-started-heading"
                >
                  <RoleCard
                    selected={false}
                    title="Jeg er landmand"
                    description="Jeg driver en bedrift og vil i gang med min egen planlægning."
                    icon={Tractor}
                    onSelect={() => {
                      setStoredRole(email, 'farmer')
                      setSelectedRole('farmer')
                    }}
                  />
                  <RoleCard
                    selected={false}
                    title="Jeg er konsulent"
                    description="Jeg rådgiver flere landmænd og skal bruge oversigten."
                    icon={Users}
                    onSelect={() => {
                      setStoredRole(email, 'advisor')
                      setSelectedRole('advisor')
                    }}
                  />
                </div>
              </>
            ) : null}
            {selectedRole ? (
              <div
                key={selectedRole}
                className="mt-5 motion-safe:animate-rise-in"
              >
                <p className="text-sm text-muted-foreground">
                  {selectedRole === 'farmer'
                    ? 'Opret din bedrift for at komme i gang - fremover lander du direkte i den, når du logger ind.'
                    : 'Opret en bedrift pr. landmand, du hjælper. Du kan altid vende tilbage til denne oversigt.'}
                </p>
                <Button asChild className="mt-4 rounded-full">
                  <Link to="/farms/new">
                    {selectedRole === 'farmer'
                      ? 'Opret din bedrift'
                      : 'Opret bedrift'}
                  </Link>
                </Button>
              </div>
            ) : null}
          </div>
        ) : null}

        {farmList.length > 0 ? (
          <section className="flex flex-col gap-5">
            <div className="flex flex-wrap items-center justify-end gap-3">
              <Button
                asChild
                variant="outline"
                className="h-[38px] rounded-full"
              >
                <Link to="/farms/new">
                  <Plus className="size-4" aria-hidden="true" />
                  Opret bedrift
                </Link>
              </Button>
              <div className="relative w-72 max-w-full">
                <Search
                  className="pointer-events-none absolute top-1/2 left-3.5 size-4 -translate-y-1/2 text-muted-foreground"
                  aria-hidden="true"
                />
                <input
                  type="search"
                  value={searchText}
                  onChange={(event) => setSearchText(event.target.value)}
                  placeholder="Søg navn, ejer eller CVR"
                  aria-label="Søg i bedrifter"
                  className="h-[38px] w-full rounded-full border bg-card pr-3.5 pl-9 text-sm outline-none placeholder:text-muted-foreground focus-visible:border-primary focus-visible:ring-[3px] focus-visible:ring-primary/15"
                />
              </div>
            </div>
            {visibleFarms.length > 0 ? (
              <ul
                className={cn(FARM_LIST_CLASS, 'motion-safe:animate-rise-in')}
              >
                {visibleFarms.map((farm) => (
                  <FarmRow
                    key={farm.id}
                    farm={farm}
                    overview={overviews[farm.id]}
                    latest={farm.id === latestFarm?.id}
                  />
                ))}
              </ul>
            ) : (
              <p className="text-sm text-muted-foreground">
                Ingen bedrifter matcher "{searchText.trim()}".
              </p>
            )}
          </section>
        ) : null}
      </div>
    </main>
  )
}
