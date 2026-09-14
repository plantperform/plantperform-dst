import { ArrowRight } from 'lucide-react'
import { Link } from 'react-router-dom'

import type { Farm } from '@/api/types'
import { Skeleton } from '@/components/ui/skeleton'
import {
  describeFarmQuota,
  FARM_STATUS_LABELS,
  type FarmOverview,
} from '@/lib/farm-overview'
import { formatNumber, QUOTA_STATUS_STYLES } from '@/lib/field-domain'
import { cn } from '@/lib/utils'

export const FARM_LIST_CLASS =
  'divide-y overflow-hidden rounded-2xl border bg-card shadow-xs'

const ROW_GRID_CLASS =
  'grid items-center gap-x-6 gap-y-3 px-5 py-4 md:grid-cols-[minmax(0,1fr)_8.5rem_13rem_7.5rem_auto]'

export const FarmRowSkeleton = () => (
  <div className={ROW_GRID_CLASS}>
    <div className="space-y-2">
      <Skeleton className="h-5 w-40" />
      <Skeleton className="h-3.5 w-24" />
    </div>
    <Skeleton className="h-3.5 w-20" />
    <Skeleton className="h-1.5 w-full rounded-full" />
    <Skeleton className="h-3 w-16" />
    <Skeleton className="h-3.5 w-8" />
  </div>
)

type FarmRowProps = {
  farm: Farm
  overview: FarmOverview
  latest: boolean
}

export const FarmRow = ({ farm, overview, latest }: FarmRowProps) => {
  const { totals, level, quotaPct } = overview
  const style = level ? QUOTA_STATUS_STYLES[level] : null
  const quotaLine = totals ? describeFarmQuota(totals, quotaPct) : ''

  return (
    <li>
      <Link
        to={`/farms/${farm.id}`}
        className={cn(
          ROW_GRID_CLASS,
          'group transition-colors hover:bg-muted/40 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset focus-visible:outline-none',
        )}
      >
        <div className="min-w-0">
          <p className="flex items-center gap-2.5">
            <span className="truncate font-display text-[19px] leading-6">
              {farm.name}
            </span>
            {latest ? (
              <span className="shrink-0 rounded-full bg-primary/10 px-2 py-0.5 text-[11px] font-semibold text-primary">
                Senest åbnet
              </span>
            ) : null}
          </p>
          <p className="mt-0.5 truncate text-sm text-muted-foreground">
            {farm.ownerName}
          </p>
        </div>
        {!totals ? (
          <>
            <Skeleton className="h-3.5 w-20" />
            <Skeleton className="h-1.5 w-full rounded-full" />
          </>
        ) : totals.fieldCount === 0 ? (
          <p className="text-[13px] text-muted-foreground md:col-span-2">
            Ingen marker endnu ·{' '}
            <span className="font-semibold text-primary">
              Importer marker fra CVR
            </span>
          </p>
        ) : (
          <>
            <p className="text-[13px] whitespace-nowrap text-muted-foreground">
              <strong className="font-semibold text-foreground">
                {totals.fieldCount}
              </strong>{' '}
              {totals.fieldCount === 1 ? 'mark' : 'marker'} ·{' '}
              <strong className="font-semibold text-foreground">
                {formatNumber(totals.areaHa)}
              </strong>{' '}
              ha
            </p>
            <div className="flex flex-col gap-1.5">
              {style && level ? (
                <span
                  className={cn(
                    'inline-flex items-center gap-1.5 text-[13px] font-medium',
                    style.text,
                  )}
                >
                  <span
                    aria-hidden="true"
                    className={cn('size-[7px] rounded-full', style.dot)}
                  />
                  {FARM_STATUS_LABELS[level]}
                </span>
              ) : null}
              <div
                className="h-1.5 overflow-hidden rounded-full bg-muted"
                title={quotaLine}
              >
                <div
                  className={cn(
                    'h-full rounded-full',
                    style?.dot ?? 'bg-muted-foreground/60',
                  )}
                  style={{ width: `${quotaPct ?? 100}%` }}
                />
              </div>
              <p className="text-xs whitespace-nowrap text-muted-foreground">
                {quotaLine}
              </p>
            </div>
          </>
        )}
        <span className="text-xs whitespace-nowrap text-muted-foreground">
          {farm.cvr ? `CVR ${farm.cvr}` : 'Intet CVR'}
        </span>
        <span className="inline-flex items-center gap-1.5 text-[13px] font-semibold text-primary">
          Åbn
          <ArrowRight
            className="size-3.5 transition-transform group-hover:translate-x-0.5"
            aria-hidden="true"
          />
        </span>
      </Link>
    </li>
  )
}
