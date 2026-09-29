import type { RequestProgress } from '@/api/request-progress'
import { ProgressBar } from '@/components/ui/progress-bar'
import { Skeleton } from '@/components/ui/skeleton'

const RANKING_ROWS = [0, 1, 2, 3]

const ComparisonSkeleton = () => (
  <div
    aria-hidden="true"
    className="pointer-events-none absolute inset-0 space-y-6 overflow-hidden [mask-image:linear-gradient(to_bottom,black_40%,transparent)]"
  >
    <Skeleton className="h-4 w-full max-w-160" />
    <div className="rounded-lg border bg-card">
      <div className="h-10 border-b bg-muted/30" />
      {RANKING_ROWS.map((row) => (
        <div
          key={row}
          className="flex items-center gap-10 border-b px-4 py-5 last:border-b-0"
        >
          <Skeleton className="h-5 w-48 shrink-0" />
          <Skeleton className="h-8 flex-1" />
          <Skeleton className="h-8 flex-1" />
          <Skeleton className="h-8 flex-1" />
        </div>
      ))}
    </div>
    <div className="grid gap-6 @3xl:grid-cols-2">
      <Skeleton className="h-80 rounded-lg" />
      <Skeleton className="h-80 rounded-lg" />
    </div>
  </div>
)

type ComparisonLoadingProps = {
  label: string
  progress?: RequestProgress
}

export const ComparisonLoading = ({
  label,
  progress,
}: ComparisonLoadingProps) => (
  <div className="relative flex min-h-112 flex-1 animate-skeleton-in items-center justify-center pb-[8vh]">
    <ComparisonSkeleton />
    <div
      role="progressbar"
      aria-label={label}
      aria-valuemin={progress ? 0 : undefined}
      aria-valuemax={progress?.total}
      aria-valuenow={progress?.done}
      className="relative w-80 rounded-xl border bg-card px-8 py-6 text-center shadow-[0_4px_24px_-2px_rgba(26,40,33,0.06),0_1px_3px_rgba(26,40,33,0.04)]"
    >
      <p className="text-base font-semibold">{label}</p>
      <p className="mt-1 min-h-5 text-sm text-muted-foreground tabular-nums">
        {progress ? `${progress.done} af ${progress.total} marker` : null}
      </p>
      <ProgressBar
        className="mt-4"
        valuePct={
          progress && (progress.done * 100) / Math.max(progress.total, 1)
        }
      />
    </div>
  </div>
)
