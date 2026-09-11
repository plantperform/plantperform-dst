import { Skeleton } from '@/components/ui/skeleton'

export const LoadingSkeleton = ({ message }: { message: string }) => (
  <div className="space-y-3 p-4">
    <p className="text-sm text-muted-foreground">{message}</p>
    <div className="space-y-2">
      <Skeleton className="h-4 w-5/6" />
      <Skeleton className="h-4 w-1/2" />
      <Skeleton className="h-4 w-2/3" />
      <Skeleton className="h-4 w-3/4" />
    </div>
  </div>
)
