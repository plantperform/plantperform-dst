import { Check } from 'lucide-react'
import type { ReactNode } from 'react'

import {
  catchmentKey,
  describeCatchment,
} from '@/components/farm/catchment-options'
import { Button } from '@/components/ui/button'
import { ProgressBar } from '@/components/ui/progress-bar'
import { Spinner } from '@/components/ui/spinner'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { formatCvr } from '@/lib/farm-form'
import {
  formatFieldCount,
  formatHectares,
  formatWholeNumber,
  NUM_ROTATION_YEARS,
  ROTATION_START_CALENDAR_YEAR,
} from '@/lib/field-domain'
import {
  describeLookup,
  describeLookupQuota,
  type LookupSummary,
} from '@/lib/registry-lookup'
import { cn } from '@/lib/utils'

type StepHeadingProps = {
  title: string
  children: ReactNode
}

export const StepHeading = ({ title, children }: StepHeadingProps) => (
  <>
    <h1 className="font-display text-[32px] leading-tight tracking-tight">
      {title}
    </h1>
    <p className="mt-2 mb-[26px] text-[15px] leading-normal text-pretty text-muted-foreground">
      {children}
    </p>
  </>
)

type LookupPhase = 'searching' | 'details' | 'found' | 'creating'

const ACTIVE_STEP: Record<LookupPhase, number> = {
  searching: 0,
  details: 1,
  found: 2,
  creating: 2,
}

const CALCULATION_PERIOD = `${ROTATION_START_CALENDAR_YEAR} til ${ROTATION_START_CALENDAR_YEAR + NUM_ROTATION_YEARS - 1}`

type LookupProgressProps = {
  phase: LookupPhase
  fieldCount: number | null
  error?: ReactNode
}

export const LookupProgress = ({
  phase,
  fieldCount,
  error,
}: LookupProgressProps) => {
  const activeIndex = ACTIVE_STEP[phase]
  const steps = [
    fieldCount === null
      ? 'Henter marker fra markregistret'
      : `Marker hentet fra markregistret: ${formatFieldCount(fieldCount)}`,
    'Slår retention og udledningsgrænse op i statens kortlag',
    ...(phase === 'creating'
      ? [
          `Regner udledning og dækningsbidrag for ${CALCULATION_PERIOD} første gang`,
        ]
      : []),
  ]

  return (
    <div role="status" className="grid gap-3.5 rounded-xl border bg-card p-6">
      {error ?? <ProgressBar className="h-1.5" />}
      <ol className="grid gap-2.5 text-sm">
        {steps.map((label, index) => (
          <li
            key={label}
            className={cn(
              'flex items-center gap-2.5',
              index < activeIndex && 'text-success-strong',
              index > activeIndex && 'text-muted-foreground',
            )}
          >
            <span className="flex size-[18px] shrink-0 items-center justify-center">
              {index < activeIndex ? (
                <Check className="size-4" aria-hidden="true" />
              ) : index === activeIndex && !error ? (
                <Spinner className="size-[18px] text-primary" />
              ) : (
                <span aria-hidden="true">·</span>
              )}
            </span>
            {label}
          </li>
        ))}
      </ol>
    </div>
  )
}

type CreateStatusProps = {
  creating?: boolean
  error: string | null
}

export const CreateStatus = ({ creating = false, error }: CreateStatusProps) =>
  creating ? (
    <p
      role="status"
      className="mt-3 flex items-center gap-2 text-[13px] text-muted-foreground"
    >
      <Spinner />
      Opretter bedriften...
    </p>
  ) : error ? (
    <p role="alert" className="mt-3 text-[13px] text-destructive">
      {error}
    </p>
  ) : null

const HEAD_CLASS =
  'h-auto px-5 py-2.5 text-xs font-normal text-muted-foreground'

const CELL_CLASS = 'px-5 py-3.5 tabular-nums'

type LookupFoundProps = {
  farmName: string
  summary: LookupSummary
  error: string | null
  onCreate: () => void
}

export const LookupFound = ({
  farmName,
  summary,
  error,
  onCreate,
}: LookupFoundProps) => (
  <>
    <StepHeading title={describeLookup(summary)}>
      Nogle marker er små underlodder af samme hovedmark (1-0, 1-1, 1-2). Du kan
      fjerne og tilføje marker på kortet senere.
    </StepHeading>
    <div className="overflow-hidden rounded-xl border bg-card">
      <Table>
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            <TableHead className={HEAD_CLASS}>Kystvandopland</TableHead>
            <TableHead className={HEAD_CLASS}>Marker</TableHead>
            <TableHead className={HEAD_CLASS}>Areal</TableHead>
            <TableHead className={HEAD_CLASS}>Kvote pr. år</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {summary.catchments.map((catchment) => (
            <TableRow
              key={catchmentKey(catchment.catchmentId)}
              className="hover:bg-transparent"
            >
              <TableCell
                className={cn(CELL_CLASS, 'font-medium whitespace-normal')}
              >
                <span className="flex items-center gap-2">
                  <span
                    aria-hidden="true"
                    className="size-2.5 shrink-0 rounded-[3px]"
                    style={{ backgroundColor: catchment.color }}
                  />
                  {describeCatchment(
                    catchment.catchmentId,
                    catchment.catchmentName,
                  )}
                </span>
              </TableCell>
              <TableCell className={CELL_CLASS}>
                {formatFieldCount(catchment.fieldCount)}
              </TableCell>
              <TableCell className={CELL_CLASS}>
                {formatHectares(catchment.areaHa)} ha
              </TableCell>
              <TableCell className={CELL_CLASS}>
                {catchment.quotaKgN > 0
                  ? `${formatWholeNumber(catchment.quotaKgN)} kg N`
                  : 'Ingen kvote'}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3 border-t bg-background px-5 py-4">
        <p className="min-w-48 flex-1 text-[13px] text-muted-foreground">
          {describeLookupQuota(summary)}
        </p>
        <Button
          className="h-auto min-h-10 max-w-full rounded-full whitespace-normal"
          onClick={onCreate}
        >
          Opret {farmName} og se første svar
        </Button>
      </div>
    </div>
    <CreateStatus error={error} />
  </>
)

type LookupEmptyProps = {
  cvr: string
  creating: boolean
  error: string | null
  onEditCvr: () => void
  onCreateEmpty: () => void
}

export const LookupEmpty = ({
  cvr,
  creating,
  error,
  onEditCvr,
  onCreateEmpty,
}: LookupEmptyProps) => {
  const choices = [
    {
      title: 'Ret CVR-nummeret',
      text: 'Prøv igen med et andet nummer.',
      onSelect: onEditCvr,
    },
    {
      title: 'Opret bedriften uden marker',
      text: 'Du kan tilføje marker senere.',
      onSelect: onCreateEmpty,
    },
  ]

  return (
    <>
      <StepHeading title={`Vi fandt ingen marker på CVR ${formatCvr(cvr)}`}>
        Det kan være en tastefejl, eller markerne er registreret på et andet
        CVR-nummer, fx et driftsselskab.
      </StepHeading>
      <div className="grid gap-3">
        {choices.map((choice) => (
          <button
            key={choice.title}
            type="button"
            disabled={creating}
            onClick={choice.onSelect}
            className="rounded-[10px] border bg-card px-5 py-4 text-left text-sm transition-colors hover:border-primary focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none disabled:opacity-60"
          >
            <span className="block font-semibold">{choice.title}</span>
            <span className="mt-0.5 block text-[13px] text-muted-foreground">
              {choice.text}
            </span>
          </button>
        ))}
      </div>
      <CreateStatus creating={creating} error={error} />
    </>
  )
}
