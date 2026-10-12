import { FarmFieldsSkeleton } from '@/components/farm/FarmFieldsSkeleton'
import {
  FARM_SIDEBAR_CLASS,
  GROUP_CLASS,
  GROUP_LABEL_CLASS,
} from '@/components/farm/FarmSidebar'
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
} from '@/components/ui/sidebar'
import { Skeleton } from '@/components/ui/skeleton'

const SIDEBAR_ROW_CLASS = 'h-11 rounded-[10px] bg-sidebar-accent'

export const FarmSidebarSkeleton = () => (
  <Sidebar className={FARM_SIDEBAR_CLASS} aria-label="Navigation for bedriften">
    <SidebarContent className="gap-0 pt-0.5">
      <SidebarGroup className={GROUP_CLASS}>
        <SidebarGroupLabel className={GROUP_LABEL_CLASS}>
          Visninger
        </SidebarGroupLabel>
        <SidebarGroupContent className="space-y-2">
          <Skeleton className={SIDEBAR_ROW_CLASS} />
          <Skeleton className="h-8 w-2/3 rounded-[10px] bg-sidebar-accent" />
          <div className="space-y-2 pl-7">
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
