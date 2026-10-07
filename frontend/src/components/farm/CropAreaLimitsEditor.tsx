import { Plus, X } from 'lucide-react'
import { Fragment, useMemo, useState } from 'react'

import type { CropAreaRange, CropCodeOption, FieldRecord } from '@/api/types'
import { CropGroupIcon, CropGroupTile } from '@/components/farm/CropGroupTile'
import { SearchableCropPickerList } from '@/components/farm/SearchableCropPickerList'
import { AppTooltip, TruncatedTooltip } from '@/components/ui/app-tooltip'
import { Button } from '@/components/ui/button'
import { FieldError } from '@/components/ui/field-error'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'
import {
  cropAreaLimitError,
  cropAreaLimitWarning,
  cropAreaRangeError,
  cropAreaRangeWarnings,
  cropAreaViolationMessage,
  currentCropArea,
  currentCropAreaLabel,
  emptyCropAreaLimitDraft,
  fieldAreaSums,
  formatAreaHa,
  isEmptyCropAreaLimit,
  possibleCropArea,
  percentRangeLabel,
  possibleCropAreaLabel,
  withHectares,
  type AreaBound,
  type CropAreaLimitDraft,
  type CropAreaViolation,
} from '@/lib/crop-area-limits'
import {
  cropEdgeColor,
  cropGroupColor,
  cropGroupFor,
  readableTextColor,
} from '@/lib/crop-groups'
import { cn } from '@/lib/utils'

const BOUND_NAMES: Record<AreaBound, string> = {
  min: 'Minimum',
  max: 'Maksimum',
}

type AreaRangeInputProps = {
  idPrefix: string
  cropName: string
  minHa: string
  maxHa: string
  percentLabel: string | null
  describedBy?: string
  onChange: (bound: AreaBound, value: string) => void
  onLeave: () => void
}

const AreaRangeInput = ({
  idPrefix,
  cropName,
  minHa,
  maxHa,
  percentLabel,
  describedBy,
  onChange,
  onLeave,
}: AreaRangeInputProps) => (
  <div>
    <div
      role="group"
      aria-label={`Areal for ${cropName} i hektar`}
      className="flex h-8 items-center rounded-md border bg-background pr-2 focus-within:ring-2 focus-within:ring-ring"
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) onLeave()
      }}
    >
      {(['min', 'max'] as const).map((bound) => (
        <Fragment key={bound}>
          {bound === 'max' ? (
            <span className="px-1 text-muted-foreground" aria-hidden="true">
              –
            </span>
          ) : null}
          <input
            id={`${idPrefix}-${bound}`}
            type="number"
            min="0"
            step="any"
            value={bound === 'min' ? minHa : maxHa}
            placeholder={bound === 'min' ? 'min' : 'maks'}
            aria-label={`${BOUND_NAMES[bound]} i hektar`}
            aria-describedby={describedBy}
            className="h-full w-16 bg-transparent px-2 text-center text-sm tabular-nums placeholder:text-muted-foreground focus-visible:outline-none"
            onChange={(event) => onChange(bound, event.target.value)}
          />
        </Fragment>
      ))}
      <span className="text-xs text-muted-foreground">ha</span>
    </div>
    <p className="h-4 text-center text-[11px] leading-4 tabular-nums text-muted-foreground">
      {percentLabel}
    </p>
  </div>
)

type CropAreaLimitsEditorProps = {
  drafts: CropAreaLimitDraft[]
  cropCodes: CropCodeOption[]
  fields: FieldRecord[]
  ranges: CropAreaRange[]
  totalAreaHa: number
  violations: CropAreaViolation[]
  showErrors: boolean
  onChange: (drafts: CropAreaLimitDraft[]) => void
}

