import {
  ChevronDown,
  ChevronRight,
  Share2,
  Trash2,
  Warehouse,
  type LucideIcon,
} from 'lucide-react'
import { useState, type ReactNode } from 'react'
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
import { Separator } from '@/components/ui/separator'
import { SidebarTrigger } from '@/components/ui/sidebar'
import { HOME_OVERVIEW_STATE } from '@/lib/onboarding'

type FarmTopBarProps = {
  farm: Farm
  viewLabel: string
  viewIcon: LucideIcon
  actions?: ReactNode
  onError: (message: string | null) => void
}

const FARM_NAME_CLASS =
  'truncate font-display text-lg font-semibold tracking-tight'

export const FarmTopBar = ({
  farm,
  viewLabel,
  viewIcon: ViewIcon,
  actions,
  onError,
}: FarmTopBarProps) => (
  <header className="flex min-h-12 shrink-0 flex-wrap items-center gap-3 border-b bg-background px-4 py-1 @container">
    <SidebarTrigger
      className="size-8 shrink-0 md:hidden"
      aria-label="Vis eller skjul sidepanelet"
    />
    <Separator orientation="vertical" className="h-5 md:hidden" />

    <div className="flex min-w-0 flex-1 items-center gap-2">
      <FarmMenu farm={farm} onError={onError} />
      <ChevronRight
        className="size-3.5 shrink-0 text-muted-foreground"
        aria-hidden="true"
      />
      <span className="inline-flex min-w-0 items-center gap-1.5 rounded-full border bg-muted px-2.5 py-1 text-xs font-medium text-foreground">
        <ViewIcon
          className="size-3.5 shrink-0 text-muted-foreground"
          aria-hidden="true"
        />
        <span className="truncate">{viewLabel}</span>
      </span>
    </div>

    {actions ? (
      <div className="flex shrink-0 items-center gap-2">{actions}</div>
    ) : null}
  </header>
)

type FarmMenuProps = {
  farm: Farm
  onError: (message: string | null) => void
}

const FarmMenu = ({ farm, onError }: FarmMenuProps) => {
  const navigate = useNavigate()
  const { data: farms } = useFarms()
  const [shareOpen, setShareOpen] = useState(false)
  const [deleteOpen, setDeleteOpen] = useState(false)
  const otherFarms = (farms ?? [])
    .filter((candidate) => candidate.id !== farm.id)
    .sort((left, right) => left.name.localeCompare(right.name, 'da'))
  const hasSeveralFarms = (farms?.length ?? 0) > 1

  return (
    <>
      <DropdownMenu>
        <h1 className="flex min-w-0 items-center">
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              aria-label={`Menu for bedriften ${farm.name}`}
              className="flex min-w-0 items-center gap-1 rounded-md px-1 py-0.5 -mx-1 hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring data-[state=open]:bg-muted"
            >
              <span className={FARM_NAME_CLASS}>{farm.name}</span>
              <ChevronDown
                className="size-4 shrink-0 text-muted-foreground"
                aria-hidden="true"
              />
            </button>
          </DropdownMenuTrigger>
        </h1>
        <DropdownMenuContent align="start" className="min-w-56">
          {otherFarms.length > 0 ? (
            <>
              <DropdownMenuLabel>Skift til</DropdownMenuLabel>
              {otherFarms.map((candidate) => (
                <DropdownMenuItem
                  key={candidate.id}
                  onSelect={() => navigate(`/farms/${candidate.id}`)}
                >
                  <span className="grid min-w-0 leading-tight">
                    <span className="truncate">{candidate.name}</span>
                    {candidate.ownerName ? (
                      <span className="truncate text-xs text-muted-foreground">
                        {candidate.ownerName}
                      </span>
                    ) : null}
                  </span>
                </DropdownMenuItem>
              ))}
              <DropdownMenuSeparator />
            </>
          ) : null}
          {hasSeveralFarms ? (
            <>
              <DropdownMenuItem asChild>
                <Link to="/" state={HOME_OVERVIEW_STATE}>
                  <Warehouse
                    className="mr-2 size-4 shrink-0"
                    aria-hidden="true"
                  />
                  Bedrifter
                </Link>
              </DropdownMenuItem>
              <DropdownMenuSeparator />
            </>
          ) : null}
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
