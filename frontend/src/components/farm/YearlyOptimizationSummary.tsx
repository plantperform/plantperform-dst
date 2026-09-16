import type { ReactNode } from 'react'

import type { CropCodeOption } from '@/api/types'
import {
  catchmentKey,
  type CatchmentOption,
} from '@/components/farm/catchment-options'
import { ROTATION_CALENDAR_YEARS, formatNumber } from '@/lib/field-domain'
import {
  toYearlyOptimizeSimulationInput,
  type YearlyOptimizeFormValues,
} from '@/lib/yearly-optimization-form'

type YearlyOptimizationSummaryProps = {
  values: YearlyOptimizeFormValues
  catchments: CatchmentOption[]
  crops: CropCodeOption[]
  fieldCount: number
  estimatedSeconds: number
  onEditStep: (stepIndex: number) => void
}

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

const describeCaps = (maxNLoadByYear: Record<number, number>) => {
  const caps = ROTATION_CALENDAR_YEARS.map((year) => maxNLoadByYear[year])
  if (caps.every((cap) => cap === undefined)) return 'Ingen grænse'
  if (caps.every((cap) => cap === caps[0])) {
    return `${formatNumber(caps[0]!)} kg N hvert år`
  }
  return ROTATION_CALENDAR_YEARS.map(
    (year, index) =>
      `${year}: ${caps[index] === undefined ? 'ingen' : `${formatNumber(caps[index])} kg N`}`,
  ).join(' · ')
}

export const YearlyOptimizationSummary = ({
  values,
  catchments,
  crops,
  fieldCount,
  estimatedSeconds,
  onEditStep,
}: YearlyOptimizationSummaryProps) => {
  // Summarise what will be sent, not the raw draft, so the two cannot differ.
  const input = toYearlyOptimizeSimulationInput(
    values,
    catchments.map((catchment) => ({
      catchmentId: catchment.catchmentId,
      key: catchmentKey(catchment.catchmentId),
    })),
  )
  const excluded = crops.filter((crop) =>
    input.excludedCropCodes?.includes(crop.code),
  )

  return (
    <div className="space-y-4">
      <div className="divide-y">
        <Section title="Grænser" stepIndex={0} onEditStep={onEditStep}>
          {catchments.length === 0 ? (
            <p>Ingen marker med et kystvandopland.</p>
          ) : (
            <ul className="space-y-0.5">
              {catchments.map((catchment, index) => (
                <li key={catchmentKey(catchment.catchmentId)}>
                  <span className="text-foreground">{catchment.label}</span>:{' '}
                  {describeCaps(
                    input.maxNLoadByCatchment?.[index]?.maxNLoadByYear ?? {},
                  )}
                </li>
              ))}
            </ul>
          )}
          <p>
            Maks. udsving i DB2 mellem år:{' '}
            {input.db2SwingPct == null
              ? 'Ingen grænse'
              : `${formatNumber(input.db2SwingPct)} %`}
          </p>
        </Section>

        <Section title="Afgrøder" stepIndex={1} onEditStep={onEditStep}>
          {excluded.length === 0 ? (
            <p>Alle {crops.length} afgrøder er med.</p>
          ) : (
            <p>
              {crops.length - excluded.length} af {crops.length} med · fravalgt:{' '}
              <span className="text-foreground">
                {excluded.map((crop) => crop.name).join(', ')}
              </span>
            </p>
          )}
        </Section>

        <Section title="Kørsel" stepIndex={2} onEditStep={onEditStep}>
          <p>
            Tidsgrænse: {formatNumber(input.timeLimitSeconds ?? 0)} sek. ·{' '}
            {fieldCount} marker · estimat ~
            {estimatedSeconds < 1 ? '<1' : Math.round(estimatedSeconds)} sek.
          </p>
        </Section>
      </div>

      <p className="rounded-md border bg-muted/40 p-3 text-xs text-muted-foreground">
        Indstillingerne gælder kun denne kørsel og gemmes ikke på
        simuleringen - noter dem, hvis du skal kunne gentage kørslen.
      </p>
    </div>
  )
}
