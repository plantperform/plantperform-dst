import { ChevronDown, Home, LogOut, Plus, User } from 'lucide-react'
import { Link } from 'react-router-dom'

import { useAuth } from '@/auth/context'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { getStoredRole, HOME_OVERVIEW_STATE } from '@/lib/onboarding'
import { cn } from '@/lib/utils'

type UserMenuProps = {
  variant?: 'default' | 'onDark'
  className?: string
}

const ROLE_LABELS = { landmand: 'Landmand', konsulent: 'Konsulent' } as const

export const UserMenu = ({ variant = 'default', className }: UserMenuProps) => {
  const { user, signOut } = useAuth()
  const email = user?.email ?? ''
  const initial = email.charAt(0).toUpperCase()
  const role = email ? getStoredRole(email) : null

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label="Brugermenu"
          className={cn(
            'flex items-center gap-1.5 rounded-full py-1 pl-1 pr-2 ring-1 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2',
            variant === 'onDark'
              ? 'bg-primary-foreground/10 ring-primary-foreground/30 hover:bg-primary-foreground/20 focus-visible:ring-primary-foreground/60 focus-visible:ring-offset-transparent'
              : 'bg-muted ring-border hover:bg-muted/70 focus-visible:ring-ring',
            className,
          )}
        >
          <span
            className={cn(
              'flex h-7 w-7 items-center justify-center rounded-full text-sm font-semibold',
              variant === 'onDark'
                ? 'bg-primary-foreground text-primary'
                : 'bg-primary text-primary-foreground',
            )}
          >
            {initial}
          </span>
          <ChevronDown
            className={cn(
              'h-4 w-4',
              variant === 'onDark'
                ? 'text-primary-foreground/80'
                : 'text-muted-foreground',
            )}
            aria-hidden="true"
          />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-56">
        <DropdownMenuLabel>
          <span className="block">{email}</span>
          {role ? (
            <span className="block text-xs font-normal text-muted-foreground">
              {ROLE_LABELS[role]}
            </span>
          ) : null}
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <Link to="/profil">
            <User className="mr-2 h-4 w-4" aria-hidden="true" />
            Profil
          </Link>
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <Link to="/" state={HOME_OVERVIEW_STATE}>
            <Home className="mr-2 h-4 w-4" aria-hidden="true" />
            Mine bedrifter
          </Link>
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <Link to="/farms/new">
            <Plus className="mr-2 h-4 w-4" aria-hidden="true" />
            Opret ny bedrift
          </Link>
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => void signOut()}>
          <LogOut className="mr-2 h-4 w-4" aria-hidden="true" />
          Log ud
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
