import { SlidersHorizontal, Pencil } from 'lucide-react'
import { useId } from 'react'

import { useCropCodes } from '@/api/hooks'
import type { CropCodeOption, Simulation } from '@/api/types'
import { GlossaryInfo, type GlossaryTerm } from '@/components/GlossaryInfo'
import { Button } from '@/components/ui/button'
import { cropLabelByCode } from '@/lib/crop-label'
import { formatNumber } from '@/lib/field-domain'
import {
  autumnAllocationLabel,
  catchCropSowingLabel,
  nNormPercentagesLabel,
  organicFertiliserNLabel,
  precedingCropValueLabel,
  yesNo,
} from '@/lib/simulation-form'

type BasisValue = {
  label: string
  value: string
  term?: GlossaryTerm
}

const basisValues = (
  simulation: Simulation,
  cropCodes: CropCodeOption[],
): BasisValue[] => {
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
      label: 'Mineralsk N fra organisk gødning',
      value: organicFertiliserNLabel(fertiliser),
    },
    {
      label: 'Mineralsk andel',
      value: `${formatNumber(fertiliser.mineralSharePct)} %`,
    },
    {
      label: 'Mineralsk N-indhold',
      value: `${formatNumber(fertiliser.nContentKgPerTon)} kg N/ton`,
    },
    { label: 'Kun organisk gødning', value: yesNo(fertiliser.onlyOrganic) },
    ...(simulation.includePrecedingCropValue === undefined
      ? []
      : [
          {
            label: 'Forfrugtsværdi',
            value: precedingCropValueLabel(
              simulation.includePrecedingCropValue,
            ),
          },
        ]),
    {
      label: 'Efterårstildeling',
      term: 'autumnAllocation',
      value: autumnAllocationLabel(fertiliser.autumnAllocations ?? [], (code) =>
        cropLabelByCode(code, cropCodes),
      ),
    },
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
  onEditBasis: () => void
}

export const SimulationBasisCard = ({
  simulation,
  onEditBasis,
}: SimulationBasisCardProps) => {
  const id = useId()
  const cropCodes = useCropCodes(simulation.farmId).data ?? []

  return (
    <section
      className="min-w-0 rounded-lg border bg-muted/30"
      aria-labelledby={`${id}-title`}
    >
      <div className="flex items-center gap-3 px-5 py-2.5">
        <SlidersHorizontal
          className="size-3.5 shrink-0 text-muted-foreground"
          aria-hidden="true"
        />
        <div className="shrink-0">
          <h3 id={`${id}-title`} className="text-sm font-semibold">
            Simuleringens grundlag
          </h3>
          <p className="text-xs text-muted-foreground">Gemte indstillinger</p>
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="ml-auto shrink-0"
          onClick={onEditBasis}
        >
          <Pencil className="size-3.5" aria-hidden="true" />
          Ret grundlag
        </Button>
      </div>
      <div className="border-t">
        <p className="px-5 pt-3 pl-11.5 text-xs text-muted-foreground">
          Ret indstillingerne og kør optimeringen igen. Markernes regler og
          manuelle valg bevares.
        </p>
        <dl className="grid grid-cols-3 gap-x-4 gap-y-3 px-5 pt-3 pb-4 pl-11.5">
          {basisValues(simulation, cropCodes).map((value) => (
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
