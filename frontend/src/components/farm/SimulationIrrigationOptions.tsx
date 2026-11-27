import { useState } from 'react'

import type {
  CropCodeOption,
  FieldRecord,
  IrrigationException,
} from '@/api/types'
import { CropGroupChecklist } from '@/components/farm/CropGroupChecklist'
import { FarmSearchInput } from '@/components/farm/FarmSearchInput'
import { DisclosureButton } from '@/components/ui/disclosure-button'
import { FieldError } from '@/components/ui/field-error'
import { Label } from '@/components/ui/label'
import { LoadError } from '@/components/ui/load-error'
import { cropLabel } from '@/lib/crop-label'
import {
  fieldDisplayName,
  formatFieldCount,
  formatHectares,
} from '@/lib/field-domain'
import {
  fieldIrrigatedCropCodes,
  groupSelection,
  irrigableSoilTypes,
  toggleGroup,
  toggleValue,
  withFieldIrrigation,
} from '@/lib/simulation-form'

type Props = {
  fields: FieldRecord[]
  crops: CropCodeOption[]
  cropOptionsFor: (field: FieldRecord) => CropCodeOption[]
  cropsLoading: boolean
  cropsFailed: boolean
  onRetryCrops: () => void
  imkIds: number[]
  cropCodes: number[]
  exceptions: IrrigationException[]
  onImkIdsChange: (imkIds: number[]) => void
  onCropCodesChange: (cropCodes: number[]) => void
  onExceptionsChange: (exceptions: IrrigationException[]) => void
  error?: string
}

