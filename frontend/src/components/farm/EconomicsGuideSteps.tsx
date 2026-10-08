import { useId, useState, type ReactNode } from 'react'

import {
  CHOICE_SELECTED_CLASS,
  CHOICE_TAB_ACTIVE_CLASS,
  CHOICE_TAB_CLASS,
  CHOICE_TAB_IDLE_CLASS,
} from '@/components/farm/choice-styles'
import { CropGroupTile } from '@/components/farm/CropGroupTile'
import {
  GRID_HEAD_CLASS,
  RestoreButton,
  TEXT_LINK_CLASS,
} from '@/components/farm/economics-ui'
import {
  EconomicsNumberField,
  YieldPctField,
} from '@/components/farm/EconomicsNumberField'
import { EconomicsProfileChanges } from '@/components/farm/EconomicsProfileChanges'
import { useSharedPriceConfirm } from '@/components/farm/shared-price-confirm'
import { SharedPriceConfirm } from '@/components/farm/SharedPriceConfirm'
import { FieldError } from '@/components/ui/field-error'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { cropGroupFor } from '@/lib/crop-groups'
import {
  categoryPrices,
  cropYieldPct,
  describePriceCrops,
  findPrice,
  formatDbDkk,
  formatEconomicsNumber,
  isPriceCustomised,
  lineAmountDkkHa,
  lineQuantity,
  priceValue,
  quantityUnitLabel,
  saleLine,
  withPriceOverride,
  withYieldPct,
  yieldHint,
  type CropEconomics,
  type EconomicsAssumptions,
  type EconomicsOverrides,
  type OverridesChange,
  type ProfileChange,
  type UnitPrice,
} from '@/lib/economics'
import { cn } from '@/lib/utils'

const FOOT_CLASS = 'bg-muted/30 px-5 py-2.5 text-xs text-muted-foreground'

type StepProps = {
  assumptions: EconomicsAssumptions
  overrides: EconomicsOverrides
  onChange: (change: OverridesChange) => void
}

type CropNameProps = {
  crop: CropEconomics
  children?: ReactNode
}

const CropName = ({ crop, children }: CropNameProps) => (
  <span className="flex min-w-0 items-center gap-2">
    <CropGroupTile group={cropGroupFor(crop.cropCode, crop.cropName)} />
    <span className="min-w-0">
      <span className="block">{crop.cropName}</span>
      {children}
    </span>
  </span>
)

const PRICES_GRID_CLASS =
  'grid grid-cols-[minmax(9rem,1fr)_8rem_11rem] items-center gap-x-4 px-5'

type PriceRowProps = {
  price: UnitPrice
  value: number
  label: string
  onCommit: (value: number) => void
  children: ReactNode
}

const PriceRow = ({
  price,
  value,
  label,
  onCommit,
  children,
}: PriceRowProps) => (
  <div className={cn(PRICES_GRID_CLASS, 'py-2.5 text-[13px]')}>
    {children}
    <span className="text-right text-muted-foreground tabular-nums">
      {formatEconomicsNumber(price.valueDkk)} {price.unit}
    </span>
    <span className="flex items-start justify-end gap-1.5 leading-7 text-muted-foreground">
      <EconomicsNumberField
        value={value}
        standard={price.valueDkk}
        label={label}
        onCommit={onCommit}
      />
      <span>{price.unit}</span>
    </span>
  </div>
)

type GuidePricesStepProps = StepProps & {
  onOpenCrop: (cropCode: number) => void
}

export const GuidePricesStep = ({
  assumptions,
  overrides,
  onChange,
  onOpenCrop,
}: GuidePricesStepProps) => {
  const sharedPrice = useSharedPriceConfirm(assumptions, onChange)

  return (
    <div className="overflow-x-auto">
      <div className="min-w-130">
        <div className={cn(PRICES_GRID_CLASS, GRID_HEAD_CLASS)}>
          <span>Afgrøde</span>
          <span className="text-right">Standardens pris</span>
          <span className="text-right">Bedriftens pris</span>
        </div>
        {assumptions.crops.map((crop) => {
          const sale = saleLine(crop)
          const price = sale && findPrice(assumptions, sale.priceId)
          if (!price) return null
          return (
            <div key={crop.cropCode} className="border-b">
              <PriceRow
                price={price}
                value={sharedPrice.shownPrice(
                  price.id,
                  priceValue(assumptions, overrides, price.id),
                )}
                label={`Bedriftens salgspris for ${crop.cropName} i ${price.unit}`}
                onCommit={(value) => sharedPrice.commitPrice(price.id, value)}
              >
                <CropName crop={crop}>
                  <button
                    type="button"
                    aria-label={`Se alle poster for ${crop.cropName}`}
                    className={cn(TEXT_LINK_CLASS, 'text-left text-xs')}
                    onClick={() => onOpenCrop(crop.cropCode)}
                  >
                    Se alle poster
                  </button>
                </CropName>
              </PriceRow>
              <SharedPriceConfirm
                assumptions={assumptions}
                overrides={overrides}
                sharedPrice={sharedPrice}
                priceId={price.id}
                className="px-5 pb-3"
              />
            </div>
          )
        })}
        <p className={FOOT_CLASS}>Et tomt felt bruger standardens pris.</p>
      </div>
    </div>
  )
}

