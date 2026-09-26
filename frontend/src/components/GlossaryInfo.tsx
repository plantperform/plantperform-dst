import { Info } from 'lucide-react'
import { useState } from 'react'

import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'

const glossary = {
  db2: {
    title: 'DB2',
    description:
      'Dækningsbidrag 2: indtægter fra afgrøder minus variable omkostninger og maskinomkostninger. Vises her i kroner.',
  },
  nLoad: {
    title: 'N-udledning',
    description:
      'Den beregnede mængde kvælstof (N), der når kystvandet fra markerne. Angives i kg N.',
  },
  quota: {
    title: 'Kvote',
    description:
      'Grænsen for, hvor meget kvælstof der må udledes. Sammenlign udledningen med kvoten for at se, om grænsen er overholdt.',
  },
  catchment: {
    title: 'Kystvandopland',
    description:
      'Et område, hvor markerne afvander til det samme kystvand. Udledning og kvote kan opgøres for hvert opland.',
  },
  nNorm: {
    title: 'N-norm',
    description:
      'Normen for, hvor meget kvælstof der må tildeles en afgrøde. Procenten angiver niveauet i forhold til normen.',
  },
  catchCrop: {
    title: 'Efterafgrøde',
    description:
      'En afgrøde, der dyrkes efter hovedafgrøden og optager kvælstof, så mindre kvælstof udvaskes.',
  },
  rotation: {
    title: 'Sædskifte',
    description:
      'Rækkefølgen af afgrøder på en mark over flere år. Planen gentages, når sidste år er nået.',
  },
  simulation: {
    title: 'Simulering',
    description:
      'Et beregnet forslag til dyrkning med valgte sædskifter og forudsætninger. Det ændrer ikke markernes registrerede historik.',
  },
  optimization: {
    title: 'Optimering',
    description:
      'En beregning, der vælger mellem mulige sædskifter ud fra simuleringens regler og grænser.',
  },
  feedUnits: {
    title: 'Foderenheder',
    description:
      'Et mål for afgrødens foderværdi. FE bruges her til at sammenligne og sætte grænser for foderproduktionen.',
  },
} as const

export type GlossaryTerm = keyof typeof glossary

export const GlossaryInfo = ({
  term,
  className,
}: {
  term: GlossaryTerm
  className?: string
}) => {
  const [open, setOpen] = useState(false)
  const [pinned, setPinned] = useState(false)
  const { title, description } = glossary[term]

  return (
    <TooltipProvider delayDuration={150}>
      <Tooltip
        open={open}
        onOpenChange={(next) => {
          if (next || !pinned) setOpen(next)
        }}
      >
        <TooltipTrigger asChild>
          <button
            type="button"
            aria-label={`Forklaring: ${title}`}
            aria-expanded={open}
            onClick={(event) => {
              event.stopPropagation()
              setPinned(true)
              setOpen(true)
            }}
            className={cn(
              'inline-flex size-5 shrink-0 items-center justify-center rounded-full text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
              className,
            )}
          >
            <Info className="size-3.5" aria-hidden="true" />
          </button>
        </TooltipTrigger>
        <TooltipContent
          sideOffset={6}
          className="max-w-64 text-left leading-relaxed"
          onPointerDownOutside={() => {
            setPinned(false)
            setOpen(false)
          }}
          onEscapeKeyDown={() => {
            setPinned(false)
            setOpen(false)
          }}
        >
          <span className="block font-semibold">{title}</span>
          <span>{description}</span>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  )
}
