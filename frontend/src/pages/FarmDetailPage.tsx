import { useEffect, useRef, useState } from 'react'
import { Link, useParams } from 'react-router-dom'

import {
  useFarm,
  useFarmFields,
  useSimulationFields,
  useSimulations,
} from '@/api/hooks'
import { FarmInspector } from '@/components/farm/FarmInspector'
import { FarmSidebar } from '@/components/farm/FarmSidebar'
import type { FarmViewSelection } from '@/components/farm/types'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'

export const FarmDetailPage = () => {
  const { farmId } = useParams()
  const {
    data: farm,
    error: farmError,
    isLoading: farmLoading,
  } = useFarm(farmId)
  const { data: fields = [], isLoading: fieldsLoading } = useFarmFields(farmId)
  const { data: simulationsData, isLoading: simulationsLoading } =
    useSimulations(farmId)
  const simulations = simulationsData ?? []
  const [selection, setSelection] = useState<FarmViewSelection>({
    kind: 'current',
  })
  const activeSelection =
    selection.kind === 'simulation' &&
    simulationsData &&
    !simulations.some((simulation) => simulation.id === selection.id)
      ? ({ kind: 'current' } as const)
      : selection
  const selectedSimulationId =
    activeSelection.kind === 'simulation' ? activeSelection.id : undefined
  const { data: simulationFields = [], isLoading: simulationFieldsLoading } =
    useSimulationFields(farmId, selectedSimulationId)
  const [toast, setToast] = useState<{ id: number; message: string } | null>(
    null,
  )
  const toastTimeoutRef = useRef<number | null>(null)

  useEffect(
    () => () => {
      if (toastTimeoutRef.current !== null) {
        window.clearTimeout(toastTimeoutRef.current)
      }
    },
    [],
  )

  const showErrorToast = (message: string | null) => {
    if (toastTimeoutRef.current !== null) {
      window.clearTimeout(toastTimeoutRef.current)
    }

    if (!message) {
      setToast(null)
      return
    }

    const toastId = Date.now()
    setToast({ id: toastId, message })
    toastTimeoutRef.current = window.setTimeout(() => {
      setToast((current) => (current?.id === toastId ? null : current))
      toastTimeoutRef.current = null
    }, 4000)
  }

  if (farmError) {
    return (
      <main className="min-h-screen bg-background px-6 py-10 sm:px-10">
        <div className="mx-auto max-w-3xl">
          <Card>
            <CardHeader>
              <CardTitle>Bedriften blev ikke fundet</CardTitle>
              <CardDescription>Den valgte bedrift findes ikke.</CardDescription>
            </CardHeader>
            <CardContent>
              <Button asChild>
                <Link to="/">Tilbage til bedrifter</Link>
              </Button>
            </CardContent>
          </Card>
        </div>
      </main>
    )
  }

  if (
    farmLoading ||
    !farm ||
    fieldsLoading ||
    simulationsLoading ||
    simulationFieldsLoading
  ) {
    return (
      <main className="min-h-screen bg-background px-6 py-10 sm:px-10">
        <div className="mx-auto max-w-3xl">
          <Card>
            <CardHeader>
              <CardTitle>Indlæser bedrift</CardTitle>
              <CardDescription>
                Indlæser bedriftens oplysninger, marker og simuleringer.
              </CardDescription>
            </CardHeader>
          </Card>
        </div>
      </main>
    )
  }

  return (
    <main className="min-h-screen bg-background">
      <div className="grid min-h-screen lg:grid-cols-[320px_1fr]">
        <FarmSidebar
          farm={farm}
          fields={fields}
          activeSimulationFields={
            activeSelection.kind === 'simulation' ? simulationFields : undefined
          }
          simulations={simulations}
          selection={activeSelection}
          onSelectionChange={setSelection}
          onError={showErrorToast}
        />
        <div>
          {toast ? (
            <div className="fixed right-4 top-4 z-50 max-w-sm rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 shadow-lg">
              <p role="alert">{toast.message}</p>
            </div>
          ) : null}
          <FarmInspector
            farm={farm}
            fields={
              activeSelection.kind === 'current' ? fields : simulationFields
            }
            selection={activeSelection}
            selectedSimulation={
              activeSelection.kind === 'simulation'
                ? simulations.find(
                    (simulation) => simulation.id === activeSelection.id,
                  )
                : undefined
            }
            onError={showErrorToast}
          />
        </div>
      </div>
    </main>
  )
}
