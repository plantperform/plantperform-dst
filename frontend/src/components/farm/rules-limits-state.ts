import { useState } from 'react'
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

export const useRulesLimits = (
  farmId: string,
  simulation: Simulation,
  fields: FieldRecord[],
) => {
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
  const isSaving = saveState.kind === 'saving'

  const edited = () => {
    if (!isSaving) setSaveState({ kind: 'idle' })
  }

  const editMaxNLoadInput = (key: string, value: string) => {
    edited()
    setMaxNLoadInputs((current) => ({ ...current, [key]: value }))
  }

  const editMinFeedUnits = (value: number | null) => {
    edited()
    setMinFeedUnits(value)
  }

  const editMaxFeedUnits = (value: number | null) => {
    edited()
    setMaxFeedUnits(value)
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

  const save = async (): Promise<boolean> => {
    if (hasCropAreaLimitErrors) {
      setShowCropAreaErrors(true)
      setEditing(true)
      setSaveState({
        kind: 'error',
        message: 'Ret kravene under Afgrøder, før du gemmer.',
      })
      return false
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
      return true
    } catch (error) {
      setSaveState({
        kind: 'error',
        message:
          error instanceof ApiError && error.status === 422
            ? error.message
            : SAVE_FAILED_MESSAGE,
      })
      return false
    }
  }

  return {
    catchments,
    quotaByKey,
    totalAreaHa,
    cropCodes,
    cropAreaRanges,
    cropAreaViolations,
    savedCropAreaLimits: constraints.cropAreaLimits,
    editing,
    setEditing,
    cropPickerOpen,
    setCropPickerOpen,
    minFeedUnits,
    maxFeedUnits,
    maxNLoadInputs,
    cropInputs,
    showCropAreaErrors,
    saveState,
    maxNLoadByCatchment,
    nLoadChangedKeys,
    minFeedUnitsChanged,
    maxFeedUnitsChanged,
    changedSectionsLabel: sectionList.format(changedSections),
    isDirty,
    isSaving,
    canDiscard: !isSaving && (isDirty || saveState.kind === 'error'),
    editMaxNLoadInput,
    editMinFeedUnits,
    editMaxFeedUnits,
    editCropInputs,
    discard,
    save,
  }
}

export type RulesLimits = ReturnType<typeof useRulesLimits>
