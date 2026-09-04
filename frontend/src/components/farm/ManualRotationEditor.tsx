import { ChevronLeft, ChevronRight, RotateCw } from 'lucide-react'
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
import { CropYearSwatch } from '@/components/farm/CropYearSwatch'
import { LoadingSkeleton } from '@/components/farm/LoadingSkeleton'
import { BigMetricTile, RotationYearsDetail } from '@/components/farm/RotationYearsDetail'
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
import {
  compactCropSequenceLabel,
  CROP_YEAR_FALLBACK_COLOR,
  formatRotationYear,
  ROTATION_START_CALENDAR_YEAR,
} from '@/lib/field-domain'

type ManualRotationEditorProps = {
  farmId: string
  simulationId: string
  field: FieldRecord
  simulation: Simulation
  cropColorMap: Map<number, string>
  intent?: 'edit' | 'lock'
  open: boolean
  onOpenChange: (open: boolean) => void
  onError: (message: string | null) => void
}

const fmt =(value: number, digits = 1) =>
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

const AMBER_PILL_CLASSES = 'rounded-full border border-amber-200 bg-amber-50 text-amber-800'

export const ManualRotationEditor = ({
  farmId,
  simulationId,
  field,
  simulation,
  cropColorMap,
  intent = 'edit',
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
  const [baselineStartYear, setBaselineStartYear] = useState(1)
  const [activeYearIndex, setActiveYearIndex] = useState<number | null>(null)
  const [preview, setPreview] = useState<RotationCandidateEvaluation | null>(null)
  const [previewError, setPreviewError] = useState<string | null>(null)
  const [isPreviewing, setIsPreviewing] = useState(false)
  const [isSaving, setIsSaving] = useState(false)
  const [shiftAnimation, setShiftAnimation] = useState<'left' | 'right' | null>(null)
  const requestId = useRef(0)
  const pendingShiftDirectionRef = useRef<'left' | 'right' | null>(null)

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
    const seededStartYear = current.startYear ?? 1
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setBaseRef(ref)
    setOverrides(current.overrides ?? [])
    setStartYear(seededStartYear)
    setBaselineStartYear(seededStartYear)
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
    cropColorMap.get(codeByCropName.get(name) ?? -1) ?? CROP_YEAR_FALLBACK_COLOR

  const kategoriPickerItems = useMemo(
    () =>
      (selectedKategori?.saedskifter ?? []).map((s) => ({
        key: s.saedskiftevariant,
        label: compactCropSequenceLabel(s.cropSequence),
        title: s.cropSequence.join(' - '),
        colors: s.cropSequence.map(colorForCropName),
        meta: `${s.cropSequence.length} år`,
      })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [selectedKategori, codeByCropName, cropColorMap],
  )

  const afgrodePickerItems = useMemo(
    () =>
      afgrodeKoder.map((a) => ({
        key: String(a.code),
        label: a.navn,
        title: a.navn,
        colors: [cropColorMap.get(a.code) ?? CROP_YEAR_FALLBACK_COLOR],
      })),
    [afgrodeKoder, cropColorMap],
  )

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
        setShiftAnimation(pendingShiftDirectionRef.current)
        pendingShiftDirectionRef.current = null
      })
      .catch((error: unknown) => {
        if (id !== requestId.current) return
        pendingShiftDirectionRef.current = null
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

  useEffect(() => {
    if (!shiftAnimation) return
    const timeoutId = window.setTimeout(() => setShiftAnimation(null), 2000)
    return () => window.clearTimeout(timeoutId)
  }, [shiftAnimation])

  const changeBase = (next: RotationCandidateRef) => {
    if (baseRef && refsEqual(baseRef, next)) return
    pendingShiftDirectionRef.current = null
    setShiftAnimation(null)
    setBaseRef(next)
    setOverrides([])
    setStartYear(1)
    setBaselineStartYear(1)
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
    pendingShiftDirectionRef.current =
      years.length > 1 && Math.abs(delta) === 1 ? (delta > 0 ? 'right' : 'left') : null
    setShiftAnimation(null)
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
  const activeYear = activeYearIndex !== null ? years[activeYearIndex] : undefined
  const rotationLength = years.length
  const startYearOffset =
    rotationLength > 0
      ? (((startYear - baselineStartYear) % rotationLength) + rotationLength) % rotationLength
      : 0
  const slideAnimationClassName = shiftAnimation
    ? 'motion-safe:animate-[slide-in_280ms_ease-out]'
    : ''
  const slideAnimationKey = `shift-${startYear}`
  const wrapCell =
    shiftAnimation && rotationLength > 0
      ? shiftAnimation === 'right'
        ? { index: rotationLength - 1, fromYear: ROTATION_START_CALENDAR_YEAR }
        : { index: 0, fromYear: ROTATION_START_CALENDAR_YEAR + rotationLength - 1 }
      : null

  return (
    <Dialog open={open} onOpenChange={(next) => (next ? onOpenChange(true) : close())}>
      <DialogContent className="max-h-[90vh] max-w-5xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {intent === 'lock' ? 'Lås sædskifte' : 'Rediger sædskifte'} - {field.name}
          </DialogTitle>
          <DialogDescription>
            {intent === 'lock'
              ? 'Når du gemmer, låses marken til dette sædskifte, og Optimér ændrer den ikke.'
              : 'Vælg evt. et andet sædskifte, eller ret enkelte års afgrøde direkte - udvaskning og dækningsbidrag genberegnes med det samme. Intet gemmes før du trykker "Gem".'}
          </DialogDescription>
        </DialogHeader>

        {candidatesError ? (
          <p className="text-sm text-red-700">Kunne ikke hente sædskifter.</p>
        ) : isLoadingCandidates ? (
          <LoadingSkeleton message="Henter sædskifter..." />
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
                    items={kategoriPickerItems}
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

                <p className="text-xs text-muted-foreground">
                  Varianter har samme afgrøder - forskellen er hvor mange efterafgrøder
                  og andre virkemidler der er lagt ind. N-norm er andelen af fuld
                  kvælstofnorm.
                </p>
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
                          <div className="flex items-center gap-2">
                            {startYearOffset !== 0 ? (
                              <div
                                className={`flex items-center gap-1.5 px-2.5 py-1 text-xs ${AMBER_PILL_CLASSES}`}
                              >
                                <span>Forskudt +{startYearOffset} år</span>
                                <button
                                  type="button"
                                  onClick={() => shiftStartYear(baselineStartYear - startYear)}
                                  className="font-medium text-amber-900 underline hover:no-underline"
                                >
                                  Nulstil
                                </button>
                              </div>
                            ) : null}
                            {overrides.length > 0 ? (
                              <Button size="sm" variant="ghost" onClick={resetOverrides}>
                                Nulstil rettelser
                              </Button>
                            ) : null}
                          </div>
                        </div>
                        <p className="text-xs text-muted-foreground">
                          Klik et år for at se og rette det.
                        </p>
                        <div className="grid grid-cols-4 gap-2">
                          {years.map((y, index) => {
                            const calendarYear = ROTATION_START_CALENDAR_YEAR + index
                            const isOverridden = overrides.some((o) => o.position === index)
                            const isActive = activeYearIndex === index
                            const cellWrap = wrapCell && wrapCell.index === index ? wrapCell : null
                            const color =
                              cropColorMap.get(y.year.afgrodeKode) ?? CROP_YEAR_FALLBACK_COLOR
                            const cellTitle = cellWrap
                              ? `Afgrøden rullede rundt fra ${cellWrap.fromYear}`
                              : formatRotationYear(y.year)
                            return (
                              <button
                                key={index}
                                type="button"
                                aria-pressed={isActive}
                                title={cellTitle}
                                onClick={() => setActiveYearIndex(isActive ? null : index)}
                                className={`relative flex flex-col items-start gap-1 overflow-hidden rounded-md border px-2 py-1.5 text-xs transition-colors ${
                                  isActive
                                    ? 'border-primary bg-primary text-primary-foreground'
                                    : isOverridden
                                      ? 'border-primary bg-primary/10'
                                      : 'bg-background hover:bg-muted'
                                }`}
                              >
                                <span
                                  className={`text-[11px] ${
                                    isActive ? 'text-primary-foreground/80' : 'text-muted-foreground'
                                  }`}
                                >
                                  {calendarYear}
                                </span>
                                <span
                                  key={slideAnimationKey}
                                  className={`flex w-full min-w-0 items-center gap-1.5 ${slideAnimationClassName}`}
                                  style={
                                    shiftAnimation
                                      ? ({
                                          '--slide-from': shiftAnimation === 'left' ? '-100%' : '100%',
                                        } as React.CSSProperties)
                                      : undefined
                                  }
                                >
                                  <CropYearSwatch
                                    color={color}
                                    hasUdlaeg={y.year.udlaegNavn !== null}
                                    size="10x8"
                                  />
                                  <span className="min-w-0 truncate">{y.year.afgrodeNavn}</span>
                                </span>
                                {cellWrap ? (
                                  <span
                                    className={`pointer-events-none absolute right-1 top-1 flex items-center gap-0.5 px-1.5 text-[10px] ${AMBER_PILL_CLASSES}`}
                                  >
                                    <RotateCw className="h-2.5 w-2.5" aria-hidden="true" />
                                    fra {cellWrap.fromYear}
                                  </span>
                                ) : null}
                              </button>
                            )
                          })}
                        </div>

                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-xs text-muted-foreground">Ryk alle afgrøder</span>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => shiftStartYear(1)}
                            title="Ryk hele sædskiftet et år tilbage"
                          >
                            <ChevronLeft className="h-4 w-4" aria-hidden="true" />
                            Et år tilbage
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => shiftStartYear(-1)}
                            title="Ryk hele sædskiftet et år frem"
                          >
                            Et år frem
                            <ChevronRight className="h-4 w-4" aria-hidden="true" />
                          </Button>
                        </div>

                        {startYearOffset !== 0 ? (
                          <p className="text-xs text-muted-foreground">
                            Samme rækkefølge - kun startåret flytter sig. Gennemsnittet
                            påvirkes ikke.
                          </p>
                        ) : null}

                        {activeYearIndex !== null && activeYear ? (
                          <SearchableCropPickerList
                            key={activeYearIndex}
                            items={afgrodePickerItems}
                            selectedKey={String(activeYear.year.afgrodeKode)}
                            onSelect={(key) => setPositionOverride(activeYearIndex, Number(key))}
                            searchLabel="Søg afgrøde"
                            searchPlaceholder="Søg afgrøde..."
                            emptyMessage="Ingen afgrøder matcher søgningen"
                            maxHeightClassName="max-h-[200px]"
                          />
                        ) : null}

                        {activeYearIndex !== null && activeYear ? (
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
                    <div className="pointer-events-none absolute inset-0 flex items-start justify-center">
                      <div className="sticky top-[40%]">
                        <div
                          role="status"
                          aria-live="polite"
                          className="flex items-center gap-1.5 rounded-full border bg-background px-3 py-1 text-xs text-muted-foreground shadow-lg"
                        >
                          <span
                            className="h-1.5 w-1.5 animate-pulse rounded-full bg-primary"
                            aria-hidden="true"
                          />
                          Genberegner...
                        </div>
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
                {isSaving ? 'Gemmer...' : intent === 'lock' ? 'Gem og lås' : 'Gem'}
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
