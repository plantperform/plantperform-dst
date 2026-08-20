import { ChevronLeft, ChevronRight } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { mutate } from 'swr'

import {
  simulationFieldCandidateDetailKey,
  simulationFieldsKey,
  simulationYearlySummaryKey,
  useAfgrodeKoder,
  useRotationCandidateOptions,
  useRotationKategorier,
  useSimulationFieldCandidateDetail,
} from '@/api/hooks'
import { applyFieldRotation, previewFieldRotation } from '@/api/mutations'
import type {
  FieldRecord,
  RotationCandidateEvaluation,
  RotationCandidateRef,
  RotationPositionOverride,
  Simulation,
} from '@/api/types'
import { RotationYearsDetail } from '@/components/farm/RotationYearsDetail'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { ROTATION_START_CALENDAR_YEAR } from '@/lib/field-domain'

type ManualRotationEditorProps = {
  farmId: string
  simulationId: string
  field: FieldRecord
  simulation: Simulation
  open: boolean
  onOpenChange: (open: boolean) => void
  onError: (message: string | null) => void
}

const fmt = (value: number, digits = 1) =>
  new Intl.NumberFormat('da-DK', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(value)

const refsEqual = (a: RotationCandidateRef, b: RotationCandidateRef) =>
  a.saedskiftevariant === b.saedskiftevariant &&
  a.variant === b.variant &&
  a.nNormPct === b.nNormPct

export const ManualRotationEditor = ({
  farmId,
  simulationId,
  field,
  simulation,
  open,
  onOpenChange,
  onError,
}: ManualRotationEditorProps) => {
  const { data: current } = useSimulationFieldCandidateDetail(
    farmId,
    simulationId,
    field.id,
  )
  const { data: kategorier = [] } = useRotationKategorier(farmId)
  const { data: allRefs = [] } = useRotationCandidateOptions(farmId)
  const { data: afgrodeKoder = [] } = useAfgrodeKoder(farmId)

  const [baseRef, setBaseRef] = useState<RotationCandidateRef | null>(null)
  const [overrides, setOverrides] = useState<RotationPositionOverride[]>([])
  const [startYear, setStartYear] = useState(1)
  const [preview, setPreview] = useState<RotationCandidateEvaluation | null>(null)
  const [previewError, setPreviewError] = useState<string | null>(null)
  const [isPreviewing, setIsPreviewing] = useState(false)
  const [isSaving, setIsSaving] = useState(false)
  const requestId = useRef(0)

  useEffect(() => {
    // Seed local draft state from the field's currently saved candidate
    // once the dialog opens and the SWR fetch resolves — synchronizing
    // React's editable draft with external server state, not derivable
    // during render since `current` arrives asynchronously.
    if (!open || !current) return
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setBaseRef(current.baseRef ?? current.ref)
    setOverrides(current.overrides ?? [])
    setStartYear(current.startYear ?? 1)
  }, [open, current])

  const availableKategorier = useMemo(
    () => kategorier.filter((k) => simulation.rotationKategorier.includes(k.kategori)),
    [kategorier, simulation.rotationKategorier],
  )

  const selectedKategori = useMemo(() => {
    if (!baseRef) return availableKategorier[0]
    return (
      availableKategorier.find((k) =>
        k.saedskifter.some((s) => s.saedskiftevariant === baseRef.saedskiftevariant),
      ) ?? availableKategorier[0]
    )
  }, [availableKategorier, baseRef])

  const variantsForSaedskifte = useMemo(() => {
    if (!baseRef) return []
    return Array.from(
      new Set(
        allRefs
          .filter((r) => r.ref.saedskiftevariant === baseRef.saedskiftevariant)
          .map((r) => r.ref.variant),
      ),
    )
  }, [allRefs, baseRef])

  const nNormsForVariant = useMemo(() => {
    if (!baseRef) return []
    return Array.from(
      new Set(
        allRefs
          .filter(
            (r) =>
              r.ref.saedskiftevariant === baseRef.saedskiftevariant &&
              r.ref.variant === baseRef.variant,
          )
          .map((r) => r.ref.nNormPct),
      ),
    ).filter((n) => simulation.rotationNNormProcenter.includes(n))
  }, [allRefs, baseRef, simulation.rotationNNormProcenter])

  const runPreview = (
    ref: RotationCandidateRef,
    overrideList: RotationPositionOverride[],
    year: number,
  ) => {
    const id = ++requestId.current
    setIsPreviewing(true)
    setPreviewError(null)
    previewFieldRotation(farmId, simulationId, field.id, {
      baseRef: ref,
      overrides: overrideList,
      startYear: year,
    })
      .then((result) => {
        if (id !== requestId.current) return
        setPreview(result)
      })
      .catch((error: unknown) => {
        if (id !== requestId.current) return
        setPreview(null)
        setPreviewError(
          error instanceof Error ? error.message : 'Kunne ikke genberegne rotationen.',
        )
      })
      .finally(() => {
        if (id === requestId.current) setIsPreviewing(false)
      })
  }

  useEffect(() => {
    // Kick off a fresh live-recalculation request whenever the chosen base
    // sædskifte, startår eller de per-år-rettelser ændres — indlæsnings-/
    // resultat-tilstanden den sætter er selv synkroniseringspunktet med
    // denne asynkrone anmodning.
    if (!baseRef) return
    // eslint-disable-next-line react-hooks/set-state-in-effect
    runPreview(baseRef, overrides, startYear)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [baseRef, overrides, startYear])

  const changeBase = (next: RotationCandidateRef) => {
    if (baseRef && refsEqual(baseRef, next)) return
    setBaseRef(next)
    setOverrides([])
    setStartYear(1)
  }

  const setPositionOverride = (position: number, afgrodeKode: number) => {
    setOverrides((prev) => [
      ...prev.filter((o) => o.position !== position),
      { position, afgrodeKode },
    ])
  }

  const resetOverrides = () => setOverrides([])

  const shiftStartYear = (delta: number) => {
    setStartYear((prev) => prev + delta)
    setOverrides([])
  }

  const close = () => {
    setPreview(null)
    setPreviewError(null)
    onOpenChange(false)
  }

  const save = async () => {
    if (!baseRef) return
    setIsSaving(true)
    try {
      const updatedField = await applyFieldRotation(farmId, simulationId, field.id, {
        baseRef,
        overrides,
        startYear,
      })
      await mutate(
        simulationFieldsKey(farmId, simulationId),
        (current: FieldRecord[] = []) =>
          current.map((f) => (f.id === updatedField.id ? updatedField : f)),
        { revalidate: false },
      )
      void mutate(simulationFieldCandidateDetailKey(farmId, simulationId, field.id))
      void mutate(simulationYearlySummaryKey(farmId, simulationId))
      onError(null)
      close()
    } catch (error) {
      onError(
        error instanceof Error ? error.message : 'Kunne ikke gemme den manuelle rettelse.',
      )
    } finally {
      setIsSaving(false)
    }
  }

  const years = preview ? preview.years.slice(0, preview.activeLen) : []

  return (
    <Dialog open={open} onOpenChange={(next) => (next ? onOpenChange(true) : close())}>
      <DialogContent className="max-w-4xl">
        <DialogHeader>
          <DialogTitle>Rediger manuelt — {field.name}</DialogTitle>
          <DialogDescription>
            Vælg evt. et andet sædskifte, eller ret enkelte års afgrøde direkte —
            udvaskning og dækningsbidrag genberegnes med det samme. Intet gemmes
            før du trykker "Gem".
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-4">
            <label className="space-y-1 text-sm">
              <span className="text-xs text-muted-foreground">Kategori</span>
              <select
                className="w-full rounded-md border bg-background px-2 py-1.5 text-sm"
                value={selectedKategori?.kategori ?? ''}
                onChange={(event) => {
                  const kategori = availableKategorier.find(
                    (k) => k.kategori === event.target.value,
                  )
                  const first = kategori?.saedskifter[0]
                  if (first) {
                    changeBase({
                      saedskiftevariant: first.saedskiftevariant,
                      variant: '1',
                      nNormPct: simulation.rotationNNormProcenter[0] ?? '100',
                    })
                  }
                }}
              >
                {availableKategorier.map((k) => (
                  <option key={k.kategori} value={k.kategori}>
                    {k.kategori}
                  </option>
                ))}
              </select>
            </label>

            <label className="space-y-1 text-sm">
              <span className="text-xs text-muted-foreground">Sædskifte</span>
              <select
                className="w-full rounded-md border bg-background px-2 py-1.5 text-sm"
                value={baseRef?.saedskiftevariant ?? ''}
                onChange={(event) => {
                  changeBase({
                    saedskiftevariant: event.target.value,
                    variant: '1',
                    nNormPct: simulation.rotationNNormProcenter[0] ?? '100',
                  })
                }}
              >
                {(selectedKategori?.saedskifter ?? []).map((s) => (
                  <option key={s.saedskiftevariant} value={s.saedskiftevariant}>
                    {s.cropSequence.join(' - ')}
                  </option>
                ))}
              </select>
            </label>

            <label className="space-y-1 text-sm">
              <span className="text-xs text-muted-foreground">Variant</span>
              <select
                className="w-full rounded-md border bg-background px-2 py-1.5 text-sm"
                value={baseRef?.variant ?? ''}
                onChange={(event) => {
                  if (!baseRef) return
                  changeBase({ ...baseRef, variant: event.target.value })
                }}
              >
                {variantsForSaedskifte.map((v) => (
                  <option key={v} value={v}>
                    Variant {v}
                  </option>
                ))}
              </select>
            </label>

            <label className="space-y-1 text-sm">
              <span className="text-xs text-muted-foreground">N-norm%</span>
              <select
                className="w-full rounded-md border bg-background px-2 py-1.5 text-sm"
                value={baseRef?.nNormPct ?? ''}
                onChange={(event) => {
                  if (!baseRef) return
                  changeBase({ ...baseRef, nNormPct: event.target.value })
                }}
              >
                {nNormsForVariant.map((n) => (
                  <option key={n} value={n}>
                    {n}%
                  </option>
                ))}
              </select>
            </label>
          </div>

          {years.length > 0 ? (
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs text-muted-foreground">
                  Klik en afgrøde for at rette den for netop det år, eller ryk
                  hele sædskiftet frem/tilbage med pilene — resten af
                  sædskiftet forbliver som valgt ovenfor.
                </span>
                {overrides.length > 0 ? (
                  <Button size="sm" variant="ghost" onClick={resetOverrides}>
                    Nulstil rettelser
                  </Button>
                ) : null}
              </div>
              <div className="flex items-center gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  className="h-8 w-8 shrink-0 p-0"
                  onClick={() => shiftStartYear(1)}
                  aria-label="Ryk sædskiftet tilbage"
                  title="Ryk sædskiftet tilbage — vis året før for hver position"
                >
                  <ChevronLeft className="h-4 w-4" aria-hidden="true" />
                </Button>
                <div className="grid flex-1 gap-2 sm:grid-cols-4">
                  {years.map((y, index) => (
                    <label key={index} className="space-y-1 text-sm">
                      <span className="text-xs text-muted-foreground">
                        {ROTATION_START_CALENDAR_YEAR + index}
                      </span>
                      <select
                        className={`w-full rounded-md border bg-background px-2 py-1.5 text-sm ${
                          overrides.some((o) => o.position === index)
                            ? 'border-primary'
                            : ''
                        }`}
                        value={y.year.afgrodeKode}
                        onChange={(event) =>
                          setPositionOverride(index, Number(event.target.value))
                        }
                      >
                        {afgrodeKoder.map((a) => (
                          <option key={a.code} value={a.code}>
                            {a.navn}
                          </option>
                        ))}
                      </select>
                    </label>
                  ))}
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  className="h-8 w-8 shrink-0 p-0"
                  onClick={() => shiftStartYear(-1)}
                  aria-label="Ryk sædskiftet frem"
                  title="Ryk sædskiftet frem — vis året efter for hver position"
                >
                  <ChevronRight className="h-4 w-4" aria-hidden="true" />
                </Button>
              </div>
            </div>
          ) : null}

          <div className="grid gap-3 rounded-md border bg-muted/30 p-3 text-sm sm:grid-cols-3">
            <div>
              <div className="text-xs text-muted-foreground">Gns. udvaskning</div>
              <div className="font-semibold">
                {preview ? fmt(preview.avgLeachingKgNHa, 1) : '—'} kg N/ha
              </div>
            </div>
            <div>
              <div className="text-xs text-muted-foreground">Gns. DB2</div>
              <div className="font-semibold">
                {preview ? fmt(preview.avgDbKrHa, 0) : '—'} kr/ha
              </div>
            </div>
            <div>
              <div className="text-xs text-muted-foreground">Gns. foderenheder</div>
              <div className="font-semibold">
                {preview ? fmt(preview.avgFen, 0) : '—'} FE/ha
              </div>
            </div>
          </div>

          {previewError ? (
            <p className="text-sm text-red-700">{previewError}</p>
          ) : null}

          {preview ? (
            <div className="max-h-[40vh] overflow-y-auto rounded-md border bg-muted/20 p-4">
              <RotationYearsDetail years={years} />
            </div>
          ) : null}

          <div className="flex items-center gap-3">
            <Button onClick={() => void save()} disabled={isSaving || !preview}>
              {isSaving ? 'Gemmer...' : 'Gem'}
            </Button>
            <Button variant="outline" onClick={close} disabled={isSaving}>
              Annullér
            </Button>
            {isPreviewing ? (
              <span className="text-xs text-muted-foreground">Genberegner...</span>
            ) : null}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
