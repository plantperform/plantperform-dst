import type {
  CropCodeOption,
  FarmingSystem,
  RotationCategoryOption,
} from '@/api/types'
import { CropGroupChecklist } from '@/components/farm/CropGroupChecklist'
import { FieldError } from '@/components/ui/field-error'
import { cropCodeByName } from '@/lib/crop-label'
import {
  cropsForFarmingSystem,
  matchingRotationCount,
  type CropChoice,
} from '@/lib/simulation-form'

type CropChoicePickerProps = {
  categories: RotationCategoryOption[]
  cropCodes: readonly CropCodeOption[]
  farmingSystem: FarmingSystem
  choice: CropChoice
  onChoiceChange: (choice: CropChoice) => void
  error?: string
}

const matchingLabel = (count: number) =>
  `${count || 'Ingen'} ${count === 1 ? 'sædskifte' : 'sædskifter'} passer til valget`

export const CropChoicePicker = ({
  categories,
  cropCodes,
  farmingSystem,
  choice,
  onChoiceChange,
  error,
}: CropChoicePickerProps) => (
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
        Vælg de afgrøder, bedriften vil dyrke. Afgrøder uden flueben er
        fravalgt. Næste trin viser de sædskifter, hvor alle afgrøderne har
        flueben.
      </p>
    </div>
    <FieldError id="crop-choice-error" message={error} />
    <CropGroupChecklist
      label="Afgrøder"
      items={cropsForFarmingSystem(categories, farmingSystem).map((name) => ({
        key: name,
        code: cropCodeByName(name, cropCodes),
        name,
      }))}
      selected={choice.chosenCrops}
      onChange={(chosenCrops) => onChoiceChange({ ...choice, chosenCrops })}
    />
  </div>
)
