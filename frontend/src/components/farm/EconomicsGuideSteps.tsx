import { Undo2 } from 'lucide-react'
import { useId, useState, type ReactNode } from 'react'

import {
  CHOICE_SELECTED_CLASS,
  CHOICE_TAB_ACTIVE_CLASS,
  CHOICE_TAB_CLASS,
  CHOICE_TAB_IDLE_CLASS,
} from '@/components/farm/choice-styles'
import { CropGroupTile } from '@/components/farm/CropGroupTile'
import {
  EconomicsNumberField,
  YieldPctField,
} from '@/components/farm/EconomicsNumberField'
import { EconomicsProfileChanges } from '@/components/farm/EconomicsProfileChanges'
import { useSharedPriceConfirm } from '@/components/farm/shared-price-confirm'
import { SharedPriceConfirm } from '@/components/farm/SharedPriceConfirm'
import { AppTooltip } from '@/components/ui/app-tooltip'
import { FieldError } from '@/components/ui/field-error'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { cropGroupFor } from '@/lib/crop-groups'
import {
  cropDbChange,
  cropTotals,
  cropYieldPct,
  findPrice,
  formatDbDkk,
  formatEconomicsNumber,
  formatSignedDkk,
  isPriceCustomised,
  lineAmountDkkHa,
  lineQuantity,
  priceCrops,
  priceValue,
  quantityUnitLabel,
  withPriceOverride,
  withYieldPct,
  yieldHint,
  type CropEconomics,
  type EconomicsAssumptions,
  type EconomicsOverrides,
  type OverridesChange,
  type ProfileChange,
} from '@/lib/economics'
import { formatWholeNumber } from '@/lib/field-domain'
import { cn } from '@/lib/utils'

const HEAD_CLASS =
  'border-y bg-muted/30 py-2 text-xs font-semibold text-muted-foreground'

const ROW_CLASS = 'border-b py-2.5 text-[13px]'

const FOOT_CLASS = 'bg-muted/30 px-5 py-2.5 text-xs text-muted-foreground'

const SMALL_LINK_CLASS =
  'rounded-sm text-left text-xs font-medium text-primary underline underline-offset-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring'

const CONFIRM_TITLE = 'Fælles pris, før den gælder'

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

type DbCellProps = Omit<StepProps, 'onChange'> & { crop: CropEconomics }

const DbCell = ({ assumptions, overrides, crop }: DbCellProps) => {
  const change = cropDbChange(assumptions, overrides, crop)

  return (
    <span className="text-right tabular-nums">
      <span className="block font-semibold">
        {formatDbDkk(cropTotals(assumptions, overrides, crop).dbDkkHa)}
      </span>
      {change === 0 ? null : (
        <span
          className={cn(
            'block text-xs',
            change > 0 ? 'text-primary' : 'text-destructive',
          )}
        >
          {formatSignedDkk(change)}
        </span>
      )}
    </span>
  )
}

const PRICES_GRID_CLASS =
  'grid grid-cols-[minmax(0,1fr)_8rem_11rem_8rem] items-center gap-x-4 px-5'

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
    <div>
      <div className={cn(PRICES_GRID_CLASS, HEAD_CLASS)}>
        <span>Afgrøde</span>
        <span className="text-right">Standardens pris</span>
        <span className="text-right">Bedriftens pris</span>
        <span className="text-right">Dækningsbidrag kr/ha</span>
      </div>
      {assumptions.crops.map((crop) => {
        const [sale] = crop.revenue
        if (!sale) return null
        const price = findPrice(assumptions, sale.priceId)
        const standard = price?.valueDkk ?? 0
        return (
          <div key={crop.cropCode} className="border-b">
            <div className={cn(PRICES_GRID_CLASS, 'py-2.5 text-[13px]')}>
              <CropName crop={crop}>
                <button
                  type="button"
                  className={SMALL_LINK_CLASS}
                  onClick={() => onOpenCrop(crop.cropCode)}
                >
                  Hvad tallet er bygget af
                </button>
              </CropName>
              <span className="text-right text-muted-foreground tabular-nums">
                {formatEconomicsNumber(standard)} {price?.unit}
              </span>
              <span className="flex items-start justify-end gap-1.5 leading-7 text-muted-foreground">
                <EconomicsNumberField
                  value={priceValue(assumptions, overrides, sale.priceId)}
                  label={`Bedriftens salgspris for ${crop.cropName} i ${price?.unit ?? ''}`}
                  customised={isPriceCustomised(overrides, sale.priceId)}
                  emptyValue={standard}
                  onCommit={(value) =>
                    sharedPrice.commitPrice(sale.priceId, value)
                  }
                />
                <span>{price?.unit}</span>
              </span>
              <DbCell
                assumptions={assumptions}
                overrides={overrides}
                crop={crop}
              />
            </div>
            {sharedPrice.pending?.priceId === sale.priceId ? (
              <div className="px-5 pb-3">
                <SharedPriceConfirm
                  assumptions={assumptions}
                  overrides={overrides}
                  pending={sharedPrice.pending}
                  title={CONFIRM_TITLE}
                  onCancel={sharedPrice.cancel}
                  onConfirm={sharedPrice.confirm}
                />
              </div>
            ) : null}
          </div>
        )
      })}
      <p className={FOOT_CLASS}>
        Tomme felter bruger standardens pris. Halm, udsæd og planteværn kan
        rettes bagefter på profilens side.
      </p>
    </div>
  )
}

