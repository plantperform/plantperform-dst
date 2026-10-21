import { AlertTriangle } from 'lucide-react'
import { useState } from 'react'

import type { FarmingSystem, RotationCategoryOption } from '@/api/types'
import {
  CHOICE_TAB_ACTIVE_CLASS,
  CHOICE_TAB_CLASS,
  CHOICE_TAB_IDLE_CLASS,
} from '@/components/farm/choice-styles'
import { Button } from '@/components/ui/button'
import { FieldError } from '@/components/ui/field-error'
import {
  categoriesMatchingCropChoice,
  farmingSystemMismatchCount,
  farmingSystemMismatchMessage,
  orderCategoriesForFarmingSystem,
  selectedInCategory,
  setRotationsSelected,
  toggleValue,
  type CropChoice,
} from '@/lib/simulation-form'
import { cn } from '@/lib/utils'

type RotationPickerProps = {
  categories: RotationCategoryOption[]
  farmingSystem: FarmingSystem
  cropChoice: CropChoice
  rotationVariants: string[]
  onRotationVariantsChange: (rotationVariants: string[]) => void
  error?: string
}

export const RotationPicker = ({
  categories,
  farmingSystem,
  cropChoice,
  rotationVariants,
  onRotationVariantsChange,
  error,
}: RotationPickerProps) => {
  const matchingCategories = orderCategoriesForFarmingSystem(
    categoriesMatchingCropChoice(categories, cropChoice),
    farmingSystem,
  )
  const [activeName, setActiveName] = useState<string | null>(null)
  const [onlySelected, setOnlySelected] = useState(false)

  const active =
    matchingCategories.find((category) => category.category === activeName) ??
    matchingCategories[0]

  if (!active) {
    return (
      <div className="space-y-2">
        <FieldError id="rotation-picker-error" message={error} />
        <p className="text-sm text-muted-foreground">
          Ingen sædskifter passer til de valgte afgrøder.
        </p>
      </div>
    )
  }

  const shown = onlySelected
    ? active.rotations.filter((rotation) =>
        rotationVariants.includes(rotation.rotationVariant),
      )
    : active.rotations
  const scope = shown.length === active.rotations.length ? 'alle' : 'viste'
  const shownSelectedCount = selectedInCategory(
    { ...active, rotations: shown },
    rotationVariants,
  )
  const mismatchCount = farmingSystemMismatchCount(
    categories,
    rotationVariants,
    farmingSystem,
  )

  return (
    <div className="space-y-3">
      {/* Pulled into the body's padding so it stays flush while the list scrolls. */}
      <div className="sticky -top-5 z-10 -mx-6 -mt-5 space-y-3 border-b bg-card px-6 pt-5 pb-3">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <div>
            <h3 className="text-sm font-medium">Sædskifter</h3>
            <p className="text-xs text-muted-foreground">
              {rotationVariants.length} valgt i alt
            </p>
          </div>
          <label className="flex items-center gap-2 text-xs">
            <input
              type="checkbox"
              checked={onlySelected}
              onChange={(event) => setOnlySelected(event.target.checked)}
            />
            Vis kun valgte
          </label>
        </div>

        <FieldError id="rotation-picker-error" message={error} />

        {mismatchCount > 0 ? (
          <p className="flex gap-2 rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-xs text-warning-strong">
            <AlertTriangle
              className="mt-0.5 size-3.5 shrink-0 text-warning-strong"
              aria-hidden="true"
            />
            {farmingSystemMismatchMessage(mismatchCount, farmingSystem)}
          </p>
        ) : null}

        <div role="tablist" aria-label="Kategorier" className="flex flex-wrap gap-1.5">
          {matchingCategories.map((category) => {
            const isActive = category.category === active.category
            const isOtherSystem = category.croppingSystem !== farmingSystem
            return (
              <button
                key={category.category}
                type="button"
                role="tab"
                aria-selected={isActive}
                onClick={() => setActiveName(category.category)}
                className={cn(
                  CHOICE_TAB_CLASS,
                  isActive ? CHOICE_TAB_ACTIVE_CLASS : CHOICE_TAB_IDLE_CLASS,
                )}
              >
                {category.category}
                <span className="tabular-nums">
                  {selectedInCategory(category, rotationVariants)}/
                  {category.rotations.length}
                </span>
                {isOtherSystem ? (
                  <span className="rounded bg-muted px-1 text-[0.65rem] text-muted-foreground">
                    {category.croppingSystem}
                  </span>
                ) : null}
              </button>
            )
          })}
        </div>

        <div className="flex justify-end gap-1.5">
          <Button
            variant="outline"
            size="xs"
            disabled={shownSelectedCount === shown.length}
            onClick={() =>
              onRotationVariantsChange(
                setRotationsSelected(rotationVariants, shown, true),
              )
            }
          >
            Vælg {scope}
          </Button>
          <Button
            variant="outline"
            size="xs"
            disabled={shownSelectedCount === 0}
            onClick={() =>
              onRotationVariantsChange(
                setRotationsSelected(rotationVariants, shown, false),
              )
            }
          >
            Fravælg {scope}
          </Button>
        </div>
      </div>

      {shown.length === 0 ? (
        <p className="py-6 text-center text-sm text-muted-foreground">
          Ingen valgte sædskifter i denne kategori.
        </p>
      ) : (
        <ul className="divide-y rounded-md border">
          {shown.map((rotation) => (
            <li key={rotation.rotationVariant}>
              <label className="flex cursor-pointer items-start gap-2.5 px-3 py-2 text-xs hover:bg-muted/50">
                <input
                  type="checkbox"
                  className="mt-0.5"
                  checked={rotationVariants.includes(rotation.rotationVariant)}
                  onChange={() =>
                    onRotationVariantsChange(
                      toggleValue(rotationVariants, rotation.rotationVariant),
                    )
                  }
                />
                <span className="min-w-0 flex-1 break-words">
                  {rotation.cropSequence.map((crop, index) => (
                    <span key={index}>
                      {index > 0 ? (
                        <span className="text-muted-foreground"> · </span>
                      ) : null}
                      {crop}
                    </span>
                  ))}
                </span>
                <span className="shrink-0 text-muted-foreground tabular-nums">
                  {rotation.activeLen} år
                </span>
              </label>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
