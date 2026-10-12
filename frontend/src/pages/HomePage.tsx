import { useEffect, useMemo, useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'

import { Tractor, Users } from 'lucide-react'

import { useAuth } from '@/auth/context'
import { useFarms, useFarmsFields } from '@/api/hooks'
import { AppBar } from '@/components/AppBar'
import { FarmSearchInput } from '@/components/farm/FarmSearchInput'
import {
  FARM_LIST_CLASS,
  FarmListHeader,
  FarmRow,
  FarmRowSkeleton,
} from '@/components/farm/FarmList'
import { RoleCard } from '@/components/onboarding/RoleCard'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
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
  getLastOpenedMap,
  getPendingFarm,
  getStoredRole,
  hasVisitedHomeThisSession,
  markHomeVisitedThisSession,
  opensSingleFarmDirectly,
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
  const isEmpty = !isLoading && !error && farmList.length === 0
  const pending = email ? getPendingFarm(email) : null
  const hasVisitedHome = email ? hasVisitedHomeThisSession(email) : false
  const shouldOpenCreateFarm =
    isReady &&
    farmList.length === 0 &&
    (pending !== null ||
      (selectedRole === 'farmer' && !showOverview && !hasVisitedHome))
  const singleFarmId = isReady && farmList.length === 1 ? farmList[0].id : null
  const shouldOpenSingleFarm =
    singleFarmId !== null &&
    !showOverview &&
    opensSingleFarmDirectly(selectedRole) &&
    !hasVisitedHome

  useEffect(() => {
    if (!isReady) return
    markHomeVisitedThisSession(email)
    if (shouldOpenCreateFarm) {
      if (pending) clearPendingFarm(email)
      navigate('/farms/new', {
        replace: true,
        state: pending ? { prefill: pending } : null,
      })
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
      <AppBar />

      <div className="mx-auto flex max-w-6xl flex-col gap-5.5 px-6 pt-10 pb-16 sm:px-10">
        {isEmpty ? null : (
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
                <FarmSearchInput
                  className="w-65 max-w-full"
                  value={searchText}
                  onChange={setSearchText}
                />
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
        )}

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

        {isEmpty ? (
          <Card className="mx-auto mt-8 w-full max-w-[560px] px-6 py-11 text-center sm:px-10">
            <h1
              id="welcome-heading"
              className="font-display text-3xl tracking-tight"
            >
              Velkommen
            </h1>
            {selectedRole ? (
              <div key={selectedRole} className="motion-safe:animate-rise-in">
                <p className="mx-auto mt-3 max-w-[420px] text-[15px] leading-normal text-muted-foreground">
                  {selectedRole === 'farmer'
                    ? 'Opret din bedrift. Du skal kun bruge CVR-nummeret, så henter vi markerne fra markregistret.'
                    : 'Opret den første bedrift for en kunde. Når en landmand deler sin bedrift med dig, dukker den op her.'}
                </p>
                <Button asChild size="lg" className="mt-6">
                  <Link to="/farms/new">Opret bedrift</Link>
                </Button>
              </div>
            ) : (
              <>
                <p className="mx-auto mt-3 max-w-[420px] text-[15px] leading-normal text-muted-foreground">
                  Fortæl os, hvordan du bruger værktøjet, så viser vi dig det
                  rigtige først.
                </p>
                <div
                  className="mt-6 grid gap-3 text-left sm:grid-cols-2"
                  role="group"
                  aria-labelledby="welcome-heading"
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
            )}
          </Card>
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
