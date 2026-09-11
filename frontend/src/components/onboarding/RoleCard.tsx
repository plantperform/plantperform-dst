import { Check, type LucideIcon } from 'lucide-react'

import { cn } from '@/lib/utils'

type RoleCardProps = {
  selected: boolean
  title: string
  description: string
  icon: LucideIcon
  onSelect: () => void
}

export const RoleCard = ({
  selected,
  title,
  description,
  icon: Icon,
  onSelect,
}: RoleCardProps) => (
  <button
    type="button"
    aria-pressed={selected}
    onClick={onSelect}
    className={cn(
      'relative flex flex-col items-start gap-2 rounded-md border bg-background p-4 text-left transition-colors hover:border-primary/40 hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
      selected &&
        'border-primary bg-primary/5 ring-1 ring-primary hover:bg-primary/5',
    )}
  >
    <span
      className={cn(
        'flex size-8 items-center justify-center rounded-md bg-muted text-muted-foreground transition-colors',
        selected && 'bg-primary/10 text-primary',
      )}
    >
      <Icon className="size-[18px]" aria-hidden="true" />
    </span>
    <span className="block">
      <span className="block text-sm font-semibold">{title}</span>
      <span className="mt-0.5 block text-xs leading-snug text-muted-foreground">
        {description}
      </span>
    </span>
    {selected ? (
      <span className="absolute right-2.5 top-2.5 flex size-[18px] items-center justify-center rounded-full bg-primary text-primary-foreground">
        <Check className="size-3" strokeWidth={3} aria-hidden="true" />
      </span>
    ) : null}
  </button>
)