export const GuideFertiliserStep = ({
  assumptions,
  overrides,
  onChange,
}: StepProps) => (
  <div className="overflow-x-auto">
    <div className="min-w-130">
      <div className={cn(PRICES_GRID_CLASS, GRID_HEAD_CLASS)}>
        <span>Gødning</span>
        <span className="text-right">Standardens pris</span>
        <span className="text-right">Bedriftens pris</span>
      </div>
      {categoryPrices(assumptions, 'fertiliser').map((price) => (
        <div key={price.id} className="border-b">
          <PriceRow
            price={price}
            value={priceValue(assumptions, overrides, price.id)}
            label={`Bedriftens pris for ${price.label} i ${price.unit}`}
            onCommit={(value) =>
              onChange((current) =>
                withPriceOverride(assumptions, current, price.id, value),
              )
            }
          >
            <span>{price.label}</span>
          </PriceRow>
        </div>
      ))}
      <p className={FOOT_CLASS}>
        Handelsgødningen følger afgrødens kvælstofnorm. Husdyrgødning regnes med
        i de simuleringer, der bruger den, efter simuleringens gødningsvalg.
        Prisen pr. kg N er 0, når gødningen er bedriftens egen.
      </p>
    </div>
  </div>
)

const YIELD_GRID_CLASS =
  'grid grid-cols-[minmax(9rem,1fr)_11rem_11rem] items-center gap-x-4 px-5'

export const GuideYieldStep = ({
  assumptions,
  overrides,
  onChange,
}: StepProps) => (
  <div className="overflow-x-auto">
    <div className="min-w-142">
      <div className={cn(YIELD_GRID_CLASS, GRID_HEAD_CLASS)}>
        <span>Afgrøde</span>
        <span className="text-right">Normen</span>
        <span className="text-right">I forhold til normen</span>
      </div>
      {assumptions.crops.map((crop) => {
        const grain = saleLine(crop)
        if (!grain) return null
        const pct = cropYieldPct(overrides, crop)
        return (
          <div
            key={crop.cropCode}
            className={cn(YIELD_GRID_CLASS, 'border-b py-2.5 text-[13px]')}
          >
            <CropName crop={crop} />
            <span className="text-right text-muted-foreground tabular-nums">
              {formatEconomicsNumber(grain.quantity)} {grain.quantityUnit} på JB
              5-6
            </span>
            <YieldPctField
              pct={pct}
              cropName={crop.cropName}
              onCommit={(value) =>
                onChange((current) => withYieldPct(current, crop, value))
              }
            />
            {pct === 0 ? null : (
              <p className="col-span-full pt-1 pl-[26px] text-xs text-muted-foreground">
                {yieldHint(overrides, crop)}
              </p>
            )}
          </div>
        )
      })}
      <p className={FOOT_CLASS}>
        Procenten lægges oven på hver marks eget udbytte, som afhænger af
        jordtype og vanding. Den ændrer mængden af kerne og halm, ikke
        omkostningerne.
      </p>
    </div>
  </div>
)

const MACHINES_GRID_CLASS =
  'grid grid-cols-[minmax(0,11rem)_minmax(6rem,1fr)_auto_4rem] items-center gap-x-4 px-5'

