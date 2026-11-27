import type { CropCodeOption, FieldRecord } from '@/api/types'
import { CropGroupChecklist } from '@/components/farm/CropGroupChecklist'
import { FieldError } from '@/components/ui/field-error'
import { Label } from '@/components/ui/label'
import { LoadError } from '@/components/ui/load-error'
import {
  fieldDisplayName,
  formatFieldCount,
  formatHectares,
} from '@/lib/field-domain'
import {
  groupSelection,
  irrigableFields,
  toggleGroup,
  toggleValue,
} from '@/lib/simulation-form'

type Props = {
  fields: FieldRecord[]
  crops: CropCodeOption[]
  cropsLoading: boolean
  cropsFailed: boolean
  onRetryCrops: () => void
  imkIds: number[]
  cropCodes: number[]
  onImkIdsChange: (imkIds: number[]) => void
  onCropCodesChange: (cropCodes: number[]) => void
  error?: string
}

export function SimulationIrrigationOptions({
  fields,
  crops,
  cropsLoading,
  cropsFailed,
  onRetryCrops,
  imkIds,
  cropCodes,
  onImkIdsChange,
  onCropCodesChange,
  error,
}: Props) {
  const irrigable = irrigableFields(fields)
  const otherCount = fields.length - irrigable.length
  const keys = irrigable.map((field) => String(field.imkId))
  const chosen = imkIds.map(String)
  const choose = (next: string[]) => onImkIdsChange(next.map(Number))

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
        {irrigable.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Ingen af markerne ligger på JB 1-4, så vanding ændrer ikke noget.
          </p>
        ) : (
          <div className="max-h-72 overflow-y-auto rounded-md border p-2 text-sm">
            {irrigable.length > 1 ? (
              <label className="flex items-center gap-3 border-b px-1 pb-2 font-medium">
                <input
                  type="checkbox"
                  checked={groupSelection(chosen, keys) === 'all'}
                  ref={(input) => {
                    if (input)
                      input.indeterminate =
                        groupSelection(chosen, keys) === 'some'
                  }}
                  onChange={() => choose(toggleGroup(chosen, keys))}
                />
                Alle {irrigable.length} marker
              </label>
            ) : null}
            <ul className={irrigable.length > 1 ? 'pt-1' : undefined}>
              {irrigable.map((field) => (
                <li key={field.id}>
                  <label className="grid grid-cols-[auto_minmax(0,1fr)_auto_auto] items-center gap-3 px-1 py-1">
                    <input
                      type="checkbox"
                      checked={imkIds.includes(field.imkId)}
                      onChange={() =>
                        choose(toggleValue(chosen, String(field.imkId)))
                      }
                    />
                    <span className="truncate">{fieldDisplayName(field)}</span>
                    <span className="text-muted-foreground tabular-nums">
                      {formatHectares(field.areaHa)} ha
                    </span>
                    <span className="text-muted-foreground tabular-nums">
                      JB {field.soilTypeNumber}
                    </span>
                  </label>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>

      {imkIds.length > 0 ? (
        <div className="space-y-2">
          <Label className="leading-snug">Afgrøder der vandes</Label>
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
