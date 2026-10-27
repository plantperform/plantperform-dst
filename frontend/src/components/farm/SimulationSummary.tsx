import { AlertTriangle } from 'lucide-react'
import type { ReactNode } from 'react'

import { GlossaryInfo, type GlossaryTerm } from '@/components/GlossaryInfo'
import type {
  FieldRecord,
  FertiliserPresetOption,
  OptimizationConstraints,
  OptimizationSettings,
  RotationCategoryOption,
} from '@/api/types'
import { useCropCodes } from '@/api/hooks'
import {
  catchmentKey,
  effectiveMaxNLoadByCatchment,
  useCatchmentOptions,
} from '@/components/farm/catchment-options'
import { NotInCalculationNote } from '@/components/farm/economics-ui'
import type { EconomicsProfile } from '@/lib/economics-profiles'
import {
  formatFieldCount,
  formatNumber,
  ROTATION_CALENDAR_YEARS,
} from '@/lib/field-domain'
import { OPTIMIZATION_KIND_LABELS } from '@/lib/optimization-run'
import { sowingDateEffectPercent } from '@/lib/nles5-detail-labels'
import {
  CUSTOM_FERTILISER,
  NO_FERTILISER,
  SIMULATION_FORM_STEPS,
  catchCropSowingLabel,
  combinationCount,
  farmingSystemMismatchCount,
  farmingSystemMismatchMessage,
  isPresetModified,
  nNormPercentagesLabel,
  organicFertiliserNLabel,
  precedingCropValueLabel,
  selectedCountsByCategory,
  selectedRotations,
  stepIndexOf,
  toCreateSimulationInput,
  yesNo,
  type SimulationFormStepId,
  type SimulationFormValues,
} from '@/lib/simulation-form'

type SimulationSummaryProps = {
  farmId: string
  fields: FieldRecord[]
  values: SimulationFormValues
  categories: RotationCategoryOption[]
  fertiliserPresets: FertiliserPresetOption[]
  settings: OptimizationSettings
  constraints: OptimizationConstraints
  economicsProfile: EconomicsProfile
  // Indexes of the steps each section links back to.
  onEditStep: (stepIndex: number) => void
}

