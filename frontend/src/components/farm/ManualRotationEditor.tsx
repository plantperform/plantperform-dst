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
import { SearchableCropPickerList } from '@/components/farm/SearchableCropPickerList'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import { ROTATION_START_CALENDAR_YEAR } from '@/lib/field-domain'

type ManualRotationEditorProps = {
  farmId: string
  simulationId: string
  field: FieldRecord
  simulation: Simulation
  cropColorMap: Map<number, string>
  open: boolean
  onOpenChange: (open: boolean) => void
  onError: (message: string | null) => void
}

const FALLBACK_CROP_COLOR = '#a7c69b'

const fmt = (value: number, digits = 1) =>
  new Intl.NumberFormat('da-DK', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(value)

const refsEqual = (a: RotationCandidateRef, b: RotationCandidateRef) =>
  a.saedskiftevariant === b.saedskiftevariant &&
  a.variant === b.variant &&
  a.nNormPct === b.nNormPct

const chipClassName = (selected: boolean) =>
  `rounded-full border px-3 py-1.5 text-sm transition-colors ${
    selected
      ? 'border-primary bg-primary text-primary-foreground'
      : 'bg-background hover:bg-muted'
  }`

const BigMetricTile = ({
  label,
  value,
  caption,
}: {
  label: string
  value: string
  caption?: string
}) => (
  <div className="rounded-xl border bg-background p-4">
    <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
      {label}
    </p>
    <p className="mt-1 text-[22px] font-bold leading-tight tabular-nums">{value}</p>
    {caption ? (
      <p className="mt-1 text-xs leading-snug text-muted-foreground">{caption}</p>
    ) : null}
  </div>
)

export const ManualRotationEditor = ({
  farmId,
  simulationId,
  field,
  simulation,
  cropColorMap,
  open,
  onOpenChange,
  onError,
}: ManualRotationEditorProps) => {
  const {
    data: current,
    isLoading: isLoadingCurrent,
    error: currentError,
  } = useSimulationFieldCandidateDetail(farmId, simulationId, field.id)
  const {
    data: kategorier = [],
    isLoading: isLoadingKategorier,
    error: kategorierError,
  } = useRotationKategorier(farmId)
  const {
    data: allRefs = [],
    isLoading: isLoadingAllRefs,
    error: allRefsError,
  } = useRotationCandidateOptions(farmId)
  const {
    data: afgrodeKoder = [],
    isLoading: isLoadingAfgrodeKoder,
    error: afgrodeKoderError,
  } = useAfgrodeKoder(farmId)

  const isLoadingCandidates =
    isLoadingCurrent ||
    isLoadingKategorier ||
    isLoadingAllRefs ||
    isLoadingAfgrodeKoder
  const candidatesError =
    currentError ?? kategorierError ?? allRefsError ?? afgrodeKoderError

  const [baseRef, setBaseRef] = useState<RotationCandidateRef | null>(null)
  const [selectedKategoriName, setSelectedKategoriName] = useState<string | null>(null)
  const [overrides, setOverrides] = useState<RotationPositionOverride[]>([])
  const [startYear, setStartYear] = useState(1)
  const [activeYearIndex, setActiveYearIndex] = useState<number | null>(null)
  const [preview, setPreview] = useState<RotationCandidateEvaluation | null>(null)
  const [previewError, setPreviewError] = useState<string | null>(null)
  const [isPreviewing, setIsPreviewing] = useState(false)
  const [isSaving, setIsSaving] = useState(false)
  const requestId = useRef(0)

  const availableKategorier = useMemo(() => {
    const allowed = new Set(simulation.rotationSaedskiftevarianter)
    return kategorier
      .map((k) => ({
        ...k,
        saedskifter: k.saedskifter.filter((s) => allowed.has(s.saedskiftevariant)),
      }))
      .filter((k) => k.saedskifter.some((s) => s.saedskiftevariant !== '1'))
  }, [kategorier, simulation.rotationSaedskiftevarianter])

  useEffect(() => {
    if (!open || !current) return
    const ref = current.baseRef ?? current.ref
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setBaseRef(ref)
    setOverrides(current.overrides ?? [])
    setStartYear(current.startYear ?? 1)
    const kategori = availableKategorier.find((k) =>
      k.saedskifter.some((s) => s.saedskiftevariant === ref.saedskiftevariant),
    )
    setSelectedKategoriName(kategori?.kategori ?? availableKategorier[0]?.kategori ?? null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, current])

  const selectedKategori = useMemo(
    () =>
      availableKategorier.find((k) => k.kategori === selectedKategoriName) ??
      availableKategorier[0],
    [availableKategorier, selectedKategoriName],
  )

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

  const codeByCropName = useMemo(
    () => new Map(afgrodeKoder.map((a) => [a.navn, a.code])),
    [afgrodeKoder],
  )

  const colorForCropName = (name: string) =>
    cropColorMap.get(codeByCropName.get(name) ?? -1) ?? FALLBACK_CROP_COLOR

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
    setActiveYearIndex(null)
  }

  const selectKategori = (kategoriName: string) => {
    setSelectedKategoriName(kategoriName)
    const kategori = availableKategorier.find((k) => k.kategori === kategoriName)
    const first =
      kategori?.saedskifter.find((s) => s.saedskiftevariant !== '1') ??
      kategori?.saedskifter[0]
    if (first) {
      changeBase({
        saedskiftevariant: first.saedskiftevariant,
        variant: '1',
        nNormPct: simulation.rotationNNormProcenter[0] ?? '100',
      })
    }
  }

  const setPositionOverride = (position: number, afgrodeKode: number) => {
    setOverrides((prev) => [
      ...prev.filter((o) => o.position !== position),
      { position, afgrodeKode },
    ])
  }

  const resetOverrides = () => {
    setOverrides([])
    setActiveYearIndex(null)
  }

  const shiftStartYear = (delta: number) => {
    setStartYear((prev) => prev + delta)
    setOverrides([])
    setActiveYearIndex(null)
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
      <DialogContent className="max-h-[90vh] max-w-5xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Rediger sædskifte - {field.name}</DialogTitle>
          <DialogDescription>
            Vælg evt. et andet sædskifte, eller ret enkelte års afgrøde direkte -
            udvaskning og dækningsbidrag genberegnes med det samme. Intet gemmes
            før du trykker "Gem".
          </DialogDescription>
        </DialogHeader>

        {candidatesError ? (
          <p className="text-sm text-red-700">Kunne ikke hente sædskifter.</p>
        ) : isLoadingCandidates ? (
          <div className="space-y-3 p-4">
            <p className="text-sm text-muted-foreground">Henter sædskifter...</p>
            <div className="space-y-2" aria-hidden="true">
              <div className="h-4 w-5/6 animate-pulse rounded bg-muted" />
              <div className="h-4 w-1/2 animate-pulse rounded bg-muted" />
              <div className="h-4 w-2/3 animate-pulse rounded bg-muted" />
              <div className="h-4 w-3/4 animate-pulse rounded bg-muted" />
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="grid gap-6 lg:grid-cols-2">
              <div className="space-y-4">
                <h3 className="text-sm font-semibold">Vælg sædskifte</h3>

                <div className="space-y-1.5">
                  <Label>Kategori</Label>
                  <div className="flex flex-wrap gap-2">
                    {availableKategorier.map((k) => (
                      <button
                        key={k.kategori}
                        type="button"
                        aria-pressed={selectedKategori?.kategori === k.kategori}
                        onClick={() => selectKategori(k.kategori)}
                        className={chipClassName(selectedKategori?.kategori === k.kategori)}
                      >
                        {k.kategori}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="space-y-1.5">
                  <Label>Sædskifte</Label>
                  <SearchableCropPickerList
                    key={selectedKategori?.kategori ?? 'none'}
                    items={(selectedKategori?.saedskifter ?? []).map((s) => ({
                      key: s.saedskiftevariant,
                      label: s.cropSequence.join(' - '),
                      title: s.cropSequence.join(' - '),
                      colors: s.cropSequence.map(colorForCropName),
                    }))}
                    selectedKey={baseRef?.saedskiftevariant ?? null}
                    onSelect={(key) =>
                      changeBase({
                        saedskiftevariant: key,
                        variant: '1',
                        nNormPct: simulation.rotationNNormProcenter[0] ?? '100',
                      })
                    }
                    searchLabel="Søg i sædskifter"
                    searchPlaceholder="Søg i sædskifter..."
                    emptyMessage="Ingen sædskifter matcher søgningen"
                  />
                </div>

                <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
                  {variantsForSaedskifte.length > 1 ? (
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="text-xs text-muted-foreground">Variant</span>
                      {variantsForSaedskifte.map((v) => (
                        <button
                          key={v}
                          type="button"
                          aria-pressed={baseRef?.variant === v}
                          onClick={() => {
                            if (!baseRef) return
                            changeBase({ ...baseRef, variant: v })
                          }}
                          className={chipClassName(baseRef?.variant === v)}
                        >
                          {v}
                        </button>
                      ))}
                    </div>
                  ) : null}

                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="text-xs text-muted-foreground">N-norm</span>
                    {nNormsForVariant.map((n) => (
                      <button
                        key={n}
                        type="button"
                        aria-pressed={baseRef?.nNormPct === n}
                        onClick={() => {
                          if (!baseRef) return
                          changeBase({ ...baseRef, nNormPct: n })
                        }}
                        className={chipClassName(baseRef?.nNormPct === n)}
                      >
                        {n}%
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              <div className="space-y-4">
                <h3 className="text-sm font-semibold">Resultat</h3>

                <div className="relative">
                  <div
                    className={`space-y-4 transition-opacity ${
                      isPreviewing ? 'pointer-events-none opacity-50' : ''
                    }`}
                    aria-busy={isPreviewing}
                  >
                    <div className="grid grid-cols-2 gap-3">
                      <BigMetricTile
                        label="Udvaskning"
                        value={`${preview ? fmt(preview.avgLeachingKgNHa, 1) : '-'} kg N/ha`}
                      />
                      <BigMetricTile
                        label="DB2"
                        value={`${preview ? fmt(preview.avgDbKrHa, 0) : '-'} kr/ha`}
                        caption={
                          preview && preview.avgFen > 0
                            ? `${fmt(preview.avgFen, 0)} FE/ha`
                            : undefined
                        }
                      />
                    </div>

                    {previewError ? (
                      <p className="text-sm text-red-700">{previewError}</p>
                    ) : null}

                    {years.length > 0 ? (
                      <div className="space-y-2">
                        <div className="flex items-center justify-between gap-2">
                          <Label>Sædskifte år for år</Label>
                          {overrides.length > 0 ? (
                            <Button size="sm" variant="ghost" onClick={resetOverrides}>
                              Nulstil rettelser
                            </Button>
                          ) : null}
                        </div>
                        <p className="text-xs text-muted-foreground">
                          Klik et år for at se og rette dets afgrøde, eller ryk hele
                          sædskiftet frem/tilbage med pilene.
                        </p>
                        <div className="flex items-center gap-2">
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-8 w-8 shrink-0 p-0"
                            onClick={() => shiftStartYear(1)}
                            aria-label="Ryk sædskiftet tilbage"
                            title="Ryk sædskiftet tilbage - vis året før for hver position"
                          >
                            <ChevronLeft className="h-4 w-4" aria-hidden="true" />
                          </Button>
                          <div className="flex flex-1 flex-wrap gap-1.5">
                            {years.map((y, index) => {
                              const calendarYear = ROTATION_START_CALENDAR_YEAR + index
                              const isOverridden = overrides.some((o) => o.position === index)
                              const isActive = activeYearIndex === index
                              const color =
                                cropColorMap.get(y.year.afgrodeKode) ?? FALLBACK_CROP_COLOR
                              return (
                                <button
                                  key={index}
                                  type="button"
                                  aria-pressed={isActive}
                                  onClick={() => setActiveYearIndex(isActive ? null : index)}
                                  className={`flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs transition-colors ${
                                    isActive
                                      ? 'border-primary bg-primary text-primary-foreground'
                                      : isOverridden
                                        ? 'border-primary bg-primary/10'
                                        : 'bg-background hover:bg-muted'
                                  }`}
                                >
                                  <span
                                    className="h-[10px] w-[8px] shrink-0 rounded-[2px]"
                                    style={{ backgroundColor: color }}
                                    aria-hidden="true"
                                  />
                                  {calendarYear}: {y.year.afgrodeNavn}
                                </button>
                              )
                            })}
                          </div>
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-8 w-8 shrink-0 p-0"
                            onClick={() => shiftStartYear(-1)}
                            aria-label="Ryk sædskiftet frem"
                            title="Ryk sædskiftet frem - vis året efter for hver position"
                          >
                            <ChevronRight className="h-4 w-4" aria-hidden="true" />
                          </Button>
                        </div>

                        {activeYearIndex !== null && years[activeYearIndex] ? (
                          <SearchableCropPickerList
                            key={activeYearIndex}
                            items={afgrodeKoder.map((a) => ({
                              key: String(a.code),
                              label: a.navn,
                              title: a.navn,
                              colors: [cropColorMap.get(a.code) ?? FALLBACK_CROP_COLOR],
                            }))}
                            selectedKey={String(years[activeYearIndex].year.afgrodeKode)}
                            onSelect={(key) => setPositionOverride(activeYearIndex, Number(key))}
                            searchLabel="Søg afgrøde"
                            searchPlaceholder="Søg afgrøde..."
                            emptyMessage="Ingen afgrøder matcher søgningen"
                            maxHeightClassName="max-h-[200px]"
                          />
                        ) : null}

                        {activeYearIndex !== null && years[activeYearIndex] ? (
                          <div className="rounded-md border bg-muted/20 p-4">
                            <RotationYearsDetail
                              years={years}
                              areaHa={field.areaHa}
                              retention={field.retention}
                              selectedYearIndex={activeYearIndex}
                              hideYearSelector
                            />
                          </div>
                        ) : null}
                      </div>
                    ) : null}
                  </div>

                  {isPreviewing ? (
                    <div className="pointer-events-none absolute inset-x-0 top-0 flex justify-center">
                      <div
                        role="status"
                        aria-live="polite"
                        className="mt-2 flex items-center gap-1.5 rounded-full border bg-background px-3 py-1 text-xs text-muted-foreground shadow-sm"
                      >
                        <span
                          className="h-1.5 w-1.5 animate-pulse rounded-full bg-primary"
                          aria-hidden="true"
                        />
                        Genberegner...
                      </div>
                    </div>
                  ) : null}
                </div>
              </div>
            </div>

            <div className="flex items-center gap-3">
              <Button
                onClick={() => void save()}
                disabled={isSaving || !preview || isLoadingCandidates}
              >
                {isSaving ? 'Gemmer...' : 'Gem'}
              </Button>
              <Button variant="outline" onClick={close} disabled={isSaving}>
                Annuller
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
