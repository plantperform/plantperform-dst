import { AlertTriangle, Check, Pencil } from 'lucide-react'
import { useId, useState } from 'react'
import { mutate } from 'swr'

import { ApiError } from '@/api/client'
import {
  simulationsKey,
  useCropAreaRanges,
  useScenarioCropCodes,
} from '@/api/hooks'
import { updateSimulationConstraints } from '@/api/mutations'
import {
  useOptimizationRun,
  useOptimizationRunActions,
} from '@/api/optimization-runs'
import type { CatchmentNLoadCap, FieldRecord, Simulation } from '@/api/types'
import {
  catchmentKey,
  effectiveMaxNLoadByCatchment,
  inputToOptionalNumber,
  numberToInput,
  useCatchmentOptions,
} from '@/components/farm/catchment-options'
import { CropAreaLimits } from '@/components/farm/CropAreaLimits'
import {
  FieldLabel,
  LimitsColumn,
  LimitValue,
  RULES_CARD_CLASS,
  RULES_CARD_HEAD_CLASS,
  RulesHint,
  SummaryList,
  SummaryRow,
  UnitInput,
  UnsavedDot,
} from '@/components/farm/rules-ui'
import { Button } from '@/components/ui/button'
import { Spinner } from '@/components/ui/spinner'
import {
  cropAreaLimitError,
  cropAreaLimitFromDraft,
  cropAreaRangeError,
  hectareDraft,
  inputFromCropAreaLimit,
  sameCropAreaLimits,
  totalFieldAreaHa,
  type CropAreaLimitInput,
} from '@/lib/crop-area-limits'
import { formatNumber } from '@/lib/field-domain'

type SaveState =
  | { kind: 'idle' }
  | { kind: 'saving' }
  | { kind: 'saved' }
  | { kind: 'error'; message: string }

const SAVE_FAILED_MESSAGE = 'Dine ændringer er stadig her - prøv igen.'

const sectionList = new Intl.ListFormat('da-DK', {
  style: 'long',
  type: 'conjunction',
})

const buildMaxNLoadInputs = (
  catchmentKeys: string[],
  effective: Map<string, number>,
): Record<string, string> =>
  Object.fromEntries(
    catchmentKeys.map((key) => [
      key,
      numberToInput(effective.get(key) ?? null),
    ]),
  )

const limitAmount = (value: number | null) =>
  value === null ? null : formatNumber(value)

type RulesLimitsCardProps = {
  farmId: string
  simulation: Simulation
  fields: FieldRecord[]
}

