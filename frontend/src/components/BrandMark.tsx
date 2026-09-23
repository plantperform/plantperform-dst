import { cn } from '@/lib/utils'

// Placeholder drawing of the ICOEL bomærke (circle and sprout) until the
// official logo package arrives. Strokes use currentColor, so the mark takes
// the text colour: white on the brand red, brand red on light grounds.
export const IcoelMark = ({ className }: { className?: string }) => (
  <svg
    viewBox="0 0 48 48"
    fill="none"
    stroke="currentColor"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
    className={className}
  >
    <path d="M16.5 34A15 15 0 1 1 31.5 34" strokeWidth="3.5" />
    <path
      d="M24 45V19M24 38q-2-5-7-6M24 38q2-5 7-6M24 31q-2-5-7-6M24 31q2-5 7-6M24 24q-1.5-4-5-5M24 24q1.5-4 5-5"
      strokeWidth="3"
    />
  </svg>
)

// Placeholder for the ICOEL logo lockup: the mark with the name set in the
// display font. Replace with the logo package's primary logo when it arrives.
export const IcoelLogo = ({ className }: { className?: string }) => (
  <span
    role="img"
    aria-label="Innovationscenter for Økologisk Landbrug"
    className={cn('flex items-center gap-2.5', className)}
  >
    <IcoelMark className="size-10 shrink-0" />
    <span aria-hidden="true" className="font-display text-[15px] leading-[1.15]">
      Innovationscenter
      <br />
      for Økologisk Landbrug
    </span>
  </span>
)

type BrandMarkProps = {
  variant?: 'default' | 'onDark'
  compact?: boolean
  className?: string
}

export const BrandMark = ({
  variant = 'default',
  compact = false,
  className,
}: BrandMarkProps) => (
  <span
    className={cn('flex items-center gap-2.5', className)}
    role={compact ? 'img' : undefined}
    aria-label={compact ? 'PlantPerform' : undefined}
  >
    <span
      className={cn(
        'flex shrink-0 items-center justify-center rounded-md',
        compact ? 'size-8' : 'size-9',
        variant === 'onDark'
          ? 'text-brand-foreground'
          : 'bg-brand text-brand-foreground',
      )}
    >
      <IcoelMark className={compact ? 'size-6' : 'size-7'} />
    </span>
    {compact ? null : (
      <span className="truncate text-lg font-semibold tracking-tight">
        PlantPerform
      </span>
    )}
  </span>
)
