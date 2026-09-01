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
      'relative flex flex-col items-start gap-3 rounded-lg border bg-background p-5 text-left transition-colors hover:border-primary/40 hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
      selected && 'border-primary bg-primary/10 hover:bg-primary/10',
    )}
  >
    <span
      className={cn(
        'flex h-10 w-10 items-center justify-center rounded-full bg-secondary text-secondary-foreground transition-colors',
        selected && 'bg-primary text-primary-foreground',
      )}
    >
      <Icon className="h-5 w-5" aria-hidden="true" />
    </span>
    <span className="block">
      <span className="block font-medium">{title}</span>
      <span className="mt-1 block text-sm text-muted-foreground">
        {description}
      </span>
    </span>
    {selected ? (
      <span className="absolute right-3 top-3 flex h-5 w-5 items-center justify-center rounded-full bg-primary text-primary-foreground">
        <Check className="h-3 w-3" aria-hidden="true" />
      </span>
    ) : null}
  </button>
)
