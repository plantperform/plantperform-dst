import { Skeleton } from '@/components/ui/skeleton'
import { formatWholeNumber } from '@/lib/field-domain'
import { cn } from '@/lib/utils'

type FarmOverviewHeaderProps = {
  farmCount: number
  fieldCount: number
  areaHa: number
  overQuota: number
  loading: boolean
}

export const FarmOverviewHeader = ({
  farmCount,
  fieldCount,
  areaHa,
  overQuota,
  loading,
}: FarmOverviewHeaderProps) => {
  const stats = [
    { label: 'Bedrifter', value: formatWholeNumber(farmCount), pending: false },
    { label: 'Marker', value: formatWholeNumber(fieldCount), pending: loading },
    { label: 'Hektar', value: formatWholeNumber(areaHa), pending: loading },
    {
      label: 'Over kvote',
      value: formatWholeNumber(overQuota),
      pending: loading,
      alert: overQuota > 0,
    },
  ]

  return (
    <section className="flex flex-wrap items-end justify-between gap-6">
      <div>
        <h1 className="font-display text-4xl tracking-tight">Bedrifter</h1>
        <p className="mt-1.5 text-sm text-muted-foreground">
          Overblik over marker, hektar og udledning på tværs af dine bedrifter.
        </p>
      </div>
      <dl className="flex flex-wrap gap-y-4 divide-x">
        {stats.map((stat) => (
          <div key={stat.label} className="px-6 py-1 first:pl-0 last:pr-0">
            <dt className="text-xs whitespace-nowrap text-muted-foreground">
              {stat.label}
            </dt>
            <dd
              className={cn(
                'mt-1 font-display text-3xl leading-none',
                stat.alert && 'text-destructive',
              )}
            >
              {stat.pending ? (
                <Skeleton className="mt-0.5 h-6 w-10" />
              ) : (
                stat.value
              )}
            </dd>
          </div>
        ))}
      </dl>
    </section>
  )
}
