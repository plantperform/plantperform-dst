import { ChevronDown, LogOut } from 'lucide-react'

import { useAuth } from '@/auth/context'
import { Button } from '@/components/ui/button'
import {
  Sheet,
  SheetContent,
  SheetTitle,
  SheetTrigger,
} from '@/components/ui/sheet'
import { getStoredRole, ROLE_LABELS } from '@/lib/onboarding'

export const AccountButton = () => {
  const { user, signOut } = useAuth()
  const email = user?.email ?? ''
  const initial = email.charAt(0).toUpperCase()
  const role = email ? getStoredRole(email) : null
  const roleLabel = role ? ROLE_LABELS[role] : null

  return (
    <Sheet>
      <SheetTrigger asChild>
        <button
          type="button"
          aria-label="Din konto"
          className="ml-auto flex h-9 max-w-80 shrink-0 items-center gap-2.5 rounded-full border border-brand-foreground/30 bg-brand-foreground/15 py-0.5 pr-2.5 pl-0.5 text-brand-foreground transition-colors hover:bg-brand-foreground/25 focus-visible:ring-2 focus-visible:ring-brand-foreground focus-visible:outline-none"
        >
          <span
            aria-hidden="true"
            className="flex size-[30px] shrink-0 items-center justify-center rounded-full bg-card text-xs font-bold text-primary"
          >
            {initial}
          </span>
          <span className="hidden min-w-0 flex-col items-start leading-[1.15] sm:flex">
            <span className="max-w-[220px] truncate text-sm font-bold">
              {email}
            </span>
            {roleLabel ? (
              <span className="text-[11px] opacity-80">{roleLabel}</span>
            ) : null}
          </span>
          <ChevronDown className="size-3.5 shrink-0" aria-hidden="true" />
        </button>
      </SheetTrigger>
      <SheetContent
        side="right"
        aria-describedby={undefined}
        className="w-full gap-0 bg-card p-0 sm:max-w-[440px]"
      >
        <SheetTitle className="px-6 pt-4 text-[13px] font-normal text-muted-foreground">
          Din konto
        </SheetTitle>
        <div className="flex items-center gap-3.5 border-b px-6 pt-2.5 pb-5">
          <span
            aria-hidden="true"
            className="flex size-12 shrink-0 items-center justify-center rounded-full bg-primary text-base font-bold text-primary-foreground"
          >
            {initial}
          </span>
          <div className="min-w-0">
            <p className="truncate font-display text-[22px] leading-[1.2]">
              {email}
            </p>
            {roleLabel ? (
              <p className="mt-1 truncate text-[13px] text-muted-foreground">
                {roleLabel}
              </p>
            ) : null}
          </div>
        </div>
        <div className="mt-auto border-t px-6 pt-4 pb-6">
          <Button
            variant="outline"
            className="w-full"
            onClick={() => void signOut()}
          >
            <LogOut className="size-4" aria-hidden="true" />
            Log ud
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  )
}
