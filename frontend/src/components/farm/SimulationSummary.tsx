import { AlertTriangle } from 'lucide-react'
import type { ReactNode } from 'react'

import type {
  FertiliserPresetOption,
  RotationCategoryOption,
} from '@/api/types'
import { formatFieldCount, formatNumber } from '@/lib/field-domain'
import {
  SOWING_DATE_INTERVALS,
  sowingDateEffectPercent,
} from '@/lib/nles5-detail-labels'
import {
  CUSTOM_FERTILISER,
  NO_FERTILISER,
  combinationCount,
  farmingSystemMismatchCount,
  farmingSystemMismatchMessage,
  isPresetModified,
  selectedCountsByCategory,
  selectedRotations,
  toCreateSimulationInput,
  type SimulationFormValues,
} from '@/lib/simulation-form'

type SimulationSummaryProps = {
  values: SimulationFormValues
  categories: RotationCategoryOption[]
  fertiliserPresets: FertiliserPresetOption[]
  fieldCount: number
  // Indexes of the steps each section links back to.
  onEditStep: (stepIndex: number) => void
}

const yesNo = (value: boolean) => (value ? 'Ja' : 'Nej')

const Section = ({
  title,
  stepIndex,
  onEditStep,
  children,
}: {
  title: string
  stepIndex: number
  onEditStep: (stepIndex: number) => void
  children: ReactNode
}) => (
  <section className="space-y-1.5 py-3 first:pt-0">
    <div className="flex items-baseline justify-between gap-2">
      <h3 className="text-sm font-medium">{title}</h3>
      <button
        type="button"
        className="rounded-sm text-xs font-medium text-primary underline underline-offset-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        aria-label={`Ret ${title}`}
        onClick={() => onEditStep(stepIndex)}
      >
        Ret
      </button>
    </div>
    <div className="space-y-1 text-xs text-muted-foreground">{children}</div>
  </section>
)

export const SimulationSummary = ({
  values,
  categories,
  fertiliserPresets,
  fieldCount,
  onEditStep,
}: SimulationSummaryProps) => {
  // Summarise what will be sent, not the raw draft, so the two cannot differ.
  const input = toCreateSimulationInput(values)
  const fertiliser = input.fertiliser!
  const rotationVariants = input.allowedRotationVariants ?? []
  const nNormPercentages = [...(input.allowedNNormPercentages ?? [])].sort(
    (a, b) => Number(a) - Number(b),
  )

  const mismatchCount = farmingSystemMismatchCount(
    categories,
    rotationVariants,
    values.farmingSystem,
  )
  const fertiliserLabel =
    values.fertiliserChoice === CUSTOM_FERTILISER
      ? 'Brugerdefineret'
      : `${values.fertiliserChoice}${
          isPresetModified(values, fertiliserPresets) ? ' (tilpasset)' : ''
        }`
  const sowingInterval = SOWING_DATE_INTERVALS.find(
    (interval) => interval.date === input.catchCropSowingDate,
  )
  const combinations = combinationCount(values, fieldCount)

  return (
    <div className="space-y-4">
      <div className="divide-y">
        <Section title="Grundlag" stepIndex={0} onEditStep={onEditStep}>
          <p className="text-foreground">{input.name}</p>
          <p>
            {values.farmingSystem} · {formatFieldCount(fieldCount)}
          </p>
        </Section>

        <Section title="Sædskifter" stepIndex={1} onEditStep={onEditStep}>
          <p>
            <span className="text-foreground">
              {rotationVariants.length} valgt
            </span>
            {' - '}
            {selectedCountsByCategory(categories, rotationVariants)
              .map(({ category, count }) => `${category} ${count}`)
              .join(' · ')}
          </p>
          {mismatchCount > 0 ? (
            <p className="flex gap-1.5 text-amber-800">
              <AlertTriangle
                className="mt-0.5 size-3.5 shrink-0"
                aria-hidden="true"
              />
              {farmingSystemMismatchMessage(mismatchCount, values.farmingSystem)}
            </p>
          ) : null}
          <details className="group">
            <summary className="cursor-pointer text-primary">
              Vis alle {rotationVariants.length}
            </summary>
            <ul className="mt-1.5 space-y-0.5 border-l pl-3">
              {selectedRotations(categories, rotationVariants).map(
                (rotation) => (
                  <li key={rotation.rotationVariant} className="break-words">
                    {rotation.cropSequence.join(' · ')}
                  </li>
                ),
              )}
            </ul>
          </details>
        </Section>

        <Section title="Kvælstof" stepIndex={2} onEditStep={onEditStep}>
          {values.fertiliserChoice === NO_FERTILISER ? (
            <p>Ingen organisk gødning (ren handelsgødning)</p>
          ) : (
            <p>
              <span className="text-foreground">{fertiliserLabel}</span> ·{' '}
              {formatNumber(fertiliser.orgMineralN)} kg N/ha ·{' '}
              {formatNumber(fertiliser.mineralSharePct)} % mineralsk ·{' '}
              {formatNumber(fertiliser.nContentKgPerTon)} kg N/ton
            </p>
          )}
          <p>Kun organisk gødning: {yesNo(fertiliser.onlyOrganic)}</p>
          <p>N-norm: {nNormPercentages.map((value) => `${value} %`).join(', ')}</p>
        </Section>

        <Section title="Dyrkningspraksis" stepIndex={3} onEditStep={onEditStep}>
          <p>
            Efterafgrøde:{' '}
            {input.catchCropDailyBasis
              ? `${input.catchCropSowingDate} · dagsbasis §38`
              : `${sowingInterval?.label ?? input.catchCropSowingDate} · trappesats §37`}{' '}
            · EEA-effekt{' '}
            {formatNumber(
              sowingDateEffectPercent(
                input.catchCropSowingDate ?? '',
                Boolean(input.catchCropDailyBasis),
              ),
            )}{' '}
            %
          </p>
          <p>
            Præcisionsjordbrug: {yesNo(Boolean(input.precisionFarming))} ·
            Tidlig såning: {yesNo(Boolean(input.earlySowing))} · Mellemafgrøde:{' '}
            {yesNo(Boolean(input.intermediateCrop))}
          </p>
        </Section>
      </div>

      <p className="rounded-md border bg-muted/40 p-3 text-xs text-muted-foreground">
        {rotationVariants.length} sædskifter × {nNormPercentages.length} N-norm-
        {nNormPercentages.length === 1 ? 'niveau' : 'niveauer'} ×{' '}
        {formatFieldCount(fieldCount)} ={' '}
        <span className="font-medium text-foreground">
          {combinations.toLocaleString('da-DK')} kombinationer
        </span>
        . Sædskifter med flere varianter giver flere kandidater. Alle beregnes i
        baggrunden, når simuleringen oprettes - det kan tage et øjeblik.
      </p>
    </div>
  )
}