const Section = ({
  step,
  term,
  onEditStep,
  children,
}: {
  step: SimulationFormStepId
  term?: GlossaryTerm
  onEditStep: (stepIndex: number) => void
  children: ReactNode
}) => {
  const stepIndex = stepIndexOf(step)
  const title = SIMULATION_FORM_STEPS[stepIndex].label
  return (
    <section className="space-y-1.5 py-3 first:pt-0">
      <div className="flex items-baseline justify-between gap-2">
        <h3 className="flex items-center gap-1 text-sm font-medium">
          {title}
          {term ? <GlossaryInfo term={term} /> : null}
        </h3>
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
}

export const SimulationSummary = ({
  farmId,
  fields,
  values,
  categories,
  fertiliserPresets,
  settings,
  constraints,
  economicsProfile,
  onEditStep,
}: SimulationSummaryProps) => {
  const fieldCount = fields.length
  const catchments = useCatchmentOptions(farmId, fields)
  const crops = useCropCodes(farmId)
  const cropName = (code: number) =>
    crops.data?.find((crop) => crop.code === code)?.name ?? `Afgrøde ${code}`
  const quotas = effectiveMaxNLoadByCatchment(fields, [])
  const averageCaps = effectiveMaxNLoadByCatchment(
    fields,
    constraints.maxNLoadByCatchment,
  )
  const capLabel = (cap: number | null | undefined, unit: string) =>
    cap === null || cap === undefined
      ? 'Ingen grænse'
      : `${formatNumber(cap)} ${unit}`
  // Summarise what will be sent, not the raw draft, so the two cannot differ.
  const input = toCreateSimulationInput(values)
  const fertiliser = input.fertiliser!
  const rotationVariants = input.allowedRotationVariants ?? []
  const nNormPercentages = input.allowedNNormPercentages ?? []
  const includePrecedingCropValue = input.includePrecedingCropValue !== false

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
  const combinations = combinationCount(values, fieldCount)

  return (
    <div className="space-y-4">
      <div className="divide-y">
        <Section step="basics" term="simulation" onEditStep={onEditStep}>
          <p className="text-foreground">{input.name}</p>
          <p>
            {values.farmingSystem} · {formatFieldCount(fieldCount)}
          </p>
          <p>Udledningskvote: {OPTIMIZATION_KIND_LABELS[settings.kind]}</p>
          <p>Økonomiprofil: {economicsProfile.name}</p>
        </Section>

        <Section step="crops" onEditStep={onEditStep}>
          <p className="text-foreground">{values.chosenCrops.join(' · ')}</p>
          {values.optedOutCrops.length > 0 ? (
            <p>Fravalgt: {values.optedOutCrops.join(' · ')}</p>
          ) : null}
        </Section>

        <Section step="rotations" term="rotation" onEditStep={onEditStep}>
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
            <p className="flex gap-1.5 text-warning-strong">
              <AlertTriangle
                className="mt-0.5 size-3.5 shrink-0"
                aria-hidden="true"
              />
              {farmingSystemMismatchMessage(
                mismatchCount,
                values.farmingSystem,
              )}
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

        <Section step="nitrogen" onEditStep={onEditStep}>
          {values.fertiliserChoice === NO_FERTILISER ? (
            <p>Ingen organisk gødning (ren handelsgødning)</p>
          ) : (
            <p>
              <span className="text-foreground">{fertiliserLabel}</span> ·{' '}
              {organicFertiliserNLabel(fertiliser)} ·{' '}
              {formatNumber(fertiliser.mineralSharePct)} % mineralsk ·{' '}
              {formatNumber(fertiliser.nContentKgPerTon)} kg N/ton
            </p>
          )}
          <p>Kun organisk gødning: {yesNo(fertiliser.onlyOrganic)}</p>
          <p>
            N-norm <GlossaryInfo term="nNorm" />:{' '}
            {nNormPercentagesLabel(nNormPercentages)}
          </p>
          <p>
            Forfrugtsværdi: {precedingCropValueLabel(includePrecedingCropValue)}
            {includePrecedingCropValue ? null : <NotInCalculationNote />}
          </p>
        </Section>

        <Section step="practice" onEditStep={onEditStep}>
          <p>
            Efterafgrøde <GlossaryInfo term="catchCrop" />:{' '}
            {catchCropSowingLabel(
              input.catchCropSowingDate ?? '',
              Boolean(input.catchCropDailyBasis),
            )}{' '}
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
        <Section step="limits" onEditStep={onEditStep}>
          {catchments.map((catchment) => {
            const cap = settings.maxNLoadByCatchment.find(
              (entry) => entry.catchmentId === catchment.catchmentId,
            )
            return settings.kind === 'yearly' ? (
              <p key={catchmentKey(catchment.catchmentId)}>
                {catchment.label} · Loft hvert år:{' '}
                {ROTATION_CALENDAR_YEARS.map(
                  (year) =>
                    `${year}: ${capLabel(cap ? cap.maxNLoadByYear[year] : quotas.get(catchmentKey(catchment.catchmentId)), 'kg N')}`,
                ).join(' · ')}
              </p>
            ) : (
              <p key={catchmentKey(catchment.catchmentId)}>
                {catchment.label} · Maks. gennemsnitlig udledning:{' '}
                {capLabel(
                  averageCaps.get(catchmentKey(catchment.catchmentId)),
                  'kg N',
                )}
              </p>
            )
          })}
          {settings.kind === 'yearly' ? (
            <p>
              Maks. udsving i DB2 mellem år:{' '}
              {capLabel(settings.db2SwingPct, '%')}
            </p>
          ) : null}
          <p>
            Min. foderenheder: {capLabel(constraints.minFeedUnits, 'FE')} ·
            Maks. foderenheder: {capLabel(constraints.maxFeedUnits, 'FE')}
          </p>
          {constraints.cropAreaLimits.length === 0 ? (
            <p>Arealgrænser for afgrøder: Ingen grænser</p>
          ) : (
            constraints.cropAreaLimits.map((limit) => (
              <p key={limit.cropCode}>
                {cropName(limit.cropCode)} · Min.:{' '}
                {capLabel(limit.minAreaHa, 'ha')} · Maks.:{' '}
                {capLabel(limit.maxAreaHa, 'ha')}
              </p>
            ))
          )}
          <p>
            Udelukkede afgrøder:{' '}
            {settings.excludedCropCodes.length > 0
              ? settings.excludedCropCodes.map(cropName).join(' · ')
              : 'Ingen'}
          </p>
        </Section>
        <Section step="quotaTrade" onEditStep={onEditStep}>
          {settings.quotaTrades.length === 0 ? (
            <p>Ingen kvotehandel</p>
          ) : (
            <>
              {settings.quotaTrades.map((trade) => (
                <p key={trade.catchmentId}>
                  <span className="text-foreground">
                    {catchments.find(
                      (catchment) => catchment.catchmentId === trade.catchmentId,
                    )?.label ?? `Kystvandopland ${trade.catchmentId}`}
                  </span>{' '}
                  · {formatNumber(trade.priceDkkPerKg)} kr/kg N pr. år
                </p>
              ))}
              <p>
                Optimeringen vælger, hvor meget kvote der købes eller sælges.
                {settings.quotaTrades.every(
                  (trade) => trade.sameEachYear !== false,
                )
                  ? ' Mængden er den samme i alle år.'
                  : ' Mængden kan være forskellig fra år til år.'}
              </p>
            </>
          )}
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
        baggrunden, når du kører optimeringen - det kan tage et øjeblik.
      </p>
    </div>
  )
}
