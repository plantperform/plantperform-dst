import { FarmFieldsSkeleton } from '@/components/farm/FarmFieldsSkeleton'
import { GROUP_LABEL_CLASS, SidebarBrand } from '@/components/farm/FarmSidebar'
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

export const FarmSidebarSkeleton = () => (
  <Sidebar collapsible="icon" aria-label="Navigation for bedriften">
    <SidebarHeader className="h-13 justify-center px-3 py-0">
      <SidebarBrand />
    </SidebarHeader>
    <SidebarContent>
      <div className="px-3 pt-2 group-data-[collapsible=icon]:hidden">
        <Skeleton className="h-9 rounded-md bg-sidebar-accent" />
      </div>
      <SidebarGroup className="px-3 py-1">
        <SidebarGroupLabel className={GROUP_LABEL_CLASS}>
          Visninger
        </SidebarGroupLabel>
        <SidebarGroupContent className="pt-1">
          <Skeleton className={SIDEBAR_ROW_CLASS} />
        </SidebarGroupContent>
      </SidebarGroup>
      <SidebarGroup className="px-3 py-1">
        <SidebarGroupLabel className={GROUP_LABEL_CLASS}>
          Simuleringer
        </SidebarGroupLabel>
        <SidebarGroupContent className="space-y-2 pt-1">
          <Skeleton className={SIDEBAR_ROW_CLASS} />
          <Skeleton className={`${SIDEBAR_ROW_CLASS} w-5/6`} />
        </SidebarGroupContent>
      </SidebarGroup>
    </SidebarContent>
  </Sidebar>
)

export const FarmTopBarSkeleton = () => (
  <header className="flex min-h-12 shrink-0 items-center gap-3 border-b bg-background px-4 py-1">
    <Skeleton className="h-6 w-40 rounded-md" />
    <Skeleton className="h-6 w-28 rounded-full" />
  </header>
)

export const FarmContentSkeleton = () => (
  <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-hidden px-4 pb-4 pt-2">
    <Skeleton className="h-10 rounded-lg" />
    <FarmFieldsSkeleton message="Henter bedriftens marker" />
  </div>
)
