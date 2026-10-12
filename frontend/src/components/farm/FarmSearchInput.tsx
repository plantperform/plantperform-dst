import { Search } from 'lucide-react'

import { cn } from '@/lib/utils'

type FarmSearchInputProps = {
  value: string
  onChange: (value: string) => void
  autoFocus?: boolean
  className?: string
}

export const FarmSearchInput = ({
  value,
  onChange,
  autoFocus = false,
  className,
}: FarmSearchInputProps) => (
  <div className={cn('relative', className)}>
    <Search
      className="pointer-events-none absolute top-1/2 left-3 size-3.5 -translate-y-1/2 text-muted-foreground"
      aria-hidden="true"
    />
    <input
      type="search"
      autoFocus={autoFocus}
      value={value}
      onChange={(event) => onChange(event.target.value)}
      placeholder="Søg bedrift, ejer eller CVR"
      aria-label="Søg i bedrifter"
      className="h-9 w-full rounded-md border bg-card pr-3 pl-8.5 text-[13px] outline-none placeholder:text-muted-foreground focus-visible:border-primary focus-visible:ring-[3px] focus-visible:ring-primary/15"
    />
  </div>
)
