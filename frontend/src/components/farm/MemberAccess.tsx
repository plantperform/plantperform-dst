import { ChevronDown, Eye, LogOut, Pencil, UserPlus, X } from 'lucide-react'
import { useId, type FormEvent, type ReactNode } from 'react'

import type { FarmMember, MembershipRole } from '@/api/types'
import { TruncatedTooltip } from '@/components/ui/app-tooltip'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { FieldError } from '@/components/ui/field-error'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Pending } from '@/components/ui/pending'
import {
  SegmentedControl,
  type SegmentedControlOption,
} from '@/components/ui/segmented-control'
import {
  MEMBERSHIP_ROLE_DESCRIPTIONS,
  MEMBERSHIP_ROLE_LABELS,
  MEMBERSHIP_ROLE_TINTS,
} from '@/lib/farm-access'
import { userInitials } from '@/lib/user-name'
import { cn } from '@/lib/utils'

const ROW_ACTION_CLASS =
  'shrink-0 gap-1.5 text-muted-foreground hover:text-destructive'

const ROLES = Object.keys(MEMBERSHIP_ROLE_LABELS) as MembershipRole[]

const ROLE_ICONS = { viewer: Eye, editor: Pencil }

export const RoleIcon = ({
  role,
  className,
}: {
  role: MembershipRole
  className?: string
}) => {
  const Icon = ROLE_ICONS[role]
  return <Icon className={className} aria-hidden="true" />
}

const ROLE_OPTIONS = ROLES.map(
  (value): SegmentedControlOption<MembershipRole> => ({
    value,
    label: MEMBERSHIP_ROLE_LABELS[value],
    icon: ROLE_ICONS[value],
    title: MEMBERSHIP_ROLE_DESCRIPTIONS[value],
  }),
)

type RoleMenuProps = {
  email: string
  role: MembershipRole
  changing: boolean
  onChange: (role: MembershipRole) => void
}

const RoleMenu = ({ email, role, changing, onChange }: RoleMenuProps) => (
  <DropdownMenu>
    <DropdownMenuTrigger asChild>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="shrink-0 gap-1 text-muted-foreground"
        loading={changing}
        aria-label={`Rolle for ${email}: ${MEMBERSHIP_ROLE_LABELS[role]}`}
      >
        {MEMBERSHIP_ROLE_LABELS[role]}
        {changing ? null : (
          <ChevronDown className="size-3.5" aria-hidden="true" />
        )}
      </Button>
    </DropdownMenuTrigger>
    <DropdownMenuContent align="end" className="w-56">
      {ROLES.map((option) => (
        <DropdownMenuCheckboxItem
          key={option}
          checked={option === role}
          className="py-2"
          onSelect={() => {
            if (option !== role) onChange(option)
          }}
        >
          <span>
            <span className="block">{MEMBERSHIP_ROLE_LABELS[option]}</span>
            <span className="block text-xs text-muted-foreground">
              {MEMBERSHIP_ROLE_DESCRIPTIONS[option]}
            </span>
          </span>
        </DropdownMenuCheckboxItem>
      ))}
    </DropdownMenuContent>
  </DropdownMenu>
)

type MemberListProps = {
  members: FarmMember[]
  loading: boolean
  loadError: unknown
  retrying: boolean
  onRetry: () => void
  ownEmail: string
  canManage: boolean
  canLeave: boolean
  removingEmail: string | null
  changingEmail: string | null
  memberError: string | null
  onRemove: (email: string) => void
  onChangeRole: (email: string, role: MembershipRole) => void
  onLeave: () => void
  describeMember?: (email: string) => ReactNode
  ownCard?: boolean
}

