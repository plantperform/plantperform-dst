import { Check, ChevronsUpDown, Plus, Share2, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'

import { useFarms } from '@/api/hooks'
import type { Farm } from '@/api/types'
import {
  DeleteFarmDialog,
  ShareFarmDialog,
} from '@/components/farm/FarmDialogs'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from '@/components/ui/sidebar'

type FarmSwitcherProps = {
  farm: Farm
  onError: (message: string | null) => void
}

export const FarmSwitcher = ({ farm, onError }: FarmSwitcherProps) => {
  const navigate = useNavigate()
  const iconRail = useSidebar().state === 'collapsed'
  const { data: farms } = useFarms()
  const [shareOpen, setShareOpen] = useState(false)
  const [deleteOpen, setDeleteOpen] = useState(false)
  const farmList = [
    farm,
    ...(farms ?? []).filter((candidate) => candidate.id !== farm.id),
  ].sort((left, right) => left.name.localeCompare(right.name, 'da'))

  return (
    <>
      <SidebarMenu>
        <SidebarMenuItem>
          <DropdownMenu>
            <h1 className="min-w-0">
              <DropdownMenuTrigger asChild>
                <SidebarMenuButton
                  size="lg"
                  aria-label={`Menu for bedriften ${farm.name}`}
                  tooltip={farm.name}
                  className="h-auto rounded-md border border-sidebar-border bg-card px-3 py-2 data-[state=open]:bg-sidebar-accent data-[state=open]:text-sidebar-accent-foreground group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:px-0! group-data-[collapsible=icon]:py-0!"
                >
                  <span className="truncate font-display text-base font-semibold tracking-tight group-data-[collapsible=icon]:hidden">
                    {farm.name}
                  </span>
                  <span className="hidden font-display text-base font-semibold group-data-[collapsible=icon]:inline">
                    {farm.name.charAt(0)}
                  </span>
                  <ChevronsUpDown
                    className="ml-auto size-3.5 text-sidebar-foreground/70 group-data-[collapsible=icon]:hidden"
                    aria-hidden="true"
                  />
                </SidebarMenuButton>
              </DropdownMenuTrigger>
            </h1>
            <DropdownMenuContent
              side={iconRail ? 'right' : 'bottom'}
              align="start"
              className="w-(--radix-dropdown-menu-trigger-width) min-w-56"
            >
              <DropdownMenuLabel>Bedrifter</DropdownMenuLabel>
              {farmList.map((candidate) => {
                const current = candidate.id === farm.id
                return (
                  <DropdownMenuItem
                    key={candidate.id}
                    className={current ? 'font-medium' : undefined}
                    aria-current={current ? 'page' : undefined}
                    onSelect={() => {
                      if (!current) navigate(`/farms/${candidate.id}`)
                    }}
                  >
                    {current ? (
                      <Check
                        className="mr-2 size-4 shrink-0"
                        aria-hidden="true"
                      />
                    ) : (
                      <span
                        className="mr-2 size-4 shrink-0"
                        aria-hidden="true"
                      />
                    )}
                    <span className="min-w-0 truncate">{candidate.name}</span>
                    {candidate.ownerName ? (
                      <span className="ml-auto shrink-0 pl-3 text-xs font-normal text-muted-foreground">
                        {candidate.ownerName}
                      </span>
                    ) : null}
                  </DropdownMenuItem>
                )
              })}
              <DropdownMenuSeparator />
              <DropdownMenuItem asChild>
                <Link to="/farms/new">
                  <Plus className="mr-2 size-4 shrink-0" aria-hidden="true" />
                  Opret ny bedrift
                </Link>
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onSelect={() => setShareOpen(true)}>
                <Share2 className="mr-2 size-4 shrink-0" aria-hidden="true" />
                Del bedrift
              </DropdownMenuItem>
              <DropdownMenuItem
                className="text-destructive focus:text-destructive [&>svg]:text-destructive"
                onSelect={() => setDeleteOpen(true)}
              >
                <Trash2 className="mr-2 size-4 shrink-0" aria-hidden="true" />
                Slet bedrift
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </SidebarMenuItem>
      </SidebarMenu>
      <ShareFarmDialog
        farm={farm}
        open={shareOpen}
        onOpenChange={setShareOpen}
        onError={onError}
      />
      <DeleteFarmDialog
        farm={farm}
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        onError={onError}
      />
    </>
  )
}
