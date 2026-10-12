import { cn } from '@/lib/utils'

type BrandIconProps = {
  onDark?: boolean
  className?: string
}

export const BrandIcon = ({ onDark = false, className }: BrandIconProps) => (
  <img
    src="/brand-mark.svg"
    alt=""
    className={cn(
      'shrink-0 rounded-md',
      onDark && 'ring-1 ring-brand-foreground/25',
      className,
    )}
  />
)
