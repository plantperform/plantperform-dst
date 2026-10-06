import {
  ChevronRight,
  Coins,
  MoreVertical,
  Pencil,
  Plus,
  Trash2,
} from 'lucide-react'
import { useId, useState } from 'react'
import { NavLink, useMatch } from 'react-router-dom'

import { useEconomicsNavigation } from '@/components/farm/economics-navigation'
import {
  useEconomicsProfiles,
  useProfilePageNavigation,
} from '@/components/farm/economics-profiles-state'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  SidebarMenu,
  SidebarMenuAction,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from '@/components/ui/sidebar'
import { profileChanges } from '@/lib/economics'
import {
  STANDARD_PROFILE_ID,
  type EconomicsProfile,
} from '@/lib/economics-profiles'
import { cn } from '@/lib/utils'

const ProfileChangeCount = ({ profile }: { profile: EconomicsProfile }) => {
  const { assumptions } = useEconomicsProfiles()
  const count = profileChanges(assumptions, profile.overrides).length

  return count === 0 ? null : (
    <span className="shrink-0 text-[11px] font-normal text-sidebar-foreground/70 tabular-nums group-data-[collapsible=icon]:hidden">
      {count} ændr.
    </span>
  )
}

type EconomicsProfilesMenuProps = {
  onDeleteProfile: (profile: EconomicsProfile) => void
}

export const EconomicsProfilesMenu = ({
  onDeleteProfile,
}: EconomicsProfilesMenuProps) => {
  const { profiles, profilePath } = useEconomicsProfiles()
  const { openProfileRename } = useProfilePageNavigation()
  const { startGuide } = useEconomicsNavigation()
  const { state, isMobile } = useSidebar()
  const iconRail = state === 'collapsed' && !isMobile
  const [open, setOpen] = useState(true)
  const listId = useId()
  const activeProfileId =
    useMatch('/farms/:farmId/economics/:profileId/*')?.params.profileId ?? null
  const showProfiles = open || iconRail

  return (
    <>
      <SidebarMenuItem className="group-data-[collapsible=icon]:hidden">
        <SidebarMenuButton
          aria-expanded={open}
          aria-controls={listId}
          className="rounded-md px-3 font-medium"
          onClick={() => setOpen((current) => !current)}
        >
          <ChevronRight
            className={cn(
              'motion-safe:transition-transform',
              open && 'rotate-90',
            )}
          />
          <Coins />
          <span>Økonomi</span>
        </SidebarMenuButton>
      </SidebarMenuItem>
      <li id={listId}>
        <SidebarMenu className="ml-3.5 w-auto border-l border-sidebar-border pl-2 group-data-[collapsible=icon]:ml-0 group-data-[collapsible=icon]:border-l-0 group-data-[collapsible=icon]:pl-0">
          {showProfiles
            ? profiles.map((profile) => (
                <SidebarMenuItem key={profile.id}>
                  <SidebarMenuButton
                    asChild
                    isActive={profile.id === activeProfileId}
                    className="rounded-md px-3 font-medium data-[active=true]:[&>svg]:text-primary"
                    tooltip={profile.name}
                  >
                    <NavLink to={profilePath(profile.id)}>
                      <Coins className="hidden group-data-[collapsible=icon]:block" />
                      <span className="min-w-0 flex-1 truncate">
                        {profile.name}
                      </span>
                      <ProfileChangeCount profile={profile} />
                    </NavLink>
                  </SidebarMenuButton>
                  {profile.id === STANDARD_PROFILE_ID ? null : (
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <SidebarMenuAction
                          showOnHover
                          aria-label={`Handlinger for ${profile.name}`}
                        >
                          <MoreVertical />
                        </SidebarMenuAction>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent
                        side="right"
                        align="start"
                        onCloseAutoFocus={(event) => event.preventDefault()}
                      >
                        <DropdownMenuItem
                          onSelect={() => openProfileRename(profile.id)}
                        >
                          <Pencil className="mr-2 size-4" aria-hidden="true" />
                          Omdøb
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          className="text-destructive focus:text-destructive"
                          onSelect={() => onDeleteProfile(profile)}
                        >
                          <Trash2 className="mr-2 size-4" aria-hidden="true" />
                          Slet
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  )}
                </SidebarMenuItem>
              ))
            : null}
          {showProfiles ? (
            <SidebarMenuItem>
              <SidebarMenuButton
                className="rounded-md px-3 font-medium text-primary hover:text-primary"
                tooltip="Ny økonomiprofil"
                onClick={() =>
                  startGuide({ fromProfileId: STANDARD_PROFILE_ID })
                }
              >
                <Plus />
                <span>Ny økonomiprofil</span>
              </SidebarMenuButton>
            </SidebarMenuItem>
          ) : null}
        </SidebarMenu>
      </li>
    </>
  )
}
