import { AlertTriangle, X } from 'lucide-react'
import { useState } from 'react'

import type { FarmingSystem, RotationCategoryOption } from '@/api/types'
import { Button } from '@/components/ui/button'
import { FieldError } from '@/components/ui/field-error'
import {
  cropsInCategory,
  farmingSystemMismatchCount,
  farmingSystemMismatchMessage,
  filterRotations,
  orderCategoriesForFarmingSystem,
  selectedInCategory,
  setRotationsSelected,
  toggleValue,
  type CropMatchMode,
} from '@/lib/simulation-form'
import { cn } from '@/lib/utils'

type RotationPickerProps = {
  categories: RotationCategoryOption[]
  farmingSystem: FarmingSystem
  rotationVariants: string[]
  onRotationVariantsChange: (rotationVariants: string[]) => void
  error?: string
}

export const RotationPicker = ({
  categories,
  farmingSystem,
  rotationVariants,
  onRotationVariantsChange,
  error,
}: RotationPickerProps) => {
  const orderedCategories = orderCategoriesForFarmingSystem(
    categories,
    farmingSystem,
  )
  const [activeName, setActiveName] = useState<string | null>(null)
  // Filters only change what is shown, never what is selected.
  const [crops, setCrops] = useState<string[]>([])
  const [matchMode, setMatchMode] = useState<CropMatchMode>('any')
  const [onlySelected, setOnlySelected] = useState(false)

  const active =
    orderedCategories.find((category) => category.category === activeName) ??
    orderedCategories[0]

  if (!active) {
    return (
      <p className="text-sm text-muted-foreground">
        Ingen sædskifter at vælge imellem.
      </p>
    )
  }

  const availableCrops = cropsInCategory(active).filter(
    (crop) => !crops.includes(crop),
  )
  const shown = filterRotations(active.rotations, {
    crops,
    mode: matchMode,
    onlySelectedFrom: onlySelected ? rotationVariants : undefined,
  })
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
          {orderedCategories.map((category) => {
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
                  'inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-xs transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                  isActive
                    ? 'border-primary bg-primary/10 font-medium text-foreground'
                    : 'bg-background text-muted-foreground hover:bg-muted/50',
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

        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-xs text-muted-foreground">
            Filtrér på afgrøde:
          </span>
          {crops.map((crop) => (
            <span
              key={crop}
              className="inline-flex items-center gap-1 rounded-full border border-primary bg-primary/10 py-0.5 pr-1 pl-2 text-xs"
            >
              {crop}
              <button
                type="button"
                aria-label={`Fjern filter ${crop}`}
                className="rounded-full p-0.5 hover:bg-primary/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                onClick={() => setCrops(toggleValue(crops, crop))}
              >
                <X className="size-3" aria-hidden="true" />
              </button>
            </span>
          ))}
          {availableCrops.length > 0 ? (
            <select
              aria-label="Tilføj afgrøde til filter"
              className="max-w-44 rounded-full border bg-background px-2 py-0.5 text-xs outline-none focus:ring-2 focus:ring-ring"
              value=""
              onChange={(event) => {
                if (event.target.value) setCrops([...crops, event.target.value])
              }}
            >
              <option value="">+ Tilføj afgrøde</option>
              {availableCrops.map((crop) => (
                <option key={crop} value={crop}>
                  {crop}
                </option>
              ))}
            </select>
          ) : null}
          {crops.length > 1 ? (
            <div
              role="radiogroup"
              aria-label="Match"
              className="flex items-center gap-2 text-xs"
            >
              <label className="flex items-center gap-1">
                <input
                  type="radio"
                  checked={matchMode === 'any'}
                  onChange={() => setMatchMode('any')}
                />
                mindst én
              </label>
              <label className="flex items-center gap-1">
                <input
                  type="radio"
                  checked={matchMode === 'all'}
                  onChange={() => setMatchMode('all')}
                />
                alle
              </label>
            </div>
          ) : null}
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-xs text-muted-foreground" aria-live="polite">
            {shown.length} af {active.rotations.length} vises
          </p>
          <div className="flex gap-1.5">
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
              Vælg {shown.length === active.rotations.length ? 'alle' : 'viste'}
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
              Fravælg {shown.length === active.rotations.length ? 'alle' : 'viste'}
            </Button>
          </div>
        </div>
      </div>

      {shown.length === 0 ? (
        <p className="py-6 text-center text-sm text-muted-foreground">
          {onlySelected && crops.length === 0
            ? 'Ingen valgte sædskifter i denne kategori.'
            : 'Ingen sædskifter matcher filteret.'}
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
                      <span
                        className={cn(crops.includes(crop) && 'font-semibold')}
                      >
                        {crop}
                      </span>
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
