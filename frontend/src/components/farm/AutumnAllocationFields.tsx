import type { AutumnCropOption, AutumnFertiliser } from '@/api/types'
import { FieldError } from '@/components/ui/field-error'
import { GlossaryInfo } from '@/components/GlossaryInfo'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { cropLabel } from '@/lib/crop-label'
import { formatWholeNumber } from '@/lib/field-domain'
import {
  AUTUMN_FERTILISER_LABELS,
  AUTUMN_N_EXTRA_LEACHING_PCT,
  autumnCropGroups,
  autumnDraftFor,
  withAutumnDraft,
  type AutumnAllocationDraft,
} from '@/lib/simulation-form'

const normRange = ({ normMinKgNHa, normMaxKgNHa }: AutumnCropOption) =>
  normMinKgNHa === normMaxKgNHa
    ? formatWholeNumber(normMinKgNHa)
    : `${formatWholeNumber(normMinKgNHa)}–${formatWholeNumber(normMaxKgNHa)}`

const ROW_GRID =
  'grid gap-x-3 gap-y-1.5 @lg:grid-cols-[minmax(0,1fr)_5.5rem_6rem_12.5rem] @lg:items-center'

type AutumnCropRowProps = {
  crop: AutumnCropOption
  draft: AutumnAllocationDraft
  forcedFertiliser: AutumnFertiliser | null
  onChange: (draft: AutumnAllocationDraft) => void
}

const AutumnCropRow = ({
  crop,
  draft,
  forcedFertiliser,
  onChange,
}: AutumnCropRowProps) => {
  const label = cropLabel(crop.cropCode, crop.name)
  return (
    <li className={`${ROW_GRID} border-t py-2 text-sm`}>
      <span className="min-w-0 font-medium break-words">{label}</span>
      <span className="text-xs text-muted-foreground tabular-nums @lg:text-sm">
        <span className="@lg:hidden">Norm </span>
        {normRange(crop)}
        <span className="@lg:hidden"> kg N/ha</span>
      </span>
      <Input
        type="number"
        min="0"
        inputMode="decimal"
        placeholder="0"
        aria-label={`Kg N/ha flyttet til efteråret for ${label}`}
        className="h-8 w-24"
        value={draft.kgNHa}
        onChange={(event) => onChange({ ...draft, kgNHa: event.target.value })}
      />
      {forcedFertiliser ? (
        <span className="text-xs text-muted-foreground">
          {AUTUMN_FERTILISER_LABELS[forcedFertiliser]}
        </span>
      ) : (
        <span
          role="radiogroup"
          aria-label={`Gødning om efteråret for ${label}`}
          className="flex flex-wrap gap-x-3 gap-y-1 text-xs"
        >
          {(['mineral', 'manure'] as const).map((fertiliserType) => (
            <label
              key={fertiliserType}
              className="flex cursor-pointer items-center gap-1.5"
            >
              <input
                type="radio"
                name={`autumn-fertiliser-${crop.cropCode}`}
                checked={draft.fertiliserType === fertiliserType}
                onChange={() => onChange({ ...draft, fertiliserType })}
              />
              {AUTUMN_FERTILISER_LABELS[fertiliserType]}
            </label>
          ))}
        </span>
      )}
    </li>
  )
}

type AutumnAllocationFieldsProps = {
  crops: AutumnCropOption[]
  loading: boolean
  loadFailed: boolean
  enabled: boolean
  allocations: AutumnAllocationDraft[]
  forcedFertiliser: AutumnFertiliser | null
  error?: string
  onEnabledChange: (enabled: boolean) => void
  onAllocationsChange: (allocations: AutumnAllocationDraft[]) => void
}

export const AutumnAllocationFields = ({
  crops,
  loading,
  loadFailed,
  enabled,
  allocations,
  forcedFertiliser,
  error,
  onEnabledChange,
  onAllocationsChange,
}: AutumnAllocationFieldsProps) => (
  <div className="@container space-y-2">
    <div className="flex items-center gap-1">
      <Label>Efterårstildeling</Label>
      <GlossaryInfo term="autumnAllocation" />
    </div>
    <label className="flex items-start gap-3 rounded-md border bg-background p-3 text-sm">
      <input
        type="checkbox"
        className="mt-1"
        checked={enabled}
        onChange={(event) => onEnabledChange(event.target.checked)}
      />
      <span>
        <span className="font-medium">Flyt en del af normen til efteråret</span>
        <span className="block text-xs text-muted-foreground">
          Det flyttede kvælstof trækkes fra forårstildelingen året efter og
          lægges i efterårets udvaskningsår.
        </span>
        <span className="block text-xs text-muted-foreground">
          1 kg mineralsk N om efteråret koster{' '}
          {formatWholeNumber(AUTUMN_N_EXTRA_LEACHING_PCT)} % mere i udvaskning
          end 1 kg om foråret i samme udvaskningsår.
        </span>
      </span>
    </label>

    {enabled ? (
      <div className="space-y-2">
        {loading ? (
          <p className="text-xs text-muted-foreground">Henter afgrøder...</p>
        ) : loadFailed ? (
          <p className="text-xs text-warning-strong">
            Kunne ikke hente afgrøderne. Prøv igen senere.
          </p>
        ) : crops.length === 0 ? (
          <p className="text-xs text-muted-foreground">
            De valgte sædskifter har ingen afgrøder, der kan få kvælstof om
            efteråret.
          </p>
        ) : (
          <>
            <div
              className={`${ROW_GRID} hidden text-xs text-muted-foreground @lg:grid`}
            >
              <span>Afgrøde</span>
              <span>Norm (kg N/ha)</span>
              <span>Flyt (kg N/ha)</span>
              <span>Gødning om efteråret</span>
            </div>
            {autumnCropGroups(crops).map(({ group, crops: groupCrops }) => (
              <div key={group}>
                <p className="pb-1 text-xs font-semibold">{group}</p>
                <ul>
                  {groupCrops.map((crop) => (
                    <AutumnCropRow
                      key={crop.cropCode}
                      crop={crop}
                      draft={autumnDraftFor(allocations, crop.cropCode)}
                      forcedFertiliser={forcedFertiliser}
                      onChange={(draft) =>
                        onAllocationsChange(withAutumnDraft(allocations, draft))
                      }
                    />
                  ))}
                </ul>
              </div>
            ))}
            <FieldError id="scenario-autumn-error" message={error} />
            <p className="text-xs text-muted-foreground">
              Der flyttes højst den mængde, afgrøden må få på den enkelte mark.
              Græs får kun kvælstof om efteråret, når græsset fortsætter året
              efter. Nettoeffekten på udvaskningen er ofte mindre end procenten,
              fordi forårstildelingen året efter falder tilsvarende.
            </p>
          </>
        )}
      </div>
    ) : null}
  </div>
)
