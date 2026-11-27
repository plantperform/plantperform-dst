import { LayoutList, Tags } from 'lucide-react'
import { useState } from 'react'

import { CropGroupTile } from '@/components/farm/CropGroupTile'
import {
  CustomisedDot,
  DbDelta,
  GRID_HEAD_CLASS,
} from '@/components/farm/economics-ui'
import { CrossCropPrices } from '@/components/farm/EconomicsCrossCropPrices'
import { EconomicsCropDetail } from '@/components/farm/EconomicsCropDetail'
import { RULES_CARD_CLASS } from '@/components/farm/rules-ui'
import { cropGroupFor } from '@/lib/crop-groups'
import { cropLabel } from '@/lib/crop-label'
import {
  CROSS_CROP_PRICES_LABEL,
  cropDbChange,
  cropTotals,
  crossCropPriceRows,
  fertiliserNote,
  formatDbDkk,
  formatSignedDkk,
  isCropCustomised,
  isPriceCustomised,
  type EconomicsAssumptions,
  type EconomicsOverrides,
  type OverridesChange,
} from '@/lib/economics'
import { cn } from '@/lib/utils'

const OVERVIEW_GRID_CLASS = 'grid items-center gap-x-3 px-5'

const LIST_ITEM_CLASS =
  'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[13px] transition-colors hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none aria-[current=true]:bg-muted aria-[current=true]:font-semibold'

type CropsOverviewProps = {
  assumptions: EconomicsAssumptions
  overrides: EconomicsOverrides
  editable: boolean
  // The guide shows its own title and introduction above the table.
  showHeader?: boolean
  onOpenCrop: (cropCode: number) => void
}

export const CropsOverview = ({
  assumptions,
  overrides,
  editable,
  showHeader = true,
  onOpenCrop,
}: CropsOverviewProps) => {
  const gridClass = cn(
    OVERVIEW_GRID_CLASS,
    editable
      ? 'min-w-164 grid-cols-[minmax(9rem,1fr)_4.5rem_4.5rem_5.5rem_6.5rem_4.5rem]'
      : 'min-w-144 grid-cols-[minmax(9rem,1fr)_4.5rem_4.5rem_5.5rem_6.5rem]',
  )

  return (
    <div>
      {showHeader ? (
        <div className="px-5 pt-4 pb-3">
          <h2 className="text-base font-semibold">Alle afgrøder</h2>
          <p className="mt-1 text-xs text-muted-foreground">
            Tal i kr/ha. Klik på en afgrøde for at se dens priser og mængder
            {editable ? ' og rette dem' : null}.
          </p>
        </div>
      ) : null}
      <div className="overflow-x-auto">
        <div className={cn(gridClass, GRID_HEAD_CLASS)}>
          <span>Afgrøde</span>
          <span className="text-right">Indtægt</span>
          <span className="text-right">Tilskud</span>
          <span className="text-right">Omkostninger</span>
          <span className="text-right">Dækningsbidrag</span>
          {editable ? <span className="text-right">Ændring</span> : null}
        </div>
        {assumptions.crops.map((crop) => {
          const totals = cropTotals(assumptions, overrides, crop)
          return (
            <button
              key={crop.cropCode}
              type="button"
              onClick={() => onOpenCrop(crop.cropCode)}
              className={cn(
                gridClass,
                'w-full border-b py-2 text-left text-[13px] tabular-nums transition-colors hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none focus-visible:ring-inset',
              )}
            >
              <span className="flex min-w-0 items-center gap-2">
                <CropGroupTile
                  group={cropGroupFor(crop.cropCode, crop.cropName)}
                />
                <span className="min-w-0 truncate">
                  {cropLabel(crop.cropCode, crop.cropName)}
                </span>
                {isCropCustomised(overrides, crop) ? <CustomisedDot /> : null}
              </span>
              <span className="text-right">
                {formatDbDkk(totals.revenueDkkHa)}
              </span>
              <span className="text-right">
                {formatSignedDkk(totals.subsidyDkkHa)}
              </span>
              <span className="text-right">
                {formatDbDkk(-totals.totalCostsDkkHa)}
              </span>
              <span className="text-right font-semibold">
                {formatDbDkk(totals.dbDkkHa)}
              </span>
              {editable ? (
                <span className="text-right">
                  <DbDelta
                    change={cropDbChange(assumptions, overrides, crop)}
                  />
                </span>
              ) : null}
            </button>
          )
        })}
      </div>
      <p className="bg-muted/30 px-5 py-2.5 text-[11px] text-muted-foreground">
        {fertiliserNote(assumptions)}
      </p>
    </div>
  )
}

