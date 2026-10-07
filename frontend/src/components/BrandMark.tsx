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

export const SproutMark = ({ className }: { className?: string }) => (
  <svg viewBox="0 0 64 64" fill="none" aria-hidden="true" className={className}>
    <g
      transform="translate(32 32) scale(1.38) translate(-32.4 -31.5)"
      stroke="currentColor"
      strokeWidth="4"
      strokeLinecap="round"
    >
      <path d="M31.8 47.2V29.8" />
      <path d="M22.5 47.2h19" />
      <path
        d="M31.9 31.3c-8.9.1-13.8-4.7-13.6-12.9 8.3-.2 13.6 4.1 13.6 12.9Z"
        fill="currentColor"
        stroke="none"
      />
      <path
        d="M32.4 29.8c.1-9.6 5.1-14.6 14.2-14.1.1 8.6-5 13.8-14.2 14.1Z"
        fill="currentColor"
        stroke="none"
      />
    </g>
  </svg>
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
    <BrandIcon
      onDark={variant === 'onDark'}
      className={compact ? 'size-8' : 'size-9'}
    />
    {compact ? null : (
      <span className="truncate text-lg font-semibold tracking-tight">
        PlantPerform
      </span>
    )}
  </span>
)
