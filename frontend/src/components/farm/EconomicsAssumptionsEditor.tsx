import { LayoutList, Search } from 'lucide-react'
import { useState } from 'react'

import { CropGroupTile } from '@/components/farm/CropGroupTile'
import {
  CustomisedDot,
  EconomicsCropDetail,
  type OverridesChange,
} from '@/components/farm/EconomicsCropDetail'
import { RULES_CARD_CLASS } from '@/components/farm/rules-ui'
import { Input } from '@/components/ui/input'
import { cropGroupFor } from '@/lib/crop-groups'
import {
  cropTotals,
  formatDbDkk,
  isCropCustomised,
  searchCrops,
  type EconomicsAssumptions,
  type EconomicsOverrides,
} from '@/lib/economics'
import { formatWholeNumber } from '@/lib/field-domain'
import { cn } from '@/lib/utils'

const OVERVIEW_GRID_CLASS =
  'grid grid-cols-[minmax(0,1fr)_5.5rem_5.5rem_6.5rem_7.5rem] items-center gap-x-3 px-5'

const TABLE_HEAD_CLASS =
  'border-y bg-muted/30 py-2 text-xs font-semibold text-muted-foreground'

const LIST_ITEM_CLASS =
  'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[13px] transition-colors hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none aria-[current=true]:bg-muted aria-[current=true]:font-semibold'

type CropsOverviewProps = {
  assumptions: EconomicsAssumptions
  overrides: EconomicsOverrides
  onOpenCrop: (cropCode: number) => void
}

const CropsOverview = ({
  assumptions,
  overrides,
  onOpenCrop,
}: CropsOverviewProps) => (
  <div>
    <div className="px-5 pt-4 pb-3">
      <h2 className="text-base font-semibold">Alle afgrøder</h2>
      <p className="mt-1 text-xs text-muted-foreground">
        Tal i kr/ha. Klik på en afgrøde for at se dens priser og mængder.
      </p>
    </div>
    <div className="overflow-x-auto">
      <div className="min-w-136">
        <div className={cn(OVERVIEW_GRID_CLASS, TABLE_HEAD_CLASS)}>
          <span>Afgrøde</span>
          <span className="text-right">Indtægt</span>
          <span className="text-right">Tilskud</span>
          <span className="text-right">Omkostninger</span>
          <span className="text-right">Dækningsbidrag</span>
        </div>
        {assumptions.crops.map((crop) => {
          const totals = cropTotals(assumptions, overrides, crop)
          return (
            <button
              key={crop.cropCode}
              type="button"
              onClick={() => onOpenCrop(crop.cropCode)}
              className={cn(
                OVERVIEW_GRID_CLASS,
                'w-full border-b py-2 text-left text-[13px] transition-colors hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none focus-visible:ring-inset',
              )}
            >
              <span className="flex min-w-0 items-center gap-2">
                <CropGroupTile
                  group={cropGroupFor(crop.cropCode, crop.cropName)}
                />
                <span className="min-w-0 truncate">{crop.cropName}</span>
                {isCropCustomised(overrides, crop) ? <CustomisedDot /> : null}
              </span>
              <span className="text-right tabular-nums">
                {formatWholeNumber(totals.revenueDkkHa)}
              </span>
              <span className="text-right tabular-nums">
                +{formatWholeNumber(totals.subsidyDkkHa)}
              </span>
              <span className="text-right tabular-nums">
                −{formatWholeNumber(totals.totalCostsDkkHa)}
              </span>
              <span className="text-right font-semibold tabular-nums">
                {formatDbDkk(totals.dbDkkHa)}
              </span>
            </button>
          )
        })}
        <p className="bg-muted/30 px-5 py-2.5 text-[11px] text-muted-foreground">
          Gødning er ikke med i omkostningerne, for den regnes ud fra
          kvælstofnormen i hver simulering.
        </p>
      </div>
    </div>
  </div>
)

type EconomicsAssumptionsEditorProps = {
  assumptions: EconomicsAssumptions
  overrides: EconomicsOverrides
  onOverridesChange?: (change: OverridesChange) => void
  focus?: { cropCode: number; lineId: string; key: string }
}

export const EconomicsAssumptionsEditor = ({
  assumptions,
  overrides,
  onOverridesChange,
  focus,
}: EconomicsAssumptionsEditorProps) => {
  const [activeCode, setActiveCode] = useState<number | null>(null)
  const [search, setSearch] = useState('')
  const [shownFocus, setShownFocus] = useState<string | null>(null)

  if (focus && focus.key !== shownFocus) {
    setShownFocus(focus.key)
    setActiveCode(focus.cropCode)
  }

  const active = assumptions.crops.find((crop) => crop.cropCode === activeCode)
  const crops = searchCrops(assumptions.crops, search)

  return (
    <div className="grid gap-4 md:grid-cols-[14rem_minmax(0,1fr)] md:items-start">
      <nav
        aria-label="Afgrøder"
        className={cn(RULES_CARD_CLASS, 'p-2 md:sticky md:top-4')}
      >
        <div className="relative mb-1.5">
          <Search
            className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground"
            aria-hidden="true"
          />
          <Input
            type="search"
            aria-label="Søg afgrøde"
            placeholder="Søg afgrøde"
            className="h-8 pl-8 text-[13px]"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
        </div>
        <ul className="space-y-0.5">
          <li>
            <button
              type="button"
              aria-current={active ? undefined : 'true'}
              className={LIST_ITEM_CLASS}
              onClick={() => setActiveCode(null)}
            >
              <LayoutList
                className="size-4 shrink-0 text-muted-foreground"
                aria-hidden="true"
              />
              Alle afgrøder
            </button>
          </li>
          {crops.map((crop) => (
            <li key={crop.cropCode}>
              <button
                type="button"
                aria-current={crop === active ? 'true' : undefined}
                className={LIST_ITEM_CLASS}
                onClick={() => setActiveCode(crop.cropCode)}
              >
                <CropGroupTile
                  group={cropGroupFor(crop.cropCode, crop.cropName)}
                />
                <span className="min-w-0 flex-1 truncate">{crop.cropName}</span>
                {isCropCustomised(overrides, crop) ? <CustomisedDot /> : null}
                <span className="font-normal text-muted-foreground tabular-nums">
                  {formatDbDkk(
                    cropTotals(assumptions, overrides, crop).dbDkkHa,
                  )}
                </span>
              </button>
            </li>
          ))}
        </ul>
        {crops.length === 0 ? (
          <p className="px-2 py-1.5 text-[13px] text-muted-foreground">
            Ingen afgrøder passer til søgningen.
          </p>
        ) : null}
        <p className="px-2 pt-2 pb-1 text-[11px] text-muted-foreground">
          Tallene er dækningsbidrag i kr/ha.
        </p>
      </nav>

      <section
        aria-label={
          active ? `Priser og mængder for ${active.cropName}` : 'Alle afgrøder'
        }
        className={cn(RULES_CARD_CLASS, 'overflow-hidden')}
      >
        {active ? (
          <EconomicsCropDetail
            key={active.cropCode}
            assumptions={assumptions}
            overrides={overrides}
            crop={active}
            onOverridesChange={onOverridesChange}
            focus={
              focus?.cropCode === active.cropCode
                ? { lineId: focus.lineId, key: focus.key }
                : undefined
            }
          />
        ) : (
          <CropsOverview
            assumptions={assumptions}
            overrides={overrides}
            onOpenCrop={setActiveCode}
          />
        )}
      </section>
    </div>
  )
}
