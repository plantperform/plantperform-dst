import { ChevronDown, LogOut } from 'lucide-react'
import { useRef, useState, type FormEvent, type ReactNode } from 'react'
import { flushSync } from 'react-dom'

import { useAuth } from '@/auth/context'
import { useNameFields } from '@/components/onboarding/name-fields'
import { NameFields } from '@/components/onboarding/NameFields'
import { useToast } from '@/components/toast'
import { Button } from '@/components/ui/button'
import {
  Sheet,
  SheetContent,
  SheetTitle,
  SheetTrigger,
} from '@/components/ui/sheet'
import { useUserName } from '@/hooks/use-user-name'
import { describeLanding, getStoredRole, ROLE_LABELS } from '@/lib/onboarding'
import { formatFullName, userInitials, type UserName } from '@/lib/user-name'
import { cn } from '@/lib/utils'

const VALUE_CLASS = 'mt-0.5 text-[15px]'

type AccountRowProps = {
  label: string
  action?: ReactNode
  children: ReactNode
}

const AccountRow = ({ label, action, children }: AccountRowProps) => (
  <div className="flex items-center justify-between gap-4 py-4">
    <div className="min-w-0">
      <p className="text-xs text-muted-foreground">{label}</p>
      {children}
    </div>
    {action}
  </div>
)

type NameFormProps = {
  title: string
  name: UserName | null
  onSave: (name: UserName) => boolean
  onClose: () => void
}

const NameForm = ({ title, name, onSave, onClose }: NameFormProps) => {
  const fields = useNameFields(name)
  const [saveFailed, setSaveFailed] = useState(false)

  const onSubmit = (event: FormEvent) => {
    event.preventDefault()
    const next = fields.validate()
    if (!next) return
    if (onSave(next)) onClose()
    else setSaveFailed(true)
  }

  return (
    <form className="px-6 pt-5" noValidate onSubmit={onSubmit}>
      <h2 className="text-[17px] font-semibold">{title}</h2>
      <div className="mt-3.5">
        <NameFields fields={fields} autoFocus />
      </div>
      <p className="mt-2 text-xs text-muted-foreground">
        Navnet gemmes kun i denne browser.
      </p>
      {saveFailed ? (
        <p role="alert" className="mt-2 text-xs font-medium text-destructive">
          Navnet kunne ikke gemmes i denne browser.
        </p>
      ) : null}
      <div className="mt-5 flex gap-2.5">
        <Button type="submit">Gem</Button>
        <Button type="button" variant="outline" onClick={onClose}>
          Annuller
        </Button>
      </div>
    </form>
  )
}

export const AccountButton = () => {
  const { user, signOut } = useAuth()
  const { name, saveName } = useUserName()
  const { showToast } = useToast()
  const [editingName, setEditingName] = useState(false)
  const editNameButton = useRef<HTMLButtonElement>(null)
  const email = user?.email ?? ''
  const initials = userInitials(name, email)
  const fullName = name ? formatFullName(name) : null
  const role = email ? getStoredRole(email) : null
  const roleLabel = role ? ROLE_LABELS[role] : null
  const identity = [fullName ? email : null, roleLabel]
    .filter(Boolean)
    .join(' · ')
  const nameAction = fullName ? 'Ret' : 'Tilføj'

  const closeNameForm = () => {
    flushSync(() => setEditingName(false))
    editNameButton.current?.focus()
  }

  const saveAndConfirm = (next: UserName) => {
    const saved = saveName(next)
    if (saved) showToast('Dit navn er gemt')
    return saved
  }

  return (
    <Sheet
      onOpenChange={(open) => {
        if (open) setEditingName(false)
      }}
    >
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
            {initials}
          </span>
          <span className="hidden min-w-0 flex-col items-start leading-[1.15] sm:flex">
            <span className="max-w-[220px] truncate text-sm font-bold">
              {fullName ?? email}
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
            {initials}
          </span>
          <div className="min-w-0">
            <p className="truncate font-display text-[22px] leading-[1.2]">
              {fullName ?? email}
            </p>
            {identity ? (
              <p className="mt-1 truncate text-[13px] text-muted-foreground">
                {identity}
              </p>
            ) : null}
          </div>
        </div>
        {editingName ? (
          <NameForm
            title={`${nameAction} navn`}
            name={name}
            onSave={saveAndConfirm}
            onClose={closeNameForm}
          />
        ) : (
          <>
            <div className="min-h-0 flex-1 divide-y overflow-y-auto px-6">
              <AccountRow
                label="Navn"
                action={
                  <Button
                    ref={editNameButton}
                    variant="outline"
                    size="sm"
                    className="shrink-0"
                    aria-label={`${nameAction} navn`}
                    onClick={() => setEditingName(true)}
                  >
                    {nameAction}
                  </Button>
                }
              >
                <p
                  className={cn(
                    VALUE_CLASS,
                    'truncate',
                    !fullName && 'text-muted-foreground',
                  )}
                >
                  {fullName ?? 'Ikke angivet'}
                </p>
              </AccountRow>
              <AccountRow label="E-mail">
                <p className={cn(VALUE_CLASS, 'break-all')}>{email}</p>
              </AccountRow>
              <AccountRow label="Adgangskode">
                <p className={cn(VALUE_CLASS, 'tracking-[0.2em]')}>
                  <span aria-hidden="true">••••••••</span>
                  <span className="sr-only">Skjult</span>
                </p>
              </AccountRow>
              <AccountRow label="Jeg er">
                <p
                  className={cn(
                    VALUE_CLASS,
                    !roleLabel && 'text-muted-foreground',
                  )}
                >
                  {roleLabel ?? 'Ikke valgt'}
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  Bestemmer, hvad du ser først.
                </p>
              </AccountRow>
              <AccountRow label="Når jeg logger ind">
                <p className={VALUE_CLASS}>{describeLanding(role)}</p>
              </AccountRow>
            </div>
            <div className="border-t px-6 pt-4 pb-6">
              <Button
                variant="outline"
                className="w-full"
                onClick={() => void signOut()}
              >
                <LogOut className="size-4" aria-hidden="true" />
                Log ud
              </Button>
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  )
}
