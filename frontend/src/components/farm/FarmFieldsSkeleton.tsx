const ROW_WIDTHS = [
  ['w-24', 'w-16', 'w-32', 'w-14', 'w-20'],
  ['w-20', 'w-14', 'w-40', 'w-12', 'w-16'],
  ['w-28', 'w-16', 'w-24', 'w-14', 'w-20'],
  ['w-16', 'w-12', 'w-36', 'w-16', 'w-14'],
  ['w-24', 'w-14', 'w-28', 'w-12', 'w-20'],
  ['w-20', 'w-16', 'w-32', 'w-14', 'w-16'],
  ['w-28', 'w-12', 'w-24', 'w-16', 'w-20'],
  ['w-16', 'w-14', 'w-40', 'w-12', 'w-14'],
]

const HEADER_WIDTHS = ['w-16', 'w-12', 'w-24', 'w-10', 'w-14']

type FarmFieldsSkeletonProps = {
  message: string
}

export const FarmFieldsSkeleton = ({ message }: FarmFieldsSkeletonProps) => (
  <div className="min-h-0 flex-1 space-y-2 overflow-hidden">
    <div className="flex h-7 items-center justify-between gap-3">
      <p className="text-sm text-muted-foreground">{message}</p>
      <div
        aria-hidden="true"
        className="h-7 w-28 rounded-md bg-muted motion-safe:animate-pulse"
      />
    </div>
    <div
      aria-hidden="true"
      className="overflow-hidden rounded-lg border bg-card"
    >
      <div className="flex h-10 items-center gap-6 bg-muted/60 px-2">
        {HEADER_WIDTHS.map((width, index) => (
          <div
            key={index}
            className={`h-3 rounded bg-muted-foreground/20 motion-safe:animate-pulse ${width}`}
          />
        ))}
      </div>
      {ROW_WIDTHS.map((widths, rowIndex) => (
        <div
          key={rowIndex}
          className="flex items-center gap-6 border-t px-2 py-2"
        >
          {widths.map((width, index) => (
            <div
              key={index}
              className={`h-5 rounded bg-muted motion-safe:animate-pulse ${width}`}
            />
          ))}
        </div>
      ))}
    </div>
  </div>
)
