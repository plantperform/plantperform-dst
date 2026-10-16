import { RefreshCw } from 'lucide-react'
import { useId, useState } from 'react'

import { useFarmBudgets } from '@/api/economics'
import { useOptimizationRun } from '@/api/optimization-runs'
import type { FieldRecord, Simulation } from '@/api/types'
import { CropGroupTile } from '@/components/farm/CropGroupTile'
import { useStartGuide } from '@/components/farm/economics-navigation'
import { useEconomicsProfiles } from '@/components/farm/economics-profiles-state'
import {
  BudgetsGate,
  DbDelta,
  DbDeltaBar,
  GRID_HEAD_CLASS,
  TEXT_LINK_CLASS,
} from '@/components/farm/economics-ui'
import { EconomicsProfileMenu } from '@/components/farm/EconomicsProfileMenu'
import { KeyFigure } from '@/components/farm/OverviewCard'
import {
  RULES_CARD_CLASS,
  RULES_CARD_HEAD_CLASS,
} from '@/components/farm/rules-ui'
import { TruncatedTooltip } from '@/components/ui/app-tooltip'
import { Button } from '@/components/ui/button'
import { cropGroupFor, shortCropName } from '@/lib/crop-groups'
import {
  budgetSoilType,
  dbDeltaScale,
  describeProfileChanges,
  formatCropNames,
  formatNameList,
  formatSignedDkk,
  NO_SOIL_TYPE_NOTE,
  profileChanges,
  type EconomicsAssumptions,
} from '@/lib/economics'
import {
  describeAppliedProfile,
  ECONOMICS_INVITATION,
  STANDARD_PROFILE,
  STANDARD_PROFILE_ID,
  STANDARD_SOURCE,
} from '@/lib/economics-profiles'
import { formatNumber } from '@/lib/field-domain'
import {
  simulationEconomicsEffect,
  type SimulationEconomicsEffect,
} from '@/lib/simulation-economics'
import { cn } from '@/lib/utils'

const GRID_CLASS =
  'grid min-w-152 grid-cols-[minmax(9rem,18rem)_6rem_6rem_minmax(5rem,1fr)_6.5rem] items-center gap-x-3 px-5'

const ROW_CLASS = cn(
  GRID_CLASS,
  'grid-rows-[1.75rem] border-b py-1 text-[13px] tabular-nums',
)

const NOTE_CLASS = 'border-t px-5 py-4 text-[13px] text-muted-foreground'

type EffectTableProps = {
  effect: SimulationEconomicsEffect
}

const EffectTable = ({ effect }: EffectTableProps) => {
  const scale = dbDeltaScale(effect.crops.map((crop) => crop.deltaDkk))
  const otherAreaHa = effect.otherCrops.reduce(
    (total, crop) => total + crop.areaHa,
    0,
  )
  const areaHa = effect.crops.reduce(
    (total, crop) => total + crop.areaHa,
    otherAreaHa,
  )
  const otherCropsNote = `${formatNameList(
    effect.otherCrops.map((crop) => shortCropName(crop.cropName)),
  )} har ingen tal i økonomien endnu.`

  return (
    <div className="overflow-x-auto">
      <div className={cn(GRID_CLASS, GRID_HEAD_CLASS)}>
        <span>Afgrøde</span>
        <span className="text-right">Areal pr. år, ha</span>
        <span className="text-right">Ændring, kr/ha</span>
        <span className="col-span-2 text-right">Anslået pr. år, kr</span>
      </div>
      {effect.crops.map((crop) => {
        const moved = crop.deltaDkkHa !== 0
        return (
          <div
            key={crop.cropCode}
            className={cn(ROW_CLASS, !moved && 'text-muted-foreground')}
          >
            <span className="flex min-w-0 items-center gap-2">
              <CropGroupTile
                group={cropGroupFor(crop.cropCode, crop.cropName)}
                className={moved ? undefined : 'opacity-50'}
              />
              <span className="truncate">{crop.cropName}</span>
            </span>
            <span className="text-right">{formatNumber(crop.areaHa)}</span>
            <span className="text-right">
              <DbDelta change={crop.deltaDkkHa} />
            </span>
            <DbDeltaBar delta={crop.deltaDkk} scale={scale} />
            <span className="text-right font-semibold">
              <DbDelta change={crop.deltaDkk} />
            </span>
            {crop.changes.length > 0 ? (
              <span className="col-span-full pb-1 pl-6.5 text-xs text-muted-foreground">
                {crop.changes
                  .map((change) => `${change.label} ${change.to}`)
                  .join(' · ')}
              </span>
            ) : null}
          </div>
        )
      })}
      {effect.otherCrops.length > 0 ? (
        <div className={cn(ROW_CLASS, 'text-muted-foreground')}>
          <span>Øvrige afgrøder</span>
          <span className="text-right">{formatNumber(otherAreaHa)}</span>
          <TruncatedTooltip
            content={otherCropsNote}
            className="col-span-full truncate pb-1 text-xs"
          >
            {otherCropsNote}
          </TruncatedTooltip>
        </div>
      ) : null}
      <div
        className={cn(
          GRID_CLASS,
          'bg-muted/30 py-2.5 text-[13px] font-semibold tabular-nums',
        )}
      >
        <span>I alt</span>
        <span className="text-right">{formatNumber(areaHa)}</span>
        <span className="col-span-3 text-right">
          {formatSignedDkk(effect.deltaDkk)}
        </span>
      </div>
    </div>
  )
}

type SimulationEconomicsCardProps = {
  simulation: Simulation
  simulations: Simulation[]
  fields: FieldRecord[]
  active: boolean
}

