export const LoadingSkeleton = ({ message }: { message: string }) => (
  <div className="space-y-3 p-4">
    <p className="text-sm text-muted-foreground">{message}</p>
    <div className="space-y-2" aria-hidden="true">
      <div className="h-4 w-5/6 animate-pulse rounded bg-muted" />
      <div className="h-4 w-1/2 animate-pulse rounded bg-muted" />
      <div className="h-4 w-2/3 animate-pulse rounded bg-muted" />
      <div className="h-4 w-3/4 animate-pulse rounded bg-muted" />
    </div>
  </div>
)
