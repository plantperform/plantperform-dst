import type { CropCodeOption } from '@/api/types'
import { FieldError } from '@/components/ui/field-error'
import { Label } from '@/components/ui/label'
import { cn } from '@/lib/utils'

export const CropExclusionList = ({
  id,
  crops,
  excludedCodes,
  onToggle,
  error,
}: {
  id: string
  crops: CropCodeOption[]
  excludedCodes: number[]
  onToggle: (code: number) => void
  error?: string
}) => {
  if (crops.length === 0) return null

  const includedCount = crops.filter(
    (crop) => !excludedCodes.includes(crop.code),
  ).length

  return (
    <div className="space-y-2">
      <div className="flex items-baseline justify-between gap-2">
        <Label id={`${id}-label`}>Afgrøder</Label>
        <span className="text-xs text-muted-foreground tabular-nums">
          {includedCount} af {crops.length} med
        </span>
      </div>
      <p className="text-xs text-muted-foreground">
        Fravælg en afgrøde for at udelukke alle sædskifter, der indeholder den
        et eller flere steder. Valget gælder kun denne kørsel.
      </p>
      <div
        role="group"
        aria-labelledby={`${id}-label`}
        aria-describedby={error ? `${id}-error` : undefined}
        className={cn(
          'max-h-48 space-y-1 overflow-y-auto rounded-md border p-2',
          error && 'border-destructive',
        )}
      >
        {crops.map((crop) => (
          <label
            key={crop.code}
            className="flex items-center gap-2 rounded px-1 py-1 text-xs hover:bg-muted/50"
          >
            <input
              type="checkbox"
              checked={!excludedCodes.includes(crop.code)}
              onChange={() => onToggle(crop.code)}
            />
            <span>{crop.name}</span>
          </label>
        ))}
      </div>
      <FieldError id={`${id}-error`} message={error} />
    </div>
  )
}
