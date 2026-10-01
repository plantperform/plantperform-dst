import { Plus, X } from 'lucide-react'
import { useMemo, useState } from 'react'

import type {
  CropAreaLimit,
  CropAreaRange,
  CropCodeOption,
  FieldRecord,
} from '@/api/types'
import { CropGroupTile } from '@/components/farm/CropGroupTile'
import {
  LimitValue,
  RulesHint,
  RulesNotice,
  SummaryList,
  SummaryRow,
} from '@/components/farm/rules-ui'
import { SearchableCropPickerList } from '@/components/farm/SearchableCropPickerList'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'
import {
  SegmentedControl,
  type SegmentedControlOption,
} from '@/components/ui/segmented-control'
import {
  cropAreaLimitError,
  cropAreaLimitFromDraft,
  cropAreaLimitParts,
  cropAreaLimitWarning,
  cropAreaRangeError,
  cropAreaRangeWarnings,
  cropAreaViolationMessage,
  currentCropAreaHa,
  currentCropAreaLabel,
  emptyCropAreaLimitInput,
  fieldAreaSums,
  formatAreaHa,
  hectareDraft,
  isEmptyCropAreaLimit,
  type AreaUnit,
  type CropAreaLimitInput,
  type CropAreaViolation,
} from '@/lib/crop-area-limits'
import { cropGroupColor, cropGroupFor } from '@/lib/crop-groups'
import { cn } from '@/lib/utils'

const NO_LIMITS_TEXT = 'Ingen krav endnu'

const UNIT_OPTIONS: SegmentedControlOption<AreaUnit>[] = [
  { value: 'ha', label: 'ha', activeClassName: 'text-foreground' },
  { value: '%', label: '%', activeClassName: 'text-foreground' },
]

const sameLimit = (left: CropAreaLimit, right: CropAreaLimit | undefined) =>
  right !== undefined &&
  left.minAreaHa === right.minAreaHa &&
  left.maxAreaHa === right.maxAreaHa

type CropAreaLimitsProps = {
  inputs: CropAreaLimitInput[]
  savedLimits: CropAreaLimit[]
  cropCodes: CropCodeOption[]
  fields: FieldRecord[]
  ranges: CropAreaRange[]
  totalAreaHa: number
  violations: CropAreaViolation[]
  showErrors: boolean
  editing: boolean
  pickerOpen: boolean
  onPickerOpenChange: (open: boolean) => void
  onChange: (inputs: CropAreaLimitInput[]) => void
}

