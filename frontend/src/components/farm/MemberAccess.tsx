import { LogOut, UserPlus, X } from 'lucide-react'
import { useId, type FormEvent, type ReactNode } from 'react'

import type { FarmMember } from '@/api/types'
import { TruncatedTooltip } from '@/components/ui/app-tooltip'
import { Button } from '@/components/ui/button'
import { FieldError } from '@/components/ui/field-error'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Pending } from '@/components/ui/pending'
import { cn } from '@/lib/utils'

const ROW_ACTION_CLASS =
  'shrink-0 gap-1.5 text-muted-foreground hover:text-destructive'

type MemberListProps = {
  members: FarmMember[]
  loading: boolean
  loadError: unknown
  retrying: boolean
  onRetry: () => void
  ownEmail: string
  removingEmail: string | null
  removeError: string | null
  onRemove: (email: string) => void
  onLeave: () => void
  describeMember?: (email: string) => ReactNode
}

export const MemberList = ({
  members,
  loading,
  loadError,
  retrying,
  onRetry,
  ownEmail,
  removingEmail,
  removeError,
  onRemove,
  onLeave,
  describeMember,
}: MemberListProps) => (
  <>
    {loading || loadError ? (
      <Pending
        failed={!loading}
        failure="Kunne ikke hente, hvem der har adgang."
        loading="Henter, hvem der har adgang..."
        retrying={retrying}
        onRetry={onRetry}
        className="border-b px-6 py-4"
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
              className="flex items-center gap-3.5 border-b border-border/60 px-6 py-3"
            >
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
              {isSelf ? (
                members.length > 1 ? (
                  <Button
                    variant="ghost"
                    size="sm"
                    className={ROW_ACTION_CLASS}
                    loading={removing}
                    onClick={onLeave}
                  >
                    {removing ? null : (
                      <LogOut className="size-4" aria-hidden="true" />
                    )}
                    Forlad
                  </Button>
                ) : null
              ) : (
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
              )}
            </li>
          )
        })}
      </ul>
    )}
    {removeError ? (
      <p
        role="alert"
        className="border-b px-6 py-3 text-[13px] text-destructive"
      >
        {removeError}
      </p>
    ) : null}
  </>
)

type ShareByEmailFormProps = {
  email: string
  error: string | null
  sharing: boolean
  onEmailChange: (email: string) => void
  onSubmit: (event: FormEvent) => void
  className?: string
}

export const ShareByEmailForm = ({
  email,
  error,
  sharing,
  onEmailChange,
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
      <div className="mt-1.5 flex gap-2.5">
        <Input
          id={`${id}-email`}
          type="email"
          autoComplete="off"
          placeholder="navn@eksempel.dk"
          value={email}
          aria-invalid={error ? true : undefined}
          aria-describedby={`${id}-help ${id}-error`}
          className="min-w-0 flex-1 bg-card"
          onChange={(event) => onEmailChange(event.target.value)}
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