type CardBodyProps = SimulationEconomicsCardProps & {
  assumptions: EconomicsAssumptions
}

const CardBody = ({ simulation, fields, assumptions }: CardBodyProps) => {
  const economics = useEconomicsProfiles()
  const startGuide = useStartGuide()
  const profile = economics.profileForSimulation(simulation)
  const changes = profileChanges(assumptions, profile.overrides)
  const effect = simulationEconomicsEffect(
    assumptions,
    profile.overrides,
    fields,
  )
  const cropCount = effect.crops.length + effect.otherCrops.length
  const movedCropCount = effect.crops.filter(
    (crop) => crop.deltaDkkHa !== 0,
  ).length

  if (profile.id === STANDARD_PROFILE_ID) {
    return (
      <p className={NOTE_CLASS}>
        <b className="font-semibold text-foreground">{simulation.name}</b> har
        Standard valgt, altså priser og mængder fra {STANDARD_SOURCE} uden
        ændringer.{' '}
        {economics.ownProfiles.length > 0 ? (
          'Vælg en af bedriftens egne profiler for at se, hvad den betyder for simuleringen.'
        ) : (
          <>
            {ECONOMICS_INVITATION}{' '}
            <button
              type="button"
              className={TEXT_LINK_CLASS}
              onClick={() =>
                startGuide({
                  fromProfileId: STANDARD_PROFILE_ID,
                  simulationId: simulation.id,
                })
              }
            >
              Tilpas økonomien til bedriften
            </button>
          </>
        )}
      </p>
    )
  }

  if (cropCount === 0) {
    return (
      <p className={NOTE_CLASS}>
        Markerne i simuleringen har ingen sædskifter endnu. Når de har det, står
        her, hvad profilen betyder for hver afgrøde.
      </p>
    )
  }

  const unused = effect.unusedCropNames

  return (
    <>
      <div className="grid gap-4 border-t px-5 py-4 @xl:grid-cols-3">
        <KeyFigure
          label="Ændringer i profilen"
          figure={{
            value: String(changes.length),
            total: describeProfileChanges(changes),
          }}
        />
        <KeyFigure
          label="Afgrøder i simuleringen"
          figure={{
            value: `${movedCropCount} af ${cropCount}`,
            total: 'med ændret dækningsbidrag',
          }}
        />
        <KeyFigure
          label="Anslået pr. år"
          figure={{
            value: `${formatSignedDkk(effect.deltaDkk)} kr`,
            total: `i forhold til ${STANDARD_PROFILE.name}`,
          }}
        />
      </div>
      <EffectTable effect={effect} />
      <div className="space-y-1 px-5 py-3 text-xs text-muted-foreground">
        <p>
          {assumptions.soilTypeNumber === null
            ? NO_SOIL_TYPE_NOTE
            : `Arealet er gennemsnittet pr. år over markernes sædskifter, og ændringen pr. ha er regnet for ${budgetSoilType(assumptions)}, bedriftens mest udbredte jordtype, med simuleringens driftsform og gødningsvalg.`}
        </p>
        {unused.length > 0 ? (
          <p>
            Profilen ændrer også {formatCropNames(unused)}, som simuleringen
            ikke dyrker.
          </p>
        ) : null}
      </div>
    </>
  )
}

const Recalculation = ({ simulation }: { simulation: Simulation }) => {
  const economics = useEconomicsProfiles()
  const optimizing = useOptimizationRun(simulation.id)?.status === 'running'
  const [busy, setBusy] = useState(false)

  if (!economics.ready || economics.isEconomicsCurrent(simulation)) return null
  const available =
    economics.findProfile(
      simulation.economicsModuleId ?? STANDARD_PROFILE_ID,
    ) !== undefined

  const recalculate = async () => {
    setBusy(true)
    await economics.recalculate(simulation)
    setBusy(false)
  }

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-t bg-warning/10 px-5 py-3 text-[13px]">
      <p className="min-w-0 flex-1">
        {describeAppliedProfile(economics.profiles, simulation)}
      </p>
      {available ? (
        <Button
          size="sm"
          loading={busy}
          disabled={optimizing}
          onClick={() => void recalculate()}
        >
          {busy ? null : <RefreshCw aria-hidden="true" />}
          Genberegn økonomi
        </Button>
      ) : null}
    </div>
  )
}

export const SimulationEconomicsCard = (
  props: SimulationEconomicsCardProps,
) => {
  const id = useId()
  const { farmId } = useEconomicsProfiles()
  const budgets = useFarmBudgets(props.active ? farmId : undefined, {
    simulationId: props.simulation.id,
  })

  return (
    <section
      className={cn(RULES_CARD_CLASS, 'overflow-hidden')}
      aria-labelledby={`${id}-title`}
    >
      <div className={RULES_CARD_HEAD_CLASS}>
        <div className="min-w-0">
          <h3 id={`${id}-title`} className="text-sm font-semibold">
            Økonomiprofil
          </h3>
          <p className="mt-1 text-[13px] text-muted-foreground">
            Priserne, mængderne og udbytterne bag simuleringens dækningsbidrag.
            Et skift gælder, når økonomien er genberegnet.
          </p>
        </div>
        <EconomicsProfileMenu
          assumptions={budgets.data}
          simulation={props.simulation}
          simulations={props.simulations}
        />
      </div>
      <Recalculation simulation={props.simulation} />
      <BudgetsGate budgets={budgets} className="border-t px-5 py-4">
        {(assumptions) => <CardBody {...props} assumptions={assumptions} />}
      </BudgetsGate>
    </section>
  )
}
