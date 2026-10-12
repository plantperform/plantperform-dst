import { Check, ChevronsUpDown, Home, Plus } from 'lucide-react'
import { useState } from 'react'
import { Link } from 'react-router-dom'

import { useFarms } from '@/api/hooks'
import type { Farm } from '@/api/types'
import { useAuth } from '@/auth/context'
import { FarmSearchInput } from '@/components/farm/FarmSearchInput'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'
import { describeFarmOwner } from '@/lib/farm-form'
import { switcherFarms } from '@/lib/farm-switcher'
import { getLastOpenedMap, HOME_OVERVIEW_STATE } from '@/lib/onboarding'
import { cn } from '@/lib/utils'

const MENU_ROW_CLASS =
  'flex w-full items-center gap-2.5 rounded-md px-2.5 text-left text-sm transition-colors hover:bg-muted focus-visible:bg-muted focus-visible:outline-none'

type FarmSwitcherProps = {
  farm: Farm
  samePage: string
}

export const FarmSwitcher = ({ farm, samePage }: FarmSwitcherProps) => {
  const { user } = useAuth()
  const email = user?.email ?? ''
  const [open, setOpen] = useState(false)
  const [searchText, setSearchText] = useState('')
  const { data: farms } = useFarms()
  const list = switcherFarms(
    [farm, ...(farms ?? []).filter((candidate) => candidate.id !== farm.id)],
    open && email ? getLastOpenedMap(email) : {},
    searchText,
  )

  const changeOpen = (nextOpen: boolean) => {
    setOpen(nextOpen)
    if (!nextOpen) setSearchText('')
  }

  return (
    <Popover open={open} onOpenChange={changeOpen}>
      <h1 className="min-w-0">
        <PopoverTrigger asChild>
          <button
            type="button"
            aria-label={`Skift bedrift, ${farm.name}`}
            className="flex h-8 max-w-full items-center gap-2 rounded-lg border border-brand-foreground/30 bg-brand-foreground/15 pr-2.5 pl-3 text-sm font-bold text-brand-foreground transition-colors hover:bg-brand-foreground/25 focus-visible:ring-2 focus-visible:ring-brand-foreground focus-visible:outline-none"
          >
            <span className="truncate">{farm.name}</span>
            <ChevronsUpDown className="size-3.5 shrink-0" aria-hidden="true" />
          </button>
        </PopoverTrigger>
      </h1>
      <PopoverContent
        align="start"
        sideOffset={8}
        className="w-[340px] max-w-[calc(100vw-2rem)] overflow-hidden rounded-xl p-0 shadow-lg"
      >
        {list.searchable ? (
          <FarmSearchInput
            className="mx-2.5 mt-2.5 mb-1"
            autoFocus
            value={searchText}
            onChange={setSearchText}
          />
        ) : null}
        <p className="px-4.5 pt-2.5 pb-1 text-xs font-medium text-muted-foreground">
          {list.heading}
        </p>
        <ul className="max-h-[360px] overflow-y-auto px-2 pb-2">
          {list.farms.map((candidate) => {
            const current = candidate.id === farm.id
            return (
              <li key={candidate.id}>
                <Link
                  to={`/farms/${candidate.id}${samePage}`}
                  aria-current={current ? 'page' : undefined}
                  className={cn(MENU_ROW_CLASS, 'py-1.5')}
                  onClick={() => changeOpen(false)}
                >
                  <span className="grid min-w-0 flex-1 gap-0.5 leading-tight">
                    <span
                      className={cn('truncate', current && 'font-semibold')}
                    >
                      {candidate.name}
                    </span>
                    <span className="truncate text-xs text-muted-foreground">
                      {describeFarmOwner(candidate)}
                    </span>
                  </span>
                  {current ? (
                    <Check
                      className="size-4 shrink-0 text-primary"
                      aria-hidden="true"
                    />
                  ) : null}
                </Link>
              </li>
            )
          })}
          {list.farms.length === 0 ? (
            <li className="p-2.5 text-sm text-muted-foreground">
              Ingen bedrifter matcher
            </li>
          ) : null}
        </ul>
        <div className="flex flex-col border-t p-2">
          <Link
            to="/"
            state={HOME_OVERVIEW_STATE}
            className={cn(MENU_ROW_CLASS, 'h-9')}
            onClick={() => changeOpen(false)}
          >
            <Home
              className="size-4 shrink-0 text-muted-foreground"
              aria-hidden="true"
            />
            Dine bedrifter
          </Link>
          <Link
            to="/farms/new"
            state={{ from: { farmId: farm.id, name: farm.name } }}
            className={cn(MENU_ROW_CLASS, 'h-9')}
            onClick={() => changeOpen(false)}
          >
            <Plus
              className="size-4 shrink-0 text-muted-foreground"
              aria-hidden="true"
            />
            Opret bedrift
          </Link>
        </div>
      </PopoverContent>
    </Popover>
  )
}
