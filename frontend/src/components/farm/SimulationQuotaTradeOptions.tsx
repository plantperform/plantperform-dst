import type { FieldRecord, OptimizationSettings } from '@/api/types'
import {
  catchmentKey,
  useCatchmentOptions,
} from '@/components/farm/catchment-options'
import { Input } from '@/components/ui/input'
import { formatNumber } from '@/lib/field-domain'
import { OPTIMIZATION_KIND_LABELS } from '@/lib/optimization-run'
import {
  originalCapRange,
  quotaTradeBlock,
  type QuotaTradeDraft,
} from '@/lib/quota-trade-settings'
import { cn } from '@/lib/utils'

type Props = {
  farmId: string
  fields: FieldRecord[]
  settings: OptimizationSettings
  draft: QuotaTradeDraft
  onDraftChange: (draft: QuotaTradeDraft) => void
}

const capLabel = (range: { min: number; max: number } | undefined) =>
  range === undefined
    ? 'Ingen grænse'
    : range.min === range.max
      ? `${formatNumber(range.min)} kg N hvert år`
      : `${formatNumber(range.min)}–${formatNumber(range.max)} kg N pr. år`

export function SimulationQuotaTradeOptions({
  farmId,
  fields,
  settings,
  draft,
  onDraftChange,
}: Props) {
  const catchments = useCatchmentOptions(farmId, fields)

  if (settings.kind !== 'yearly')
    return (
      <p className="rounded-md border bg-muted/40 p-3 text-sm text-muted-foreground">
        Kvotehandel kræver, at udledningskvoten gælder som &quot;
        {OPTIMIZATION_KIND_LABELS.yearly}&quot;. Vælg det under Grundlag for at
        handle kvote.
      </p>
    )

  const patchCatchment = (
    catchmentId: number,
    value: Partial<QuotaTradeDraft['catchments'][number]>,
  ) =>
    onDraftChange({
      ...draft,
      catchments: {
        ...draft.catchments,
        [catchmentId]: {
          ...(draft.catchments[catchmentId] ?? { enabled: false, price: '' }),
          ...value,
        },
      },
    })

  return (
    <div className="space-y-4">
      <label className="flex items-start gap-3 rounded-md border bg-background p-3 text-sm">
        <input
          type="checkbox"
          className="mt-1"
          checked={draft.enabled}
          onChange={(event) =>
            onDraftChange({ ...draft, enabled: event.target.checked })
          }
        />
        <span>
          <span className="font-medium">Brug kvotehandel</span>
          <span className="block text-xs text-muted-foreground">
            Optimeringen må købe eller sælge udledningskvote til en fast pris i
            de kystvandoplande, du vælger. Den samme mængde handles i hvert år,
            og prisen betales pr. kg N pr. år.
          </span>
        </span>
      </label>

      {draft.enabled ? (
        <fieldset className="space-y-2">
          <legend className="text-sm font-medium">
            Kystvandoplande med kvotehandel
          </legend>
          {catchments.map((catchment) => {
            const { catchmentId } = catchment
            const block = quotaTradeBlock(catchmentId, fields, settings)
            const entry =
              catchmentId === null ? undefined : draft.catchments[catchmentId]
            const trading = block === null && Boolean(entry?.enabled)
            const range =
              catchmentId === null
                ? undefined
                : originalCapRange(catchmentId, fields, settings)
            return (
              <div
                key={catchmentKey(catchmentId)}
                className={cn(
                  'space-y-2 rounded-md border p-3 text-sm',
                  block !== null && 'bg-muted/40',
                )}
              >
                <label
                  className={cn(
                    'flex items-start gap-3',
                    block !== null && 'text-muted-foreground',
                  )}
                >
                  <input
                    type="checkbox"
                    className="mt-1"
                    checked={trading}
                    disabled={block !== null}
                    onChange={(event) => {
                      if (catchmentId !== null)
                        patchCatchment(catchmentId, {
                          enabled: event.target.checked,
                        })
                    }}
                  />
                  <span>
                    <span className="font-medium">{catchment.label}</span>
                    <span className="block text-xs text-muted-foreground">
                      {block ?? `Loft under Grænser: ${capLabel(range)}`}
                    </span>
                  </span>
                </label>
                {trading ? (
                  <label className="ml-7 block max-w-48 space-y-1 text-xs">
                    Pris (kr/kg N pr. år)
                    <Input
                      type="number"
                      min="0"
                      step="any"
                      value={entry?.price ?? ''}
                      onChange={(event) => {
                        if (catchmentId !== null)
                          patchCatchment(catchmentId, {
                            price: event.target.value,
                          })
                      }}
                    />
                  </label>
                ) : null}
              </div>
            )
          })}
        </fieldset>
      ) : null}
    </div>
  )
}
