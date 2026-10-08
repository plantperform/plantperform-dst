import { useEffect, useMemo, useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'

import {
  Search,
  Tractor,
  Users,
} from 'lucide-react'

import { useAuth } from '@/auth/context'
import { useFarms, useFarmsFields } from '@/api/hooks'
import { AppTopBar } from '@/components/AppTopBar'
import { SproutMark } from '@/components/BrandMark'
import {
  FARM_LIST_CLASS,
  FarmListHeader,
  FarmRow,
  FarmRowSkeleton,
} from '@/components/farm/FarmList'
import { RoleCard } from '@/components/onboarding/RoleCard'
import { Button } from '@/components/ui/button'
import { LoadError } from '@/components/ui/load-error'
import { Spinner } from '@/components/ui/spinner'
import { cn } from '@/lib/utils'
import {
  farmMatchesSearch,
  formatFarmCount,
  sortFarmsByQuotaPressure,
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
  setStoredRole,
  type OnboardingRole,
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
  const [pendingBannerHidden, setPendingBannerHidden] = useState(false)
  const [selectedRole, setSelectedRole] = useState<OnboardingRole | null>(() =>
    email ? getStoredRole(email) : null,
  )
  const [searchText, setSearchText] = useState('')

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
    () => sortFarmsByQuotaPressure(farmList, overviews),
    [farmList, overviews],
  )
  const visibleFarms = sortedFarms.filter((farm) =>
    farmMatchesSearch(farm, searchText),
  )
  const isReady = Boolean(email) && !isLoading && !error && farms !== undefined
  const pending = email ? getPendingFarm(email) : null
  const shouldOpenCreateFarm =
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
    if (shouldOpenCreateFarm && pending) {
      clearPendingFarm(email)
      navigate('/farms/new', { replace: true, state: { prefill: pending } })
      return
    }
    if (shouldOpenSingleFarm && singleFarmId) {
      navigate(`/farms/${singleFarmId}`, { replace: true })
    }
  }, [
    isReady,
    shouldOpenCreateFarm,
    shouldOpenSingleFarm,
    singleFarmId,
    pending,
    email,
    navigate,
  ])

  if (shouldOpenCreateFarm) {
    return (
      <main className="flex min-h-screen flex-col items-center justify-center bg-background p-10">
        <p className="flex items-center gap-2.5 text-lg text-muted-foreground">
          <Spinner className="size-5" />
          Åbner Opret bedrift...
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

      <div className="mx-auto flex max-w-6xl flex-col gap-5.5 px-6 pt-10 pb-16 sm:px-10">
        <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-4">
          <div>
            <h1 className="font-display text-3xl tracking-tight">
              Dine bedrifter
            </h1>
            {farmList.length > 0 ? (
              <p className="mt-1.5 text-[13px] text-muted-foreground">
                {formatFarmCount(farmList.length)}, sorteret efter hvor kvoten
                er under pres. Tal for gennemsnittet af afgrødehistorikken.
              </p>
            ) : null}
          </div>
          {farmList.length > 0 ? (
            <div className="flex flex-wrap items-center gap-2.5">
              <div className="relative w-65 max-w-full">
                <Search
                  className="pointer-events-none absolute top-1/2 left-3 size-3.5 -translate-y-1/2 text-muted-foreground"
                  aria-hidden="true"
                />
                <input
                  type="search"
                  value={searchText}
                  onChange={(event) => setSearchText(event.target.value)}
                  placeholder="Søg bedrift, ejer eller CVR"
                  aria-label="Søg i bedrifter"
                  className="h-9 w-full rounded-md border bg-card pr-3 pl-8.5 text-[13px] outline-none placeholder:text-muted-foreground focus-visible:border-primary focus-visible:ring-[3px] focus-visible:ring-primary/15"
                />
              </div>
              <Button
                asChild
                size="sm"
                className="rounded-full px-3.5 text-[13px]"
              >
                <Link to="/farms/new">Opret bedrift</Link>
              </Button>
            </div>
          ) : null}
        </div>

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

        {isLoading || fieldsLoading ? (
          <div role="status">
            <p className="sr-only">Indlæser bedrifter...</p>
            <div className={FARM_LIST_CLASS} aria-hidden="true">
              <FarmListHeader />
              {Array.from({ length: farmList.length || 3 }, (_, index) => (
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
            <SproutMark className="pointer-events-none absolute -right-16 -bottom-20 -z-10 size-72 text-brand opacity-[0.07]" />
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

        {farmList.length > 0 && !fieldsLoading ? (
          visibleFarms.length > 0 ? (
            <div className={cn(FARM_LIST_CLASS, 'motion-safe:animate-rise-in')}>
              <FarmListHeader />
              <ul className="divide-y">
                {visibleFarms.map((farm) => (
                  <FarmRow
                    key={farm.id}
                    farm={farm}
                    overview={overviews[farm.id]}
                    openedAt={lastOpenedMap[farm.id]}
                  />
                ))}
              </ul>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">
              Ingen bedrifter matcher "{searchText.trim()}".
            </p>
          )
        ) : null}
      </div>
    </main>
  )
}
