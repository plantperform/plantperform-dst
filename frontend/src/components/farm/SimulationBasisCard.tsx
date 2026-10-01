import { Lock } from 'lucide-react'
import { useId } from 'react'

import type { Simulation } from '@/api/types'
import { GlossaryInfo, type GlossaryTerm } from '@/components/GlossaryInfo'
import { formatNumber } from '@/lib/field-domain'
import {
  catchCropSowingLabel,
  nNormPercentagesLabel,
  yesNo,
} from '@/lib/simulation-form'

type BasisValue = {
  label: string
  value: string
  term?: GlossaryTerm
}

const basisValues = (simulation: Simulation): BasisValue[] => {
  const { fertiliser } = simulation
  return [
    {
      label: 'Sædskiftevarianter',
      term: 'rotation',
      value: `${simulation.rotationVariants.length} valgt`,
    },
    {
      label: 'N-norm',
      term: 'nNorm',
      value: nNormPercentagesLabel(simulation.nNormPercentages),
    },
    { label: 'Driftsform', value: fertiliser.farmingSystem },
    {
      label: 'Udnyttet N fra organisk gødning',
      value: `${formatNumber(fertiliser.orgMineralN)} kg N/ha`,
    },
    {
      label: 'Mineralsk andel',
      value: `${formatNumber(fertiliser.mineralSharePct)} %`,
    },
    {
      label: 'Udnyttet N-indhold',
      value: `${formatNumber(fertiliser.nContentKgPerTon)} kg N/ton`,
    },
    { label: 'Kun organisk gødning', value: yesNo(fertiliser.onlyOrganic) },
    {
      label: 'Efterafgrøde',
      term: 'catchCrop',
      value: catchCropSowingLabel(
        simulation.catchCropSowingDate,
        simulation.catchCropDailyBasis,
      ),
    },
    { label: 'Præcisionsjordbrug', value: yesNo(simulation.precisionFarming) },
    { label: 'Tidlig såning', value: yesNo(simulation.earlySowing) },
    { label: 'Mellemafgrøde', value: yesNo(simulation.intermediateCrop) },
  ]
}

type SimulationBasisCardProps = {
  simulation: Simulation
}

export const SimulationBasisCard = ({
  simulation,
}: SimulationBasisCardProps) => {
  const id = useId()

  return (
    <section
      className="min-w-0 rounded-lg border bg-muted/30"
      aria-labelledby={`${id}-title`}
    >
      <div className="flex items-center gap-3 px-5 py-2.5">
        <Lock
          className="size-3.5 shrink-0 text-muted-foreground"
          aria-hidden="true"
        />
        <div className="shrink-0">
          <h3 id={`${id}-title`} className="text-sm font-semibold">
            Simuleringens grundlag
          </h3>
          <p className="text-xs text-muted-foreground">Låst ved oprettelse</p>
        </div>
      </div>
      <div className="border-t">
        <p className="px-5 pt-3 pl-11.5 text-xs text-muted-foreground">
          Kandidaterne blev genereret ud fra dette og kan ikke ændres på
          simuleringen.
        </p>
        <dl className="grid grid-cols-3 gap-x-4 gap-y-3 px-5 pt-3 pb-4 pl-11.5">
          {basisValues(simulation).map((value) => (
            <div key={value.label} className="min-w-0">
              <dt className="flex items-center gap-1 text-xs text-muted-foreground">
                {value.label}
                {value.term ? <GlossaryInfo term={value.term} /> : null}
              </dt>
              <dd className="mt-0.5 text-[13px] font-medium">{value.value}</dd>
            </div>
          ))}
        </dl>
      </div>
    </section>
  )
}
