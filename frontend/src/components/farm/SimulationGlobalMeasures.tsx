import { useState } from 'react'
import { mutate } from 'swr'

import { simulationFieldsKey } from '@/api/hooks'
import { updateSimulationField } from '@/api/mutations'
import type { FieldMeasures, FieldRecord } from '@/api/types'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import {
  cropAllowsCoverCrop,
  cropAllowsEarlySowing,
  measureLabels,
} from '@/lib/field-domain'

type SimulationGlobalMeasuresProps = {
  farmId: string
  simulationId: string
  fields: FieldRecord[]
  onError: (message: string | null) => void
}

export const SimulationGlobalMeasures = ({
  farmId,
  simulationId,
  fields,
  onError,
}: SimulationGlobalMeasuresProps) => {
  const [precisionFarming, setPrecisionFarming] = useState(false)
  const [coverCrop, setCoverCrop] = useState(false)
  const [earlySowing, setEarlySowing] = useState(false)
  const [isApplying, setIsApplying] = useState(false)
  const [statusMessage, setStatusMessage] = useState<string | null>(null)
  const [isExpanded, setIsExpanded] = useState(false)

  const buildMeasures = (field: FieldRecord): FieldMeasures => ({
    precisionFarming,
    coverCropYears: coverCrop
      ? field.cropRotation
          .map((_, index) => index)
          .filter((index) => cropAllowsCoverCrop(field.cropRotation, index))
      : [],
    earlySowingYears: earlySowing
      ? field.cropRotation
          .map((crop, index) => ({ crop, index }))
          .filter(({ crop }) => cropAllowsEarlySowing(crop))
          .map(({ index }) => index)
      : [],
  })

  const applyToAll = async () => {
    if (fields.length === 0) return

    setIsApplying(true)
    setStatusMessage(null)
    try {
      await Promise.all(
        fields.map((field) =>
          updateSimulationField(farmId, simulationId, field.id, {
            measures: buildMeasures(field),
          }),
        ),
      )
      await mutate(simulationFieldsKey(farmId, simulationId))
      onError(null)
      setStatusMessage(
        `Opdaterede virkemidler for ${fields.length} ${fields.length === 1 ? 'mark' : 'marker'}.`,
      )
    } catch {
      onError('Kunne ikke opdatere virkemidler for alle marker.')
    } finally {
      setIsApplying(false)
    }
  }

  return (
    <Card>
      <button
        type="button"
        onClick={() => setIsExpanded((current) => !current)}
        className="w-full text-left"
        aria-expanded={isExpanded}
      >
        <CardHeader className="flex flex-row items-start justify-between gap-3 space-y-0">
          <div className="space-y-1">
            <CardTitle>Virkemidler for alle marker</CardTitle>
            <p className="text-xs text-muted-foreground">
              Anvend standardvalg på alle marker i simuleringen
            </p>
          </div>
          <span
            aria-hidden="true"
            className="mt-1 text-sm text-muted-foreground"
          >
            {isExpanded ? '▾' : '▸'}
          </span>
        </CardHeader>
      </button>
      {isExpanded ? (
        <CardContent className="space-y-4">
          <CardDescription>
            Vælg virkemidler for alle marker. Efterafgrøder og tidlig såning
            anvendes kun på de år, hvor reglerne tillader det. Du kan stadig
            rette enkelte marker bagefter.
          </CardDescription>
          <div className="grid gap-2 sm:grid-cols-3">
            <label className="flex items-start gap-3 rounded-md border bg-background p-3">
              <input
                type="checkbox"
                className="mt-1"
                checked={precisionFarming}
                onChange={(event) => setPrecisionFarming(event.target.checked)}
                disabled={isApplying}
              />
              <span className="text-sm font-medium">
                {measureLabels.PRECISION_FARMING}
              </span>
            </label>
            <label className="flex items-start gap-3 rounded-md border bg-background p-3">
              <input
                type="checkbox"
                className="mt-1"
                checked={coverCrop}
                onChange={(event) => setCoverCrop(event.target.checked)}
                disabled={isApplying}
              />
              <span className="text-sm font-medium">
                {measureLabels.COVER_CROP}
              </span>
            </label>
            <label className="flex items-start gap-3 rounded-md border bg-background p-3">
              <input
                type="checkbox"
                className="mt-1"
                checked={earlySowing}
                onChange={(event) => setEarlySowing(event.target.checked)}
                disabled={isApplying}
              />
              <span className="text-sm font-medium">
                {measureLabels.EARLY_SOWING}
              </span>
            </label>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <Button
              onClick={() => void applyToAll()}
              disabled={isApplying || fields.length === 0}
            >
              {isApplying ? 'Opdaterer...' : 'Anvend på alle marker'}
            </Button>
            {statusMessage ? (
              <p className="text-sm text-muted-foreground">{statusMessage}</p>
            ) : null}
          </div>
        </CardContent>
      ) : null}
    </Card>
  )
}