type EconomicsAssumptionsEditorProps = {
  assumptions: EconomicsAssumptions
  overrides: EconomicsOverrides
  onOverridesChange?: (change: OverridesChange) => void
  focus?: { cropCode: number; lineId: string }
}

export const EconomicsAssumptionsEditor = ({
  assumptions,
  overrides,
  onOverridesChange,
  focus,
}: EconomicsAssumptionsEditorProps) => {
  const [opened, setOpened] = useState<{
    cropCode: number | 'crossCrop' | null
    lineId?: string
  }>({ cropCode: focus?.cropCode ?? null, lineId: focus?.lineId })
  const active = assumptions.crops.find(
    (crop) => crop.cropCode === opened.cropCode,
  )
  const crossCropRows = crossCropPriceRows(assumptions)
  const showingCrossCrop =
    opened.cropCode === 'crossCrop' && crossCropRows.length > 0
  const openCrop = (cropCode: number | 'crossCrop' | null) =>
    setOpened({ cropCode })
  const sectionLabel = showingCrossCrop
    ? CROSS_CROP_PRICES_LABEL
    : active
      ? `Priser og mængder for ${cropLabel(active.cropCode, active.cropName)}`
      : 'Alle afgrøder'

  return (
    <div className="grid gap-4 @3xl:grid-cols-[20rem_minmax(0,1fr)] @3xl:items-start">
      <nav aria-label="Afgrøder" className={cn(RULES_CARD_CLASS, 'p-2')}>
        <ul className="space-y-0.5">
          <li>
            <button
              type="button"
              aria-current={active || showingCrossCrop ? undefined : 'true'}
              className={LIST_ITEM_CLASS}
              onClick={() => openCrop(null)}
            >
              <LayoutList
                className="size-4 shrink-0 text-muted-foreground"
                aria-hidden="true"
              />
              Alle afgrøder
            </button>
          </li>
          {crossCropRows.length > 0 ? (
            <li>
              <button
                type="button"
                aria-current={showingCrossCrop ? 'true' : undefined}
                className={LIST_ITEM_CLASS}
                onClick={() => openCrop('crossCrop')}
              >
                <Tags
                  className="size-4 shrink-0 text-muted-foreground"
                  aria-hidden="true"
                />
                <span className="min-w-0 flex-1">
                  {CROSS_CROP_PRICES_LABEL}
                </span>
                {crossCropRows.some((row) =>
                  isPriceCustomised(overrides, row.priceId),
                ) ? (
                  <CustomisedDot />
                ) : null}
              </button>
            </li>
          ) : null}
          {assumptions.crops.map((crop) => (
            <li key={crop.cropCode}>
              <button
                type="button"
                aria-current={crop === active ? 'true' : undefined}
                className={LIST_ITEM_CLASS}
                onClick={() => openCrop(crop.cropCode)}
              >
                <CropGroupTile
                  group={cropGroupFor(crop.cropCode, crop.cropName)}
                />
                <span className="min-w-0 flex-1">
                  {cropLabel(crop.cropCode, crop.cropName)}
                </span>
                {isCropCustomised(overrides, crop) ? <CustomisedDot /> : null}
              </button>
            </li>
          ))}
        </ul>
      </nav>

      <section
        aria-label={sectionLabel}
        className={cn(RULES_CARD_CLASS, 'overflow-hidden')}
      >
        {showingCrossCrop ? (
          <div>
            <div className="px-5 pt-4 pb-3">
              <h2 className="text-base font-semibold">
                {CROSS_CROP_PRICES_LABEL}
              </h2>
              <p className="mt-1 text-xs text-muted-foreground">
                Priser, der ikke hører til én afgrøde. De lægges oven på
                afgrødernes egne budgetter, hvor de er relevante.
              </p>
            </div>
            <CrossCropPrices
              assumptions={assumptions}
              overrides={overrides}
              onChange={onOverridesChange}
            />
            <p className="bg-muted/30 px-5 py-2.5 text-[11px] text-muted-foreground">
              {onOverridesChange
                ? 'Et tomt felt bruger standardens pris. '
                : null}
              De fleste står ikke i afgrødernes egne budgetter, så de ændrer
              ikke tallene under Alle afgrøder. De tæller med i simuleringerne.
            </p>
          </div>
        ) : active ? (
          <EconomicsCropDetail
            key={active.cropCode}
            assumptions={assumptions}
            overrides={overrides}
            crop={active}
            onOverridesChange={onOverridesChange}
            focusLineId={opened.lineId}
          />
        ) : (
          <CropsOverview
            assumptions={assumptions}
            overrides={overrides}
            editable={onOverridesChange !== undefined}
            onOpenCrop={openCrop}
          />
        )}
      </section>
    </div>
  )
}
