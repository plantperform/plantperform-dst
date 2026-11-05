import { useRef, useState } from 'react'

import { ApiError } from '@/api/client'
import { copyFarm, useFarmCopyPreview } from '@/api/farm-copy'
import type { Farm, FarmCopyLookup } from '@/api/types'
import { CreateStatus, StepHeading } from '@/components/farm/RegistryLookup'
import { Button } from '@/components/ui/button'
import { LoadError } from '@/components/ui/load-error'
import { Spinner } from '@/components/ui/spinner'
import { formatCvr } from '@/lib/farm-form'
import { formatFieldCount, formatHectares } from '@/lib/field-domain'

export const FarmCopyConfirmation = ({
  input,
  creating,
  onCreating,
  onCreated,
}: {
  input: FarmCopyLookup
  creating: boolean
  onCreating: (creating: boolean) => void
  onCreated: (farm: Farm) => Promise<void>
}) => {
  const preview = useFarmCopyPreview(input)
  const [requestId] = useState(() => crypto.randomUUID())
  const [error, setError] = useState<string | null>(null)
  const inFlight = useRef(false)

  if (preview.error) {
    return (
      <>
        <StepHeading title="Bedriften kunne ikke findes">
          Gå tilbage for at rette bedriftens navn eller ejer, eller prøv igen.
        </StepHeading>
        <LoadError
          message={
            preview.error instanceof Error
              ? preview.error.message
              : 'Opslaget mislykkedes.'
          }
          onRetry={() => void preview.mutate()}
          retrying={preview.isValidating}
        />
      </>
    )
  }
  if (!preview.data) {
    return (
      <>
        <StepHeading title="Finder bedriften">
          Vi søger efter bedriftens navn og ejer.
        </StepHeading>
        <p role="status" className="flex items-center gap-2 text-sm">
          <Spinner /> Søger efter bedriften…
        </p>
      </>
    )
  }

  const {
    sourceFarm,
    fieldCount,
    areaHa,
    simulationCount,
    savedResultCount,
    hasUnfinishedCalculations,
  } = preview.data
  const create = async () => {
    if (inFlight.current) return
    inFlight.current = true
    onCreating(true)
    setError(null)
    try {
      const farm = await copyFarm({
        ...input,
        sourceFarmId: sourceFarm.id,
        requestId,
      })
      await onCreated(farm)
    } catch (error) {
      setError(
        error instanceof ApiError
          ? error.message
          : 'Kunne ikke kopiere bedriften. Prøv igen.',
      )
      onCreating(false)
    } finally {
      inFlight.current = false
    }
  }
  const details = [
    ['Bedriftens navn', sourceFarm.name],
    ['Ejer', sourceFarm.ownerName],
    ['CVR-nummer', sourceFarm.cvr ? formatCvr(sourceFarm.cvr) : 'Intet CVR'],
    ['Marker', formatFieldCount(fieldCount)],
    ['Areal', `${formatHectares(areaHa)} ha`],
    ['Simuleringer', String(simulationCount)],
    ['Gemte resultater', String(savedResultCount)],
  ]

  return (
    <>
      <StepHeading title={`Opret en kopi af ${sourceFarm.name}`}>
        Du får din egen kopi med bedriftens marker, simuleringer, indstillinger
        og gemte resultater. Kun du har adgang til kopien.
      </StepHeading>
      <div className="grid gap-5 rounded-xl border bg-card p-6">
        <dl className="grid gap-3 text-sm">
          {details.map(([label, value]) => (
            <div key={label} className="grid grid-cols-2 gap-4">
              <dt className="text-muted-foreground">{label}</dt>
              <dd className="break-words font-medium">{value}</dd>
            </div>
          ))}
        </dl>
        {hasUnfinishedCalculations && (
          <p className="text-sm text-muted-foreground">
            Nogle beregninger er ikke færdige. Kopien indeholder de data og
            resultater, der allerede er gemt. Du kan starte beregningerne igen i
            din kopi.
          </p>
        )}
        <Button
          className="h-auto min-h-10 rounded-full whitespace-normal"
          disabled={creating}
          onClick={() => void create()}
        >
          Opret kopi af {sourceFarm.name}
        </Button>
        <CreateStatus creating={creating} error={error} />
      </div>
    </>
  )
}