const YIELD_GRID_CLASS =
  'grid grid-cols-[minmax(0,1fr)_11rem_11rem_8rem] items-center gap-x-4 px-5'

export const GuideYieldStep = ({
  assumptions,
  overrides,
  onChange,
}: StepProps) => (
  <div>
    <div className={cn(YIELD_GRID_CLASS, HEAD_CLASS)}>
      <span>Afgrøde</span>
      <span className="text-right">Normen</span>
      <span className="text-right">I forhold til normen</span>
      <span className="text-right">Dækningsbidrag kr/ha</span>
    </div>
    {assumptions.crops.map((crop) => {
      const [grain] = crop.revenue
      if (!grain) return null
      const pct = cropYieldPct(overrides, crop)
      return (
        <div key={crop.cropCode} className={cn(YIELD_GRID_CLASS, ROW_CLASS)}>
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
          <DbCell assumptions={assumptions} overrides={overrides} crop={crop} />
          {pct === 0 ? null : (
            <p className="col-span-full pt-1 pl-[26px] text-xs text-primary">
              {yieldHint(overrides, crop)}
            </p>
          )}
        </div>
      )
    })}
    <p className={FOOT_CLASS}>
      Procenten lægges oven på hver marks eget udbytte, som afhænger af jordtype
      og vanding. Den ændrer mængden af kerne og halm, ikke omkostningerne.
    </p>
  </div>
)

const MACHINES_GRID_CLASS =
  'grid grid-cols-[minmax(0,11rem)_minmax(0,1fr)_auto_4rem] items-center gap-x-4 px-5'

const CROP_CHIP_CLASS =
  'inline-flex items-center gap-1 rounded-full border px-1.5 py-0.5 text-[11px] whitespace-nowrap'

type PriceCropsProps = {
  assumptions: EconomicsAssumptions
  priceId: string
}

