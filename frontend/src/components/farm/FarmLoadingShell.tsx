import type { Farm } from '@/api/types'
import { FarmFieldsSkeleton } from '@/components/farm/FarmFieldsSkeleton'
import {
  GROUP_CLASS,
  GROUP_LABEL_CLASS,
  SidebarBrand,
} from '@/components/farm/FarmSidebar'
import { FarmSwitcher } from '@/components/farm/FarmSwitcher'
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
} from '@/components/ui/sidebar'
import { Skeleton } from '@/components/ui/skeleton'

const SIDEBAR_ROW_CLASS = 'h-11 rounded-md bg-sidebar-accent'

type FarmSidebarSkeletonProps = {
  farm?: Farm
  onError: (message: string | null) => void
}

export const FarmSidebarSkeleton = ({
  farm,
  onError,
}: FarmSidebarSkeletonProps) => (
  <Sidebar collapsible="icon" aria-label="Navigation for bedriften">
    <SidebarHeader className="gap-2 px-3 pt-3 pb-0 group-data-[collapsible=icon]:items-center group-data-[collapsible=icon]:px-2">
      <SidebarBrand />
      {farm ? (
        <FarmSwitcher farm={farm} onError={onError} />
      ) : (
        <Skeleton className="h-10 rounded-md bg-sidebar-accent group-data-[collapsible=icon]:size-8" />
      )}
    </SidebarHeader>
    <SidebarContent>
      <div className="px-3 pt-2 group-data-[collapsible=icon]:hidden">
        <Skeleton className="h-9 rounded-md bg-sidebar-accent" />
      </div>
      <SidebarGroup className={GROUP_CLASS}>
        <SidebarGroupLabel className={GROUP_LABEL_CLASS}>
          Visninger
        </SidebarGroupLabel>
        <SidebarGroupContent className="space-y-2 pt-1">
          <Skeleton className={SIDEBAR_ROW_CLASS} />
          <Skeleton className="h-8 w-2/3 rounded-md bg-sidebar-accent" />
          <div className="ml-3.5 space-y-2 border-l border-sidebar-border pl-2 group-data-[collapsible=icon]:ml-0 group-data-[collapsible=icon]:border-l-0 group-data-[collapsible=icon]:pl-0">
            <Skeleton className={SIDEBAR_ROW_CLASS} />
            <Skeleton className={`${SIDEBAR_ROW_CLASS} w-5/6`} />
          </div>
        </SidebarGroupContent>
      </SidebarGroup>
    </SidebarContent>
  </Sidebar>
)

export const FarmContentSkeleton = () => (
  <div className="flex min-h-0 flex-1 animate-skeleton-in flex-col gap-2 overflow-hidden px-4 pt-2 pb-4">
    <Skeleton className="h-10 rounded-lg" />
    <FarmFieldsSkeleton message="Henter bedriftens marker" />
  </div>
)
