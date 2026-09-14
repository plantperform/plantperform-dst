import { ArrowRight } from 'lucide-react'

import { FARM_LIST_CLASS } from '@/components/farm/FarmList'
import { Eyebrow } from '@/components/ui/eyebrow'
import { formatNumber } from '@/lib/field-domain'
import { cn } from '@/lib/utils'

const STEPS = [
  {
    title: 'Opret bedriften',
    text: 'Navn og ejer, det er alt, der kræves.',
  },
  {
    title: 'Hent marker',
    text: 'Fra registret via CVR, eller tegn dem selv på kortet.',
  },
  {
    title: 'Planlæg sædskifte',
    text: 'Opret en simulering og se udledning mod kvoten.',
  },
]

export type RegistryLookup = {
  fieldCount: number
  areaHa: number
}

type CreateFarmPreviewProps = {
  name: string
  ownerName: string
  cvr: string
  lookup: RegistryLookup | null
}

export const CreateFarmPreview = ({
  name,
  ownerName,
  cvr,
  lookup,
}: CreateFarmPreviewProps) => {
  const activeSteps = lookup && lookup.fieldCount > 0 ? 2 : 1
  return (
    <aside className="flex flex-col gap-5 lg:sticky lg:top-[72px]">
      <Eyebrow>Sådan ser den ud i listen</Eyebrow>
      <div className={cn(FARM_LIST_CLASS, 'shadow-lg')}>
        <div className="flex flex-col gap-3.5 p-[22px]">
          <div className="min-w-0">
            <p
              className={cn(
                'truncate font-display text-[22px] leading-7',
                !name.trim() && 'text-muted-foreground/70',
              )}
            >
              {name.trim() || 'Bedriftens navn'}
            </p>
            <p className="mt-0.5 truncate text-sm text-muted-foreground">
              {ownerName.trim() || 'Ejerens navn'}
            </p>
          </div>
          <p className="text-[13px] text-muted-foreground">
            {lookup && lookup.fieldCount > 0
              ? `${lookup.fieldCount} ${lookup.fieldCount === 1 ? 'mark' : 'marker'} · ${formatNumber(lookup.areaHa)} ha · importeres fra registret`
              : 'Ingen marker endnu'}
          </p>
          <div className="flex items-center justify-between pt-1 text-xs text-muted-foreground">
            <span>{/^\d{8}$/.test(cvr) ? `CVR ${cvr}` : 'Intet CVR'}</span>
            <span className="inline-flex items-center gap-1.5 text-[13px] font-semibold text-primary">
              Åbn
              <ArrowRight className="size-3.5" aria-hidden="true" />
            </span>
          </div>
        </div>
      </div>
      <ol className="rounded-2xl border bg-card">
        {STEPS.map((step, index) => (
          <li
            key={step.title}
            className="flex gap-3.5 border-b px-[18px] py-4 last:border-b-0"
          >
            <span
              className={cn(
                'flex size-6 shrink-0 items-center justify-center rounded-full text-xs font-semibold',
                index < activeSteps
                  ? 'bg-primary text-primary-foreground'
                  : 'bg-muted text-muted-foreground',
              )}
            >
              {index + 1}
            </span>
            <div>
              <p className="text-sm font-semibold">{step.title}</p>
              <p className="mt-0.5 text-[13px] text-muted-foreground">
                {step.text}
              </p>
            </div>
          </li>
        ))}
      </ol>
    </aside>
  )
}
