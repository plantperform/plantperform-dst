import type { ReactNode } from 'react'

import { Card } from '@/components/ui/card'
import { cn } from '@/lib/utils'

type OverviewCardProps = {
  title: string
  subtitle: ReactNode
  active?: boolean
  meta?: string
  actions: ReactNode
  children: ReactNode
}

export const OverviewCard = ({
  title,
  subtitle,
  active = false,
  meta,
  actions,
  children,
}: OverviewCardProps) => (
  <Card
    className={cn(
      'flex flex-col gap-4 p-5',
      active && 'border-primary ring-1 ring-primary',
    )}
  >
    <div className="min-w-0">
      <h2 className="flex items-center gap-2.5">
        <span className="truncate font-display text-[19px] leading-6">
          {title}
        </span>
        {active ? (
          <span className="shrink-0 rounded-full bg-primary/10 px-2 py-0.5 text-[11px] font-semibold text-primary">
            Senest åbnet
          </span>
        ) : null}
      </h2>
      <div className="mt-0.5 truncate text-sm text-muted-foreground">
        {subtitle}
      </div>
    </div>
    <div className="flex flex-1 flex-col gap-4">{children}</div>
    <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-3 border-t pt-4">
      {meta ? (
        <p className="text-xs text-muted-foreground tabular-nums">{meta}</p>
      ) : null}
      <div className="ml-auto flex flex-wrap gap-2">{actions}</div>
    </div>
  </Card>
)

type KeyFigureProps = {
  label: string
  figure: { value: string; total?: string }
  note?: ReactNode
  children?: ReactNode
}

export const KeyFigure = ({
  label,
  figure,
  note,
  children,
}: KeyFigureProps) => (
  <div className="min-w-0">
    <p className="text-xs text-muted-foreground">{label}</p>
    <p className="mt-1 font-display text-2xl leading-none tabular-nums">
      {figure.value}
    </p>
    {figure.total ? (
      <p className="mt-1 text-xs text-muted-foreground tabular-nums">
        {figure.total}
      </p>
    ) : null}
    {note ? <p className="mt-1.5 text-xs tabular-nums">{note}</p> : null}
    {children ? <div className="mt-2">{children}</div> : null}
  </div>
)
