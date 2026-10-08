import { ChevronRight } from 'lucide-react'
import { Link } from 'react-router-dom'

import { useFarmEmissions } from '@/api/hooks'
import type { Farm } from '@/api/types'
import { describeCatchment } from '@/components/farm/catchment-options'
import { TruncatedTooltip } from '@/components/ui/app-tooltip'
import { Skeleton } from '@/components/ui/skeleton'
import { formatCvr } from '@/lib/farm-form'
import {
  describeFarmQuotaStatus,
  describeLastOpened,
  farmStatusCatchmentId,
  type FarmOverview,
} from '@/lib/farm-overview'
import {
  formatFieldCount,
  formatHectares,
  QUOTA_STATUS_STYLES,
} from '@/lib/field-domain'
import { cn } from '@/lib/utils'

export const FARM_LIST_CLASS =
  'divide-y overflow-hidden rounded-lg border bg-card'

const ROW_GRID_CLASS =
  'grid grid-cols-[14px_minmax(0,1fr)_20px] items-center gap-x-4 gap-y-1.5 px-5 lg:grid-cols-[14px_minmax(0,1fr)_170px_360px_120px_20px]'

const STACKED_CELL_CLASS = 'col-start-2 lg:col-start-auto'

const STATUS_SKELETON_CLASS = 'h-6.5 w-52 rounded-full'

export const FarmListHeader = () => (
  <div
    aria-hidden="true"
    className={cn(
      ROW_GRID_CLASS,
      'hidden py-2.5 text-xs text-muted-foreground lg:grid',
    )}
  >
    <span />
    <span>Bedrift</span>
    <span>Marker og areal</span>
    <span>Udledning mod kvote</span>
    <span>Sidst åbnet</span>
    <span />
  </div>
)

export const FarmRowSkeleton = () => (
  <div className={cn(ROW_GRID_CLASS, 'py-4')}>
    <Skeleton className="size-2.5 rounded-full" />
    <div className="space-y-2">
      <Skeleton className="h-5 w-40" />
      <Skeleton className="h-3.5 w-48" />
    </div>
    <div className={cn(STACKED_CELL_CLASS, 'space-y-1.5')}>
      <Skeleton className="h-3.5 w-16" />
      <Skeleton className="h-3 w-12" />
    </div>
    <Skeleton className={cn(STACKED_CELL_CLASS, STATUS_SKELETON_CLASS)} />
    <Skeleton className="hidden h-3.5 w-14 lg:block" />
  </div>
)

type FarmRowProps = {
  farm: Farm
  overview: FarmOverview
  openedAt: number | undefined
}

export const FarmRow = ({ farm, overview, openedAt }: FarmRowProps) => {
  const { totals, level } = overview
  const namedCatchmentId = farmStatusCatchmentId(overview)
  const emissions = useFarmEmissions(
    namedCatchmentId === null ? undefined : farm.id,
  )
  const style = QUOTA_STATUS_STYLES[level ?? 'uncalculated']
  const status = describeFarmQuotaStatus(overview, (catchmentId) =>
    describeCatchment(
      catchmentId,
      emissions.data?.find((entry) => entry.catchmentId === catchmentId)
        ?.catchmentName,
    ),
  )
  const owner = `${farm.ownerName} · ${farm.cvr ? `CVR ${formatCvr(farm.cvr)}` : 'Intet CVR'}`

  return (
    <li>
      <Link
        to={`/farms/${farm.id}`}
        className={cn(
          ROW_GRID_CLASS,
          'py-4 transition-colors hover:bg-muted/40 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset focus-visible:outline-none',
        )}
      >
        <span
          aria-hidden="true"
          className={cn('size-2.5 rounded-full', style.dot)}
        />
        <div className="min-w-0">
          <TruncatedTooltip
            content={farm.name}
            className="block truncate font-display text-[19px] leading-6"
          >
            {farm.name}
          </TruncatedTooltip>
          <TruncatedTooltip
            content={owner}
            className="mt-0.5 block truncate text-[12.5px] text-muted-foreground"
          >
            {owner}
          </TruncatedTooltip>
        </div>
        <div className={STACKED_CELL_CLASS}>
          {totals ? (
            <>
              <p className="text-[13.5px]">
                {formatFieldCount(totals.fieldCount)}
              </p>
              <p className="text-[12.5px] text-muted-foreground">
                {formatHectares(totals.areaHa)} ha
              </p>
            </>
          ) : null}
        </div>
        <div className={cn(STACKED_CELL_CLASS, 'min-w-0')}>
          {namedCatchmentId !== null && emissions.isLoading ? (
            <Skeleton className={STATUS_SKELETON_CLASS} />
          ) : (
            <span
              className={cn(
                'inline-flex max-w-full rounded-full px-2.5 py-1 text-[12.5px] font-medium',
                style.surface,
              )}
            >
              <TruncatedTooltip content={status} className="truncate">
                {status}
              </TruncatedTooltip>
            </span>
          )}
        </div>
        <span className="hidden text-[13px] text-muted-foreground lg:block">
          <span className="sr-only">Sidst åbnet: </span>
          {describeLastOpened(openedAt)}
        </span>
        <ChevronRight
          className="col-start-3 row-start-1 size-4 text-muted-foreground lg:col-start-auto lg:row-start-auto"
          aria-hidden="true"
        />
      </Link>
    </li>
  )
}
