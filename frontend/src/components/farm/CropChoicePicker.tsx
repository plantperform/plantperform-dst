import type { FarmingSystem, RotationCategoryOption } from '@/api/types'
import { FieldError } from '@/components/ui/field-error'
import {
  cropsForFarmingSystem,
  matchingRotationCount,
  otherCrops,
  toggleValue,
  type CropChoice,
} from '@/lib/simulation-form'

type CropChoicePickerProps = {
  categories: RotationCategoryOption[]
  farmingSystem: FarmingSystem
  choice: CropChoice
  onChoiceChange: (choice: CropChoice) => void
  error?: string
}

const CropCheckboxes = ({
  label,
  crops,
  isChecked,
  onToggle,
}: {
  label: string
  crops: string[]
  isChecked: (crop: string) => boolean
  onToggle: (crop: string) => void
}) => (
  <ul
    aria-label={label}
    className="grid grid-cols-2 gap-x-4 gap-y-1.5 sm:grid-cols-3"
  >
    {crops.map((crop) => (
      <li key={crop}>
        <label className="flex cursor-pointer items-start gap-2 text-sm">
          <input
            type="checkbox"
            className="mt-1"
            checked={isChecked(crop)}
            onChange={() => onToggle(crop)}
          />
          {crop}
        </label>
      </li>
    ))}
  </ul>
)

const matchingLabel = (count: number) =>
  `${count || 'Ingen'} ${count === 1 ? 'sædskifte' : 'sædskifter'} passer til valget`

export const CropChoicePicker = ({
  categories,
  farmingSystem,
  choice,
  onChoiceChange,
  error,
}: CropChoicePickerProps) => {
  const others = otherCrops(categories, choice.chosenCrops)

  return (
    <div className="space-y-5">
      <div className="space-y-3">
        <div>
          <div className="flex items-baseline justify-between gap-4">
            <h3 className="text-sm font-medium">Afgrøder</h3>
            <p
              className="shrink-0 text-xs text-muted-foreground tabular-nums"
              aria-live="polite"
            >
              {choice.chosenCrops.length > 0
                ? matchingLabel(matchingRotationCount(categories, choice))
                : null}
            </p>
          </div>
          <p className="text-xs text-muted-foreground">
            Vælg de afgrøder, bedriften vil dyrke. Næste trin viser de
            sædskifter, der har mindst en af dem.
          </p>
        </div>
        <FieldError id="crop-choice-error" message={error} />
        <CropCheckboxes
          label="Afgrøder"
          crops={cropsForFarmingSystem(categories, farmingSystem)}
          isChecked={(crop) => choice.chosenCrops.includes(crop)}
          onToggle={(crop) =>
            onChoiceChange({
              ...choice,
              chosenCrops: toggleValue(choice.chosenCrops, crop),
            })
          }
        />
      </div>

      {others.length > 0 ? (
        <div className="space-y-3 border-t pt-4">
          <div>
            <h3 className="text-sm font-medium">Fravælg afgrøder</h3>
            <p className="text-xs text-muted-foreground">
              De passende sædskifter har også disse afgrøder. Sæt flueben ved de
              afgrøder, bedriften ikke vil dyrke. Så vises sædskifter med dem
              ikke.
            </p>
          </div>
          <CropCheckboxes
            label="Fravælg afgrøder"
            crops={others}
            isChecked={(crop) => choice.optedOutCrops.includes(crop)}
            onToggle={(crop) =>
              onChoiceChange({
                ...choice,
                optedOutCrops: toggleValue(choice.optedOutCrops, crop),
              })
            }
          />
        </div>
      ) : null}
    </div>
  )
}