export const CropAreaLimitsEditor = ({
  drafts,
  cropCodes,
  fields,
  ranges,
  totalAreaHa,
  violations,
  showErrors,
  onChange,
}: CropAreaLimitsEditorProps) => {
  const [isPicking, setIsPicking] = useState(false)
  const [touchedCodes, setTouchedCodes] = useState<ReadonlySet<number>>(
    () => new Set(),
  )

  const nameByCode = useMemo(
    () => new Map(cropCodes.map((crop) => [crop.code, crop.name])),
    [cropCodes],
  )
  const sums = useMemo(() => fieldAreaSums(fields), [fields])
  const rangeByCode = useMemo(
    () => new Map(ranges.map((range) => [range.cropCode, range])),
    [ranges],
  )
  const violationByCode = new Map(
    violations.map((violation) => [violation.cropCode, violation]),
  )

  const pickerItems = useMemo(() => {
    const limitedCodes = new Set(drafts.map((draft) => draft.cropCode))
    return cropCodes
      .filter((crop) => !limitedCodes.has(crop.code))
      .map((crop) => {
        const range = rangeByCode.get(crop.code)
        return {
          key: String(crop.code),
          label: crop.name,
          title: `${crop.name} (${crop.code})`,
          colors: [cropGroupColor(crop.code, crop.name)],
          icon: <CropGroupTile group={cropGroupFor(crop.code, crop.name)} />,
          meta: range
            ? `${crop.code} · højst ${formatAreaHa(possibleCropArea(range).highestMinHa)} ha`
            : String(crop.code),
        }
      })
  }, [cropCodes, drafts, rangeByCode])

  const addCrop = (key: string) => {
    onChange([...drafts, emptyCropAreaLimitDraft(Number(key))])
    setIsPicking(false)
  }

  const replaceDraft = (index: number, next: CropAreaLimitDraft) =>
    onChange(drafts.map((current, i) => (i === index ? next : current)))

  const markTouched = (cropCode: number, touched: boolean) =>
    setTouchedCodes((current) => {
      const next = new Set(current)
      if (touched) next.add(cropCode)
      else next.delete(cropCode)
      return next
    })

  const removeDraft = (index: number) => {
    markTouched(drafts[index].cropCode, false)
    onChange(drafts.filter((_, i) => i !== index))
  }

  return (
    <section className="space-y-3" aria-labelledby="rules-crop-area-heading">
      <div className="flex flex-wrap items-center gap-2">
        <h3
          id="rules-crop-area-heading"
          className="mr-auto text-sm font-semibold"
        >
          Afgrøder
        </h3>
        <Popover open={isPicking} onOpenChange={setIsPicking}>
          <PopoverTrigger asChild>
            <Button type="button" variant="outline" size="xs">
              <Plus className="h-4 w-4" aria-hidden="true" />
              Tilføj afgrøde
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-80 max-w-[calc(100vw-2rem)]">
            <SearchableCropPickerList
              items={pickerItems}
              selectedKey={null}
              onSelect={addCrop}
              searchLabel="Søg i simuleringens afgrøder"
              searchPlaceholder="Søg i afgrøder..."
              emptyMessage={
                cropCodes.length === 0
                  ? 'Simuleringen har ingen afgrøder'
                  : 'Ingen afgrøder matcher søgningen'
              }
            />
          </PopoverContent>
        </Popover>
      </div>
      <p className="text-xs text-muted-foreground">
        Hvor meget der mindst og højst skal dyrkes af en afgrøde. Procent er af
        simuleringens samlede areal
        {totalAreaHa > 0 ? ` på ${formatAreaHa(totalAreaHa)} ha` : ''}. Marker
        deles ikke, så giv hellere kravet et spænd end et præcist tal.
      </p>

      {drafts.length === 0 ? (
        <p className="text-xs text-muted-foreground">
          Ingen afgrøder har et krav endnu.
        </p>
      ) : (
        <ul className="divide-y overflow-hidden rounded-lg border bg-background">
          {drafts.map((draft, index) => {
            const idPrefix = `rules-crop-area-${draft.cropCode}`
            const name =
              nameByCode.get(draft.cropCode) ?? `Afgrødekode ${draft.cropCode}`
            const error =
              showErrors ||
              touchedCodes.has(draft.cropCode) ||
              !isEmptyCropAreaLimit(draft)
                ? cropAreaLimitError(draft)
                : null
            const range = rangeByCode.get(draft.cropCode)
            const wholeFieldWarning = cropAreaLimitWarning(
              draft,
              totalAreaHa,
              sums,
            )
            const warnings = [
              ...cropAreaRangeWarnings(draft, range),
              ...(wholeFieldWarning ? [wholeFieldWarning] : []),
            ]
            const warning = warnings.length > 0
            const rangeError = cropAreaRangeError(draft, range)
            const possible = range ? possibleCropArea(range) : null
            const group = cropGroupFor(draft.cropCode, name)
            const violation = violationByCode.get(draft.cropCode)
            const errorId = `${idPrefix}-error`
            const warningId = `${idPrefix}-warning`
            const violationId = `${idPrefix}-violation`
            const describedBy =
              [
                error || rangeError ? errorId : null,
                warning ? warningId : null,
                violation ? violationId : null,
              ]
                .filter(Boolean)
                .join(' ') || undefined
            return (
              <li
                key={draft.cropCode}
                className={cn('flex', violation && 'bg-destructive/5')}
              >
                <AppTooltip content={group.label}>
                  <span
                    role="img"
                    aria-label={group.label}
                    className="flex w-11 shrink-0 items-center justify-center"
                    style={{
                      backgroundColor: group.color,
                      color: readableTextColor(group.color),
                      boxShadow: `inset 0 0 0 1px ${cropEdgeColor(group.color)}`,
                    }}
                  >
                    <CropGroupIcon group={group} className="size-6" />
                  </span>
                </AppTooltip>
                <div className="flex min-w-0 flex-1 flex-wrap items-start gap-x-4 gap-y-1 px-3 py-2">
                  <div className="min-w-0 flex-1 basis-40">
                    <div className="flex h-8 min-w-0 items-center gap-2">
                      <TruncatedTooltip
                        content={name}
                        className="truncate text-sm font-medium"
                      >
                        {name}
                      </TruncatedTooltip>
                      <span className="shrink-0 text-xs text-muted-foreground">
                        · {draft.cropCode}
                      </span>
                    </div>
                    <p className="text-[11px] leading-4 text-muted-foreground">
                      {currentCropAreaLabel(
                        currentCropArea(fields, draft.cropCode),
                      )}
                      {possible
                        ? ` · ${possibleCropAreaLabel(possible)}`
                        : null}
                    </p>
                  </div>
                  <div>
                    <AreaRangeInput
                      idPrefix={idPrefix}
                      cropName={name}
                      minHa={draft.minHa}
                      maxHa={draft.maxHa}
                      percentLabel={percentRangeLabel(draft, totalAreaHa)}
                      describedBy={describedBy}
                      onChange={(bound, value) =>
                        replaceDraft(index, withHectares(draft, bound, value))
                      }
                      onLeave={() => markTouched(draft.cropCode, true)}
                    />
                  </div>
                  {error || rangeError || warning || violation ? (
                    <div className="basis-full space-y-0.5">
                      {rangeError && !error ? (
                        <div
                          id={errorId}
                          className="flex flex-wrap items-center gap-x-2 gap-y-1"
                        >
                          <p className="text-xs font-medium text-destructive">
                            {rangeError.message}
                          </p>
                          <Button
                            type="button"
                            variant="outline"
                            size="xs"
                            className="h-6 px-2 text-xs"
                            onClick={() =>
                              replaceDraft(
                                index,
                                withHectares(
                                  draft,
                                  rangeError.fix.bound,
                                  String(rangeError.fix.areaHa),
                                ),
                              )
                            }
                          >
                            {rangeError.fix.label}
                          </Button>
                        </div>
                      ) : (
                        <FieldError id={errorId} message={error} />
                      )}
                      {warning ? (
                        <div
                          id={warningId}
                          className="space-y-0.5 text-xs font-medium text-warning-strong"
                        >
                          {warnings.map((text) => (
                            <p key={text}>{text}</p>
                          ))}
                        </div>
                      ) : null}
                      <FieldError
                        id={violationId}
                        message={
                          violation ? cropAreaViolationMessage(violation) : null
                        }
                      />
                    </div>
                  ) : null}
                </div>
                <div className="flex items-center pr-2">
                  <Button
                    type="button"
                    variant="ghost"
                    size="xs"
                    className="w-8 px-0"
                    aria-label={`Fjern kravet til ${name}`}
                    onClick={() => removeDraft(index)}
                  >
                    <X className="h-4 w-4" aria-hidden="true" />
                  </Button>
                </div>
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}