export const CropAreaLimits = ({
  inputs,
  savedLimits,
  cropCodes,
  fields,
  ranges,
  totalAreaHa,
  violations,
  showErrors,
  editing,
  pickerOpen,
  onPickerOpenChange,
  onChange,
}: CropAreaLimitsProps) => {
  const [touchedCodes, setTouchedCodes] = useState<ReadonlySet<number>>(
    () => new Set(),
  )

  const nameByCode = useMemo(
    () => new Map(cropCodes.map((crop) => [crop.code, crop.name])),
    [cropCodes],
  )
  const sums = useMemo(() => fieldAreaSums(fields), [fields])
  const rangeByCode = new Map(ranges.map((range) => [range.cropCode, range]))
  const violationByCode = new Map(
    violations.map((violation) => [violation.cropCode, violation]),
  )
  const savedByCode = new Map(
    savedLimits.map((limit) => [limit.cropCode, limit]),
  )

  const pickerItems = useMemo(() => {
    const limitedCodes = new Set(inputs.map((input) => input.cropCode))
    return cropCodes
      .filter((crop) => !limitedCodes.has(crop.code))
      .map((crop) => ({
        key: String(crop.code),
        label: crop.name,
        title: `${crop.name} (${crop.code})`,
        colors: [cropGroupColor(crop.code, crop.name)],
        icon: <CropGroupTile group={cropGroupFor(crop.code, crop.name)} />,
        meta: currentCropAreaLabel(currentCropAreaHa(fields, crop.code)),
      }))
  }, [cropCodes, inputs, fields])

  const markTouched = (cropCode: number, touched: boolean) =>
    setTouchedCodes((current) => {
      const next = new Set(current)
      if (touched) next.add(cropCode)
      else next.delete(cropCode)
      return next
    })

  const addCrop = (key: string) => {
    onChange([...inputs, emptyCropAreaLimitInput(Number(key))])
    onPickerOpenChange(false)
  }

  const replaceInput = (index: number, next: CropAreaLimitInput) =>
    onChange(inputs.map((current, i) => (i === index ? next : current)))

  const removeInput = (index: number) => {
    markTouched(inputs[index].cropCode, false)
    onChange(inputs.filter((_, i) => i !== index))
  }

  const rows = inputs.map((input) => {
    const name =
      nameByCode.get(input.cropCode) ?? `Afgrødekode ${input.cropCode}`
    const draft = hectareDraft(input, totalAreaHa)
    const range = rangeByCode.get(input.cropCode)
    const limitError =
      showErrors ||
      touchedCodes.has(input.cropCode) ||
      !isEmptyCropAreaLimit(draft)
        ? cropAreaLimitError(draft)
        : null
    const violation = violationByCode.get(input.cropCode)
    const wholeFieldWarning = cropAreaLimitWarning(draft, totalAreaHa, sums)
    return {
      input,
      name,
      group: cropGroupFor(input.cropCode, name),
      current: currentCropAreaLabel(currentCropAreaHa(fields, input.cropCode)),
      changed: !sameLimit(
        cropAreaLimitFromDraft(draft),
        savedByCode.get(input.cropCode),
      ),
      errors: [
        limitError ?? cropAreaRangeError(draft, range),
        violation ? cropAreaViolationMessage(violation) : null,
      ].filter((message): message is string => message !== null),
      warnings: [
        ...cropAreaRangeWarnings(draft, range),
        ...(wholeFieldWarning ? [wholeFieldWarning] : []),
      ],
    }
  })

  const notices = (
    row: (typeof rows)[number],
    idPrefix: string,
    className?: string,
  ) =>
    row.errors.length > 0 || row.warnings.length > 0 ? (
      <div id={`${idPrefix}-notices`} className={cn('space-y-1', className)}>
        {row.errors.map((message) => (
          <RulesNotice key={message} tone="error">
            {message}
          </RulesNotice>
        ))}
        {row.warnings.map((message) => (
          <RulesNotice key={message} tone="warning">
            {message}
          </RulesNotice>
        ))}
      </div>
    ) : null

  if (!editing) {
    return rows.length === 0 ? (
      <div className="mt-1.5 flex items-center justify-between gap-2 py-1.5">
        <span className="text-[13px] text-muted-foreground">
          {NO_LIMITS_TEXT}
        </span>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="-mr-3 gap-1.5 text-primary hover:text-primary"
          onClick={() => onPickerOpenChange(true)}
        >
          <Plus className="size-3.5" aria-hidden="true" />
          Tilføj afgrøde
        </Button>
      </div>
    ) : (
      <SummaryList>
        {rows.map((row) => {
          const parts = cropAreaLimitParts(row.input)
          return (
            <SummaryRow
              key={row.input.cropCode}
              icon={
                <CropGroupTile
                  group={row.group}
                  title={row.group.label}
                  className="mt-px"
                />
              }
              label={row.name}
              note={row.current}
              value={
                parts ? (
                  <LimitValue {...parts} />
                ) : (
                  <span className="text-[13px] text-muted-foreground">
                    Intet spænd endnu
                  </span>
                )
              }
              changed={row.changed}
            >
              {notices(row, `rules-crop-${row.input.cropCode}`, 'mt-1.25')}
            </SummaryRow>
          )
        })}
      </SummaryList>
    )
  }

  return (
    <div className="flex flex-col gap-2 pt-2.5 pb-2">
      {rows.map((row, index) => {
        const idPrefix = `rules-crop-${row.input.cropCode}`
        const describedBy =
          row.errors.length > 0 || row.warnings.length > 0
            ? `${idPrefix}-notices`
            : undefined
        return (
          <div
            key={row.input.cropCode}
            className="rounded-md border px-3 py-2.5"
          >
            <div className="flex items-center justify-between gap-2">
              <div className="flex min-w-0 gap-2">
                <CropGroupTile
                  group={row.group}
                  title={row.group.label}
                  size="lg"
                />
                <div className="min-w-0">
                  <div className="truncate text-[13px] font-semibold">
                    {row.name}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {row.current}
                  </div>
                </div>
              </div>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="size-7 shrink-0 text-muted-foreground"
                aria-label={`Fjern kravet til ${row.name}`}
                onClick={() => removeInput(index)}
              >
                <X className="size-3.5" aria-hidden="true" />
              </Button>
            </div>
            <div
              role="group"
              aria-label={`Areal for ${row.name}`}
              className="mt-2 grid grid-cols-[minmax(0,1fr)_12px_minmax(0,1fr)_auto] items-center gap-1.5"
              onBlur={(event) => {
                if (!event.currentTarget.contains(event.relatedTarget)) {
                  markTouched(row.input.cropCode, true)
                }
              }}
            >
              <Input
                type="number"
                min="0"
                step="any"
                value={row.input.min}
                placeholder="Min."
                aria-label={`Min. for ${row.name} i ${row.input.unit}`}
                aria-describedby={describedBy}
                className="h-9 px-2.5"
                onChange={(event) =>
                  replaceInput(index, { ...row.input, min: event.target.value })
                }
              />
              <span
                aria-hidden="true"
                className="text-center text-muted-foreground"
              >
                –
              </span>
              <Input
                type="number"
                min="0"
                step="any"
                value={row.input.max}
                placeholder="Maks."
                aria-label={`Maks. for ${row.name} i ${row.input.unit}`}
                aria-describedby={describedBy}
                className="h-9 px-2.5"
                onChange={(event) =>
                  replaceInput(index, { ...row.input, max: event.target.value })
                }
              />
              <SegmentedControl
                aria-label={`Enhed for ${row.name}`}
                value={row.input.unit}
                options={UNIT_OPTIONS}
                labelClassName=""
                className="h-9"
                optionClassName="h-7 px-2.5"
                onValueChange={(unit) =>
                  replaceInput(index, { ...row.input, unit })
                }
              />
            </div>
            {notices(row, idPrefix, 'mt-2')}
          </div>
        )
      })}
      {rows.length === 0 ? (
        <p className="text-[13px] text-muted-foreground">{NO_LIMITS_TEXT}</p>
      ) : null}
      <Popover open={pickerOpen} onOpenChange={onPickerOpenChange}>
        <PopoverTrigger asChild>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="w-full gap-1.5 border-dashed bg-transparent text-primary hover:border-primary hover:text-primary"
          >
            <Plus className="size-3.5" aria-hidden="true" />
            Tilføj afgrøde
          </Button>
        </PopoverTrigger>
        <PopoverContent
          align="start"
          className="w-(--radix-popover-trigger-width) min-w-64"
        >
          <SearchableCropPickerList
            items={pickerItems}
            selectedKey={null}
            onSelect={addCrop}
            searchLabel="Søg afgrøde"
            searchPlaceholder="Søg afgrøde…"
            emptyMessage={
              cropCodes.length === 0
                ? 'Simuleringen har ingen afgrøder.'
                : 'Ingen afgrøder matcher.'
            }
            maxHeightClassName="max-h-[200px]"
          />
        </PopoverContent>
      </Popover>
      <RulesHint>
        I hektar eller procent af {formatAreaHa(totalAreaHa)} ha. Marker deles
        ikke, så giv hellere et spænd end et præcist tal.
      </RulesHint>
    </div>
  )
}