const PriceCrops = ({ assumptions, priceId }: PriceCropsProps) => {
  const crops = priceCrops(assumptions, priceId)

  return (
    <span className="flex flex-wrap gap-1">
      {crops.length === assumptions.crops.length ? (
        <span className={CROP_CHIP_CLASS}>
          <span
            className="size-1.5 rounded-sm bg-muted-foreground"
            aria-hidden="true"
          />
          Alle {crops.length} afgrøder
        </span>
      ) : (
        crops.map((crop) => (
          <span key={crop.cropCode} className={CROP_CHIP_CLASS}>
            <span
              className="size-1.5 rounded-sm"
              style={{
                backgroundColor: cropGroupFor(crop.cropCode, crop.cropName)
                  .color,
              }}
              aria-hidden="true"
            />
            {crop.cropName}
          </span>
        ))
      )}
    </span>
  )
}

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
      <div className={cn(MACHINES_GRID_CLASS, HEAD_CLASS)}>
        <span>Markarbejde</span>
        <span>Gælder for</span>
        <span className="text-right">Mængde × pris</span>
        <span className="text-right">kr/ha</span>
      </div>
      {crop.costs.fieldWork.map((line) => {
        const price = findPrice(assumptions, line.priceId)
        const quantity = lineQuantity(overrides, crop, line)
        const customised = isPriceCustomised(overrides, line.priceId)
        return (
          <div key={line.id} className="border-b">
            <div className={cn(MACHINES_GRID_CLASS, 'py-2.5 text-[13px]')}>
              <span className="flex min-w-0 items-center gap-1">
                <span className="min-w-0">{line.label}</span>
                {customised ? (
                  <AppTooltip content="Gendan standard">
                    <button
                      type="button"
                      aria-label={`Gendan standard for ${line.label}`}
                      className="rounded-sm p-0.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                      onClick={() =>
                        onChange((current) =>
                          withPriceOverride(
                            assumptions,
                            current,
                            line.priceId,
                            null,
                          ),
                        )
                      }
                    >
                      <Undo2 className="size-3.5" aria-hidden="true" />
                    </button>
                  </AppTooltip>
                ) : null}
              </span>
              <PriceCrops assumptions={assumptions} priceId={line.priceId} />
              <span className="flex items-start justify-end gap-1.5 leading-7 whitespace-nowrap text-muted-foreground">
                <span className="text-foreground tabular-nums">
                  {formatEconomicsNumber(quantity)}
                </span>
                <span>{quantityUnitLabel(line.quantityUnit, quantity)}</span>
                <span aria-hidden="true">×</span>
                <EconomicsNumberField
                  value={priceValue(assumptions, overrides, line.priceId)}
                  label={`Prisen for ${line.label} i ${price?.unit ?? ''}`}
                  customised={customised}
                  onCommit={(value) =>
                    sharedPrice.commitPrice(line.priceId, value)
                  }
                />
                <span>{price?.unit}</span>
              </span>
              <span className="text-right tabular-nums">
                {formatWholeNumber(
                  lineAmountDkkHa(assumptions, overrides, crop, line),
                )}
              </span>
            </div>
            {sharedPrice.pending?.priceId === line.priceId ? (
              <div className="px-5 pb-3">
                <SharedPriceConfirm
                  assumptions={assumptions}
                  overrides={overrides}
                  pending={sharedPrice.pending}
                  title={CONFIRM_TITLE}
                  onCancel={sharedPrice.cancel}
                  onConfirm={sharedPrice.confirm}
                />
              </div>
            ) : null}
          </div>
        )
      })}
      <p className={FOOT_CLASS}>
        Tallene er for {crop.cropName}. En fælles pris gælder for alle de
        afgrøder, der står ved den. Mængderne rettes på profilens side.
      </p>
    </div>
  )
}

export type GuideUseOption = {
  id: string
  label: string
  note: string
}

type GuideReviewStepProps = {
  name: string
  nameError: string | null
  changes: ProfileChange[]
  useOptions: GuideUseOption[]
  useChoice: string
  onNameChange: (name: string) => void
  onRestore: (change: ProfileChange) => void
  onRestoreAll: () => void
  onUseChoiceChange: (id: string) => void
}

export const GuideReviewStep = ({
  name,
  nameError,
  changes,
  useOptions,
  useChoice,
  onNameChange,
  onRestore,
  onRestoreAll,
  onUseChoiceChange,
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
        stacked
        className="border-t"
        changes={changes}
        onRestore={onRestore}
        onRestoreAll={onRestoreAll}
      />
      <div
        role="radiogroup"
        aria-labelledby={`${id}-use`}
        className="border-t px-5 py-4"
      >
        <p id={`${id}-use`} className="text-sm font-semibold">
          Brug profilen i
        </p>
        <div className="mt-2 grid gap-2 sm:grid-cols-2">
          {useOptions.map((option) => (
            <label
              key={option.id}
              className={cn(
                'flex cursor-pointer items-start gap-3 rounded-lg border px-3.5 py-2.5 transition-colors has-focus-visible:ring-2 has-focus-visible:ring-ring',
                option.id === useChoice
                  ? CHOICE_SELECTED_CLASS
                  : 'hover:bg-muted/50',
              )}
            >
              <input
                type="radio"
                name={`${id}-use`}
                className="mt-1 accent-primary"
                checked={option.id === useChoice}
                onChange={() => onUseChoiceChange(option.id)}
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