export const GuideMachinesStep = ({
  assumptions,
  overrides,
  onChange,
}: StepProps) => {
  const sharedPrice = useSharedPriceConfirm(assumptions, onChange)
  const crops = assumptions.crops.filter(
    (entry) => entry.costs.fieldWork.length > 0,
  )
  const [cropCode, setCropCode] = useState(crops[0]?.cropCode)
  const crop = crops.find((entry) => entry.cropCode === cropCode)

  if (!crop) return null

  return (
    <div>
      <div className="flex flex-wrap items-center gap-1.5 px-5 pb-3">
        <span className="mr-1 text-xs text-muted-foreground">
          Markarbejdet for
        </span>
        {crops.map((entry) => (
          <button
            key={entry.cropCode}
            type="button"
            aria-pressed={entry === crop}
            className={cn(
              CHOICE_TAB_CLASS,
              entry === crop ? CHOICE_TAB_ACTIVE_CLASS : CHOICE_TAB_IDLE_CLASS,
            )}
            onClick={() => setCropCode(entry.cropCode)}
          >
            {entry.cropName}
          </button>
        ))}
      </div>
      <div className="overflow-x-auto">
        <div className="min-w-166">
          <div className={cn(MACHINES_GRID_CLASS, GRID_HEAD_CLASS)}>
            <span>Markarbejde</span>
            <span>Gælder for</span>
            <span className="text-right">Mængde × pris</span>
            <span className="text-right">kr/ha</span>
          </div>
          {crop.costs.fieldWork.map((line) => {
            const price = findPrice(assumptions, line.priceId)
            if (!price) return null
            const quantity = lineQuantity(overrides, crop, line)
            return (
              <div key={line.id} className="border-b">
                <div className={cn(MACHINES_GRID_CLASS, 'py-2.5 text-[13px]')}>
                  <span className="flex min-w-0 items-center gap-1">
                    <span className="min-w-0">{line.label}</span>
                    {isPriceCustomised(overrides, price.id) ? (
                      <RestoreButton
                        label={line.label}
                        onRestore={() =>
                          onChange((current) =>
                            withPriceOverride(
                              assumptions,
                              current,
                              price.id,
                              null,
                            ),
                          )
                        }
                      />
                    ) : null}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {describePriceCrops(assumptions, price.id)}
                  </span>
                  <span className="flex items-start justify-end gap-1.5 leading-7 whitespace-nowrap text-muted-foreground">
                    <span className="text-foreground tabular-nums">
                      {formatEconomicsNumber(quantity)}
                    </span>
                    <span>
                      {quantityUnitLabel(line.quantityUnit, quantity)}
                    </span>
                    <span aria-hidden="true">×</span>
                    <EconomicsNumberField
                      value={sharedPrice.shownPrice(
                        price.id,
                        priceValue(assumptions, overrides, price.id),
                      )}
                      standard={price.valueDkk}
                      label={`Prisen for ${line.label} i ${price.unit}`}
                      onCommit={(value) =>
                        sharedPrice.commitPrice(price.id, value)
                      }
                    />
                    <span>{price.unit}</span>
                  </span>
                  <span className="text-right tabular-nums">
                    {formatDbDkk(
                      lineAmountDkkHa(assumptions, overrides, crop, line),
                    )}
                  </span>
                </div>
                <SharedPriceConfirm
                  assumptions={assumptions}
                  overrides={overrides}
                  sharedPrice={sharedPrice}
                  priceId={price.id}
                  className="px-5 pb-3"
                />
              </div>
            )
          })}
          <p className={FOOT_CLASS}>
            Tallene er for {crop.cropName}. En fælles pris gælder for alle de
            afgrøder, der står ved den. Mængderne rettes på profilens side.
          </p>
        </div>
      </div>
    </div>
  )
}

export type GuideUseOption = {
  id: string
  label: string
  note: string
  checked: boolean
}

type GuideReviewStepProps = {
  name: string
  nameError: string | null
  changes: ProfileChange[]
  useOptions: GuideUseOption[]
  onNameChange: (name: string) => void
  onRestore: (change: ProfileChange) => void
  onRestoreAll: () => void
  onToggleUse: (id: string) => void
}

export const GuideReviewStep = ({
  name,
  nameError,
  changes,
  useOptions,
  onNameChange,
  onRestore,
  onRestoreAll,
  onToggleUse,
}: GuideReviewStepProps) => {
  const id = useId()

  return (
    <div>
      <div className="space-y-1.5 border-t px-5 py-4">
        <Label htmlFor={`${id}-name`}>Profilens navn</Label>
        <Input
          id={`${id}-name`}
          autoComplete="off"
          aria-invalid={nameError ? true : undefined}
          aria-describedby={nameError ? `${id}-name-error` : undefined}
          className="max-w-sm"
          value={name}
          onChange={(event) => onNameChange(event.target.value)}
        />
        <FieldError id={`${id}-name-error`} message={nameError} />
      </div>
      <EconomicsProfileChanges
        className="border-t"
        changes={changes}
        onRestore={onRestore}
        onRestoreAll={onRestoreAll}
      />
      <div
        role="group"
        aria-labelledby={`${id}-use`}
        className="border-t px-5 py-4"
      >
        <p id={`${id}-use`} className="text-sm font-semibold">
          Brug profilen i
        </p>
        <p className="mt-0.5 text-xs text-muted-foreground">
          {useOptions.length > 0
            ? 'Vælg de simuleringer, der skal regne med profilen. Vælger du ingen, kan profilen vælges i en simulering senere.'
            : 'Bedriften har ingen simuleringer endnu. Profilen kan vælges, når den første er oprettet.'}
        </p>
        <div className="mt-2 grid gap-2 sm:grid-cols-2">
          {useOptions.map((option) => (
            <label
              key={option.id}
              className={cn(
                'flex cursor-pointer items-start gap-3 rounded-lg border px-3.5 py-2.5 transition-colors has-focus-visible:ring-2 has-focus-visible:ring-ring',
                option.checked ? CHOICE_SELECTED_CLASS : 'hover:bg-muted/50',
              )}
            >
              <input
                type="checkbox"
                className="mt-1 accent-primary"
                checked={option.checked}
                onChange={() => onToggleUse(option.id)}
              />
              <span className="min-w-0">
                <span className="block text-[13px] font-semibold">
                  {option.label}
                </span>
                <span className="block text-xs text-muted-foreground">
                  {option.note}
                </span>
              </span>
            </label>
          ))}
        </div>
      </div>
    </div>
  )
}