export function SimulationIrrigationOptions({
  fields,
  crops,
  cropOptionsFor,
  cropsLoading,
  cropsFailed,
  onRetryCrops,
  imkIds,
  cropCodes,
  exceptions,
  onImkIdsChange,
  onCropCodesChange,
  onExceptionsChange,
  error,
}: Props) {
  const [openSoilType, setOpenSoilType] = useState<number | null>(null)
  const [openField, setOpenField] = useState<number | null>(null)
  const [query, setQuery] = useState('')
  const soilTypes = irrigableSoilTypes(fields)
  const irrigableCount = soilTypes.reduce(
    (count, soilType) => count + soilType.fields.length,
    0,
  )
  const otherCount = fields.length - irrigableCount
  const search = query.trim().toLocaleLowerCase('da')
  const matches = (field: FieldRecord) =>
    fieldDisplayName(field).toLocaleLowerCase('da').includes(search)
  const noMatches =
    search !== '' && soilTypes.every(({ fields }) => !fields.some(matches))
  const chosen = imkIds.map(String)
  const choose = (next: string[]) => onImkIdsChange(next.map(Number))

  const fieldRow = (field: (typeof soilTypes)[number]['fields'][number]) => {
    const isChosen = imkIds.includes(field.imkId)
    const exception = exceptions.find(
      (candidate) => candidate.imkId === field.imkId,
    )
    const changes = exception
      ? exception.addedCropCodes.length + exception.removedCropCodes.length
      : 0
    const open = isChosen && openField === field.imkId
    const options = open ? cropOptionsFor(field) : []
    const offered = options.map((crop) => crop.code)
    const fieldCodes = fieldIrrigatedCropCodes(cropCodes, exception).filter(
      (code) => offered.includes(code),
    )
    return (
      <li key={field.id}>
        <div className="flex items-center gap-3 py-1">
          <label className="flex min-w-0 items-center gap-3">
            <input
              type="checkbox"
              checked={isChosen}
              onChange={() => choose(toggleValue(chosen, String(field.imkId)))}
            />
            <span className="truncate">{fieldDisplayName(field)}</span>
          </label>
          {isChosen ? (
            <DisclosureButton
              open={open}
              onToggle={() => setOpenField(open ? null : field.imkId)}
              label="Ret afgrøder"
              hint={changes > 0 ? `${changes} ændret` : undefined}
              className="shrink-0 text-xs font-normal text-muted-foreground"
            />
          ) : null}
          <span className="ml-auto shrink-0 text-muted-foreground tabular-nums">
            {formatHectares(field.areaHa)} ha
          </span>
        </div>
        {open ? (
          <div className="mb-2 ml-7 space-y-2 rounded-md border p-3">
            <p className="text-xs text-muted-foreground">
              {options.length === 1 && options[0].permanent
                ? `${fieldDisplayName(field)} har en permanent afgrøde, så kun den kan vandes.`
                : `Afgrøderne med flueben vandes på ${fieldDisplayName(field)}. Ændringer her gælder kun denne mark.`}
            </p>
            <ul
              aria-label={`Afgrøder der vandes på ${fieldDisplayName(field)}`}
              className="grid grid-cols-2 gap-x-4 gap-y-1"
            >
              {options.map((crop) => {
                const watered = fieldCodes.includes(crop.code)
                return (
                  <li key={crop.code}>
                    <label className="flex cursor-pointer items-start gap-2">
                      <input
                        type="checkbox"
                        className="mt-1"
                        checked={watered}
                        onChange={() =>
                          onExceptionsChange(
                            withFieldIrrigation(
                              exceptions,
                              field.imkId,
                              cropCodes,
                              offered,
                              watered
                                ? fieldCodes.filter(
                                    (code) => code !== crop.code,
                                  )
                                : [...fieldCodes, crop.code],
                            ),
                          )
                        }
                      />
                      <span>
                        {cropLabel(crop.code, crop.name)}
                        {watered !== cropCodes.includes(crop.code) ? (
                          <span className="text-muted-foreground">
                            {watered ? ' (slået til her)' : ' (slået fra her)'}
                          </span>
                        ) : null}
                      </span>
                    </label>
                  </li>
                )
              })}
            </ul>
            {exception ? (
              <button
                type="button"
                className="text-xs text-primary underline-offset-2 hover:underline focus-visible:underline focus-visible:outline-none"
                onClick={() =>
                  onExceptionsChange(
                    exceptions.filter(
                      (candidate) => candidate.imkId !== field.imkId,
                    ),
                  )
                }
              >
                Brug listen Afgrøder der vandes
              </button>
            ) : null}
          </div>
        ) : null}
      </li>
    )
  }

  return (
    <div className="space-y-6">
      <p className="text-sm text-muted-foreground">
        En vandet afgrøde på en vandingsmark regnes med normen, N-fikseringen og
        økonomien for vandet. Kun marker på JB 1-4 kan vandes, fordi vanding
        ikke ændrer normen på de andre.
      </p>

      <div className="space-y-2">
        <Label className="leading-snug">
          Vandingsmarker{' '}
          {otherCount > 0 ? (
            <span className="font-normal text-muted-foreground">
              ({formatFieldCount(otherCount)} uden for JB 1-4 vises ikke)
            </span>
          ) : null}
        </Label>
        {irrigableCount > 1 ? (
          <FarmSearchInput
            value={query}
            onChange={setQuery}
            placeholder="Søg mark"
            label="Søg i vandingsmarker"
          />
        ) : null}
        {soilTypes.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Ingen af markerne ligger på JB 1-4, så vanding ændrer ikke noget.
          </p>
        ) : (
          <ul className="rounded-md border px-2 py-1 text-sm">
            {soilTypes.map(({ soilTypeNumber, fields: soilFields }) => {
              const keys = soilFields.map((field) => String(field.imkId))
              const selection = groupSelection(chosen, keys)
              const chosenCount = keys.filter((key) =>
                chosen.includes(key),
              ).length
              const shown =
                search === '' ? soilFields : soilFields.filter(matches)
              if (shown.length === 0) return null
              const open = search !== '' || openSoilType === soilTypeNumber
              const listId = `irrigation-jb-${soilTypeNumber}`
              return (
                <li key={soilTypeNumber} className="border-t first:border-t-0">
                  <div className="flex items-center gap-3 px-1">
                    <input
                      type="checkbox"
                      aria-label={`Alle marker på JB ${soilTypeNumber}`}
                      checked={selection === 'all'}
                      ref={(input) => {
                        if (input) input.indeterminate = selection === 'some'
                      }}
                      onChange={() => choose(toggleGroup(chosen, keys))}
                    />
                    <DisclosureButton
                      open={open}
                      onToggle={() =>
                        setOpenSoilType(open ? null : soilTypeNumber)
                      }
                      aria-controls={listId}
                      label={`JB ${soilTypeNumber}`}
                      trailing={
                        <span className="text-xs font-normal text-muted-foreground tabular-nums">
                          {selection === 'some'
                            ? `${chosenCount} af ${formatFieldCount(keys.length)}`
                            : formatFieldCount(keys.length)}
                        </span>
                      }
                      className="min-w-0 flex-1 py-2"
                    />
                  </div>
                  {open ? (
                    <ul
                      id={listId}
                      className="mb-2 ml-2 max-h-72 overflow-y-auto border-l pl-4"
                    >
                      {shown.map(fieldRow)}
                    </ul>
                  ) : null}
                </li>
              )
            })}
          </ul>
        )}
        {noMatches ? (
          <p className="text-sm text-muted-foreground">
            Ingen marker matcher søgningen.
          </p>
        ) : null}
      </div>

      {imkIds.length > 0 ? (
        <div className="space-y-2">
          <Label className="leading-snug">Afgrøder der vandes</Label>
          <p className="text-sm text-muted-foreground">
            Gælder alle valgte marker. Med Ret afgrøder ved en mark kan du slå
            en afgrøde til eller fra på netop den mark.
          </p>
          {cropsFailed ? (
            <LoadError
              message="Kunne ikke hente afgrøder."
              onRetry={onRetryCrops}
            />
          ) : null}
          {cropsLoading ? (
            <p className="text-sm text-muted-foreground">Henter afgrøder...</p>
          ) : null}
          <div className="max-h-72 overflow-y-auto rounded-md border p-2">
            <CropGroupChecklist
              label="Afgrøder der vandes"
              items={crops.map((crop) => ({
                key: String(crop.code),
                code: crop.code,
                name: crop.name,
              }))}
              selected={cropCodes.map(String)}
              onChange={(selected) => onCropCodesChange(selected.map(Number))}
            />
          </div>
          <FieldError id="simulation-irrigation-error" message={error} />
        </div>
      ) : null}
    </div>
  )
}