export const RulesLimitsCard = ({
  farmId,
  simulation,
  fields,
}: RulesLimitsCardProps) => {
  const id = useId()
  const { constraints } = simulation
  const catchments = useCatchmentOptions(farmId, fields)
  const catchmentKeys = catchments.map((catchment) =>
    catchmentKey(catchment.catchmentId),
  )
  const quotaByKey = effectiveMaxNLoadByCatchment(fields, [])
  const savedMaxNLoad = effectiveMaxNLoadByCatchment(
    fields,
    constraints.maxNLoadByCatchment,
  )
  const totalAreaHa = totalFieldAreaHa(fields)
  const { data: cropCodes = [] } = useScenarioCropCodes(farmId, simulation.id)
  const { data: cropAreaRanges = [] } = useCropAreaRanges(farmId, simulation.id)
  const run = useOptimizationRun(simulation.id)
  const cropAreaViolations =
    run?.status === 'failed' ? run.cropAreaViolations : []
  const { markStale } = useOptimizationRunActions()

  const [editing, setEditing] = useState(false)
  const [cropPickerOpen, setCropPickerOpen] = useState(false)
  const [minFeedUnits, setMinFeedUnits] = useState(constraints.minFeedUnits)
  const [maxFeedUnits, setMaxFeedUnits] = useState(constraints.maxFeedUnits)
  const [maxNLoadInputs, setMaxNLoadInputs] = useState(() =>
    buildMaxNLoadInputs(catchmentKeys, savedMaxNLoad),
  )
  const [cropInputs, setCropInputs] = useState<CropAreaLimitInput[]>(() =>
    constraints.cropAreaLimits.map(inputFromCropAreaLimit),
  )
  const [showCropAreaErrors, setShowCropAreaErrors] = useState(false)
  const [saveState, setSaveState] = useState<SaveState>({ kind: 'idle' })

  const maxNLoadByCatchment: CatchmentNLoadCap[] = catchments.map(
    (catchment) => ({
      catchmentId: catchment.catchmentId,
      maxNLoadKg: inputToOptionalNumber(
        maxNLoadInputs[catchmentKey(catchment.catchmentId)] ?? '',
      ),
    }),
  )
  const nLoadChangedKeys = new Set(
    maxNLoadByCatchment
      .filter(
        (cap) =>
          cap.maxNLoadKg !==
          (savedMaxNLoad.get(catchmentKey(cap.catchmentId)) ?? null),
      )
      .map((cap) => catchmentKey(cap.catchmentId)),
  )
  const minFeedUnitsChanged = minFeedUnits !== constraints.minFeedUnits
  const maxFeedUnitsChanged = maxFeedUnits !== constraints.maxFeedUnits
  const cropDrafts = cropInputs.map((input) => hectareDraft(input, totalAreaHa))
  const cropAreaLimits = cropDrafts.map(cropAreaLimitFromDraft)
  const rangeByCode = new Map(
    cropAreaRanges.map((range) => [range.cropCode, range]),
  )
  const hasCropAreaLimitErrors = cropDrafts.some(
    (draft) =>
      cropAreaLimitError(draft) !== null ||
      cropAreaRangeError(draft, rangeByCode.get(draft.cropCode)) !== null,
  )

  const changedSections = [
    nLoadChangedKeys.size > 0 ? 'Udledning' : null,
    minFeedUnitsChanged || maxFeedUnitsChanged ? 'Foderenheder' : null,
    sameCropAreaLimits(cropAreaLimits, constraints.cropAreaLimits)
      ? null
      : 'Afgrøder',
  ].filter((section): section is string => section !== null)
  const isDirty = changedSections.length > 0

  const edited = () => {
    if (saveState.kind !== 'saving') setSaveState({ kind: 'idle' })
  }

  const editMaxNLoadInput = (key: string, value: string) => {
    edited()
    setMaxNLoadInputs((current) => ({ ...current, [key]: value }))
  }

  const editCropInputs = (inputs: CropAreaLimitInput[]) => {
    edited()
    setCropInputs(inputs)
  }

  const discard = () => {
    setMinFeedUnits(constraints.minFeedUnits)
    setMaxFeedUnits(constraints.maxFeedUnits)
    setMaxNLoadInputs(buildMaxNLoadInputs(catchmentKeys, savedMaxNLoad))
    setCropInputs(constraints.cropAreaLimits.map(inputFromCropAreaLimit))
    setShowCropAreaErrors(false)
    setSaveState({ kind: 'idle' })
  }

  const save = async () => {
    if (hasCropAreaLimitErrors) {
      setShowCropAreaErrors(true)
      setEditing(true)
      setSaveState({
        kind: 'error',
        message: 'Ret kravene under Afgrøder, før du gemmer.',
      })
      return
    }
    setSaveState({ kind: 'saving' })
    try {
      const updated = await updateSimulationConstraints(farmId, simulation.id, {
        ...constraints,
        minFeedUnits,
        maxFeedUnits,
        maxNLoadByCatchment,
        cropAreaLimits,
      })
      await mutate(
        simulationsKey(farmId),
        (current: Simulation[] = []) =>
          current.map((entry) => (entry.id === updated.id ? updated : entry)),
        { revalidate: false },
      )
      setMinFeedUnits(updated.constraints.minFeedUnits)
      setMaxFeedUnits(updated.constraints.maxFeedUnits)
      setMaxNLoadInputs(
        buildMaxNLoadInputs(
          catchmentKeys,
          effectiveMaxNLoadByCatchment(
            fields,
            updated.constraints.maxNLoadByCatchment,
          ),
        ),
      )
      if (
        !sameCropAreaLimits(cropAreaLimits, updated.constraints.cropAreaLimits)
      ) {
        setCropInputs(
          updated.constraints.cropAreaLimits.map(inputFromCropAreaLimit),
        )
      }
      setShowCropAreaErrors(false)
      setSaveState({ kind: 'saved' })
      markStale(simulation.id)
    } catch (error) {
      setSaveState({
        kind: 'error',
        message:
          error instanceof ApiError && error.status === 422
            ? error.message
            : SAVE_FAILED_MESSAGE,
      })
    }
  }

  const isSaving = saveState.kind === 'saving'
  const canDiscard = !isSaving && (isDirty || saveState.kind === 'error')

  return (
    <section className={RULES_CARD_CLASS} aria-labelledby={`${id}-title`}>
      <div className={RULES_CARD_HEAD_CLASS}>
        <div className="min-w-0">
          <h3 id={`${id}-title`} className="text-sm font-semibold">
            Grænser for hele bedriften
          </h3>
          <p className="mt-1 text-[13px] text-muted-foreground">
            Bruges, når du vælger{' '}
            <b className="font-semibold text-foreground">
              Gennemsnit for perioden
            </b>{' '}
            i Optimér. Loft hvert år har egne indstillinger, der kun gælder den
            enkelte kørsel.
          </p>
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="shrink-0"
          aria-expanded={editing}
          onClick={() => setEditing((current) => !current)}
        >
          <Pencil className="size-3.5" aria-hidden="true" />
          {editing ? 'Luk redigering' : 'Rediger grænser'}
        </Button>
      </div>

      <div className="grid divide-y border-t @3xl:grid-cols-3 @3xl:divide-x @3xl:divide-y-0">
        <LimitsColumn title="Maks. udledning pr. opland" term="nLoad">
          {catchments.length === 0 ? (
            <p className="mt-1.5 py-2.5 text-[13px] text-muted-foreground">
              Ingen marker med et kystvandopland
            </p>
          ) : editing ? (
            <div className="flex flex-col gap-2.5 pt-2.5 pb-2">
              {catchments.map((catchment) => {
                const key = catchmentKey(catchment.catchmentId)
                const quota = quotaByKey.get(key)
                return (
                  <div key={key}>
                    <FieldLabel
                      htmlFor={`${id}-n-load-${key}`}
                      label={catchment.label}
                      hint={
                        quota === undefined
                          ? null
                          : `Kvote ${formatNumber(quota)}`
                      }
                    />
                    <UnitInput
                      id={`${id}-n-load-${key}`}
                      unit="kg N"
                      type="number"
                      min="0"
                      value={maxNLoadInputs[key] ?? ''}
                      placeholder="Ingen grænse"
                      onChange={(event) =>
                        editMaxNLoadInput(key, event.target.value)
                      }
                    />
                  </div>
                )
              })}
              <RulesHint>
                Feltet starter med oplandets kvote. Tomt felt betyder ingen
                grænse.
              </RulesHint>
            </div>
          ) : (
            <SummaryList>
              {maxNLoadByCatchment.map((cap, index) => {
                const key = catchmentKey(cap.catchmentId)
                const quota = quotaByKey.get(key)
                return (
                  <SummaryRow
                    key={key}
                    label={catchments[index].label}
                    note={
                      quota !== undefined && cap.maxNLoadKg !== quota
                        ? `Kvote ${formatNumber(quota)}`
                        : null
                    }
                    value={
                      <LimitValue
                        amount={limitAmount(cap.maxNLoadKg)}
                        unit="kg N"
                      />
                    }
                    changed={nLoadChangedKeys.has(key)}
                  />
                )
              })}
            </SummaryList>
          )}
        </LimitsColumn>

        <LimitsColumn title="Foderenheder" term="feedUnits">
          {editing ? (
            <div className="flex flex-col gap-2.5 pt-2.5 pb-2">
              <div>
                <FieldLabel
                  htmlFor={`${id}-min-feed-units`}
                  label="Min. foderenheder"
                />
                <UnitInput
                  id={`${id}-min-feed-units`}
                  unit="FE"
                  type="number"
                  min="0"
                  value={numberToInput(minFeedUnits)}
                  placeholder="Ingen grænse"
                  onChange={(event) => {
                    edited()
                    setMinFeedUnits(inputToOptionalNumber(event.target.value))
                  }}
                />
              </div>
              <div>
                <FieldLabel
                  htmlFor={`${id}-max-feed-units`}
                  label="Maks. foderenheder"
                />
                <UnitInput
                  id={`${id}-max-feed-units`}
                  unit="FE"
                  type="number"
                  min="0"
                  value={numberToInput(maxFeedUnits)}
                  placeholder="Ingen grænse"
                  onChange={(event) => {
                    edited()
                    setMaxFeedUnits(inputToOptionalNumber(event.target.value))
                  }}
                />
              </div>
              <RulesHint>
                Samlet for bedriften. Tomt betyder ingen grænse.
              </RulesHint>
            </div>
          ) : (
            <SummaryList>
              <SummaryRow
                label="Min."
                value={
                  <LimitValue amount={limitAmount(minFeedUnits)} unit="FE" />
                }
                changed={minFeedUnitsChanged}
              />
              <SummaryRow
                label="Maks."
                value={
                  <LimitValue amount={limitAmount(maxFeedUnits)} unit="FE" />
                }
                changed={maxFeedUnitsChanged}
              />
            </SummaryList>
          )}
        </LimitsColumn>

        <LimitsColumn title="Afgrøder">
          <CropAreaLimits
            inputs={cropInputs}
            savedLimits={constraints.cropAreaLimits}
            cropCodes={cropCodes}
            fields={fields}
            ranges={cropAreaRanges}
            totalAreaHa={totalAreaHa}
            violations={cropAreaViolations}
            showErrors={showCropAreaErrors}
            editing={editing}
            pickerOpen={cropPickerOpen}
            onPickerOpenChange={(open) => {
              if (open) setEditing(true)
              setCropPickerOpen(open)
            }}
            onChange={editCropInputs}
          />
        </LimitsColumn>
      </div>

      <div className="flex min-h-15 flex-wrap items-center gap-2.5 rounded-b-lg border-t bg-muted/30 px-5 py-3">
        <div
          role="status"
          aria-live="polite"
          className="flex min-w-0 flex-1 items-center gap-2 text-[13px]"
        >
          {isSaving ? (
            <>
              <Spinner className="size-3.5 text-primary" />
              <span className="text-muted-foreground">Gemmer…</span>
            </>
          ) : saveState.kind === 'error' ? (
            <>
              <AlertTriangle
                className="size-4 shrink-0 text-destructive"
                aria-hidden="true"
              />
              <span className="text-destructive">
                <b>Kunne ikke gemme.</b> {saveState.message}
              </span>
            </>
          ) : isDirty ? (
            <>
              <UnsavedDot />
              <span>
                Ikke gemte ændringer i{' '}
                <b>{sectionList.format(changedSections)}</b>
              </span>
            </>
          ) : saveState.kind === 'saved' ? (
            <>
              <Check
                className="size-4 shrink-0 text-primary"
                strokeWidth={2.4}
                aria-hidden="true"
              />
              <span className="font-semibold text-primary">Gemt</span>
              <span className="text-muted-foreground">
                · bruges ved næste kørsel med Gennemsnit for perioden
              </span>
            </>
          ) : (
            <>
              <Check
                className="size-4 shrink-0 text-muted-foreground"
                aria-hidden="true"
              />
              <span className="text-muted-foreground">
                Alle grænser er gemt.
              </span>
            </>
          )}
        </div>
        {canDiscard ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="text-muted-foreground"
            onClick={discard}
          >
            Fortryd
          </Button>
        ) : null}
        {isDirty || isSaving ? (
          <Button
            type="button"
            size="sm"
            disabled={isSaving}
            onClick={() => void save()}
          >
            Gem grænser
          </Button>
        ) : null}
      </div>
    </section>
  )
}
