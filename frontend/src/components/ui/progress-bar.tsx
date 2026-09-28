import { cn } from '@/lib/utils'

type ProgressBarProps = {
  valuePct?: number
  className?: string
}

export const ProgressBar = ({ valuePct, className }: ProgressBarProps) => (
  <div
    aria-hidden="true"
    className={cn('h-1 overflow-hidden rounded-full bg-muted', className)}
  >
    {valuePct === undefined ? (
      <div className="h-full w-1/3 rounded-full bg-primary motion-safe:animate-indeterminate" />
    ) : (
      <div
        className="h-full rounded-full bg-primary motion-safe:transition-[width]"
        style={{ width: `${valuePct}%` }}
      />
    )}
  </div>
)