export const MemberList = ({
  members,
  loading,
  loadError,
  retrying,
  onRetry,
  ownEmail,
  canManage,
  canLeave,
  removingEmail,
  changingEmail,
  memberError,
  onRemove,
  onChangeRole,
  onLeave,
  describeMember,
  ownCard = false,
}: MemberListProps) => (
  <>
    {loading || loadError ? (
      <Pending
        failed={!loading}
        failure="Kunne ikke hente, hvem der har adgang."
        loading="Henter, hvem der har adgang..."
        retrying={retrying}
        onRetry={onRetry}
        className={cn('px-6 py-4', !ownCard && 'border-b')}
      />
    ) : (
      <ul>
        {members.map((member) => {
          const isSelf = member.email === ownEmail
          const removing = removingEmail === member.email
          const description = describeMember?.(member.email)
          return (
            <li
              key={member.email}
              className={cn(
                'flex items-center gap-3.5 border-b border-border/60 px-6 py-3',
                ownCard && 'last:border-b-0',
              )}
            >
              <span
                aria-hidden="true"
                className={cn(
                  'flex size-8 shrink-0 items-center justify-center rounded-full text-[13px] font-semibold',
                  MEMBERSHIP_ROLE_TINTS[member.role],
                )}
              >
                {userInitials(null, member.email)}
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex min-w-0 items-center gap-2 text-[15px]">
                  <TruncatedTooltip content={member.email} className="truncate">
                    {member.email}
                  </TruncatedTooltip>
                  {isSelf ? (
                    <span className="shrink-0 text-[13px] text-muted-foreground">
                      (dig)
                    </span>
                  ) : null}
                </div>
                {description ? (
                  <p className="mt-0.5 text-[13px] text-muted-foreground">
                    {description}
                  </p>
                ) : null}
              </div>
              {canManage && !isSelf ? (
                <RoleMenu
                  email={member.email}
                  role={member.role}
                  changing={changingEmail === member.email}
                  onChange={(role) => onChangeRole(member.email, role)}
                />
              ) : (
                <span className="shrink-0 text-[13px] text-muted-foreground">
                  {MEMBERSHIP_ROLE_LABELS[member.role]}
                </span>
              )}
              {isSelf ? (
                canLeave ? (
                  <Button
                    variant="outline"
                    size="sm"
                    className="shrink-0 gap-1.5 border-destructive/50 text-destructive hover:bg-destructive/10 hover:text-destructive"
                    loading={removing}
                    onClick={onLeave}
                  >
                    {removing ? null : (
                      <LogOut className="size-4" aria-hidden="true" />
                    )}
                    Forlad
                  </Button>
                ) : null
              ) : canManage ? (
                <Button
                  variant="ghost"
                  size="sm"
                  className={ROW_ACTION_CLASS}
                  loading={removing}
                  aria-label={`Fjern ${member.email}`}
                  onClick={() => onRemove(member.email)}
                >
                  {removing ? null : (
                    <X className="size-4" aria-hidden="true" />
                  )}
                  Fjern
                </Button>
              ) : null}
            </li>
          )
        })}
      </ul>
    )}
    {memberError ? (
      <p
        role="alert"
        className={cn(
          'px-6 py-3 text-[13px] text-destructive',
          ownCard ? 'border-t' : 'border-b',
        )}
      >
        {memberError}
      </p>
    ) : null}
  </>
)

type ShareByEmailFormProps = {
  email: string
  role: MembershipRole
  error: string | null
  sharing: boolean
  onEmailChange: (email: string) => void
  onRoleChange: (role: MembershipRole) => void
  onSubmit: (event: FormEvent) => void
  className?: string
}

export const ShareByEmailForm = ({
  email,
  role,
  error,
  sharing,
  onEmailChange,
  onRoleChange,
  onSubmit,
  className,
}: ShareByEmailFormProps) => {
  const id = useId()

  return (
    <form
      className={cn('px-6 pt-[18px] pb-5', className)}
      onSubmit={onSubmit}
      noValidate
    >
      <Label htmlFor={`${id}-email`} className="text-[13px] font-normal">
        Del med
      </Label>
      <div className="mt-1.5 flex flex-wrap gap-2">
        <Input
          id={`${id}-email`}
          type="email"
          autoComplete="off"
          placeholder="navn@eksempel.dk"
          value={email}
          aria-invalid={error ? true : undefined}
          aria-describedby={`${id}-help ${id}-error`}
          className="min-w-36 flex-1 bg-card"
          onChange={(event) => onEmailChange(event.target.value)}
        />
        <SegmentedControl
          aria-label="Rolle"
          value={role}
          options={ROLE_OPTIONS}
          labelClassName=""
          className="h-10 p-1"
          optionClassName="h-full px-3.5 text-sm"
          onValueChange={onRoleChange}
        />
        <Button type="submit" className="shrink-0" loading={sharing}>
          {sharing ? null : <UserPlus className="size-4" aria-hidden="true" />}
          {sharing ? 'Deler...' : 'Del'}
        </Button>
      </div>
      <div className="mt-2">
        <FieldError id={`${id}-error`} message={error} />
      </div>
      <p
        id={`${id}-help`}
        className="mt-2 text-[13px] leading-normal text-muted-foreground"
      >
        Personen skal have en bekræftet konto i PlantPerform.
      </p>
    </form>
  )
}
