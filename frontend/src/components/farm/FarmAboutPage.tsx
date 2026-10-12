import { LogOut, Trash2, UserPlus, X } from 'lucide-react'
import { useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { mutate } from 'swr'

import { farmMembersKey, farmsKey, useFarmMembers } from '@/api/hooks'
import { addFarmMember, removeFarmMember } from '@/api/mutations'
import type { Farm } from '@/api/types'
import { useAuth } from '@/auth/context'
import { ConfirmDeleteDialog } from '@/components/farm/ConfirmDeleteDialog'
import { DeleteFarmDialog } from '@/components/farm/DeleteFarmDialog'
import { useToast } from '@/components/toast'
import { TruncatedTooltip } from '@/components/ui/app-tooltip'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { FieldError } from '@/components/ui/field-error'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { LoadError } from '@/components/ui/load-error'
import { Spinner } from '@/components/ui/spinner'
import { validateEmail } from '@/lib/auth-form'
import { describeLeaveFarm, otherMemberEmails } from '@/lib/farm-access'
import { formatCvr } from '@/lib/farm-form'
import { HOME_OVERVIEW_STATE } from '@/lib/onboarding'
import { cn } from '@/lib/utils'

const CARD_TITLE_CLASS = 'text-[15px] font-semibold'

const ROW_ACTION_CLASS =
  'shrink-0 gap-1.5 text-muted-foreground hover:text-destructive'

type FarmAboutPageProps = {
  farm: Farm
}

export const FarmAboutPage = ({ farm }: FarmAboutPageProps) => {
  const navigate = useNavigate()
  const { user } = useAuth()
  const { showToast } = useToast()
  const {
    data: members = [],
    error: membersError,
    isLoading: membersLoading,
    isValidating: membersValidating,
    mutate: retryMembers,
  } = useFarmMembers(farm.id)
  const [shareEmail, setShareEmail] = useState('')
  const [shareError, setShareError] = useState<string | null>(null)
  const [sharing, setSharing] = useState(false)
  const [removingEmail, setRemovingEmail] = useState<string | null>(null)
  const [removeError, setRemoveError] = useState<string | null>(null)
  const [leaveOpen, setLeaveOpen] = useState(false)
  const [deleteOpen, setDeleteOpen] = useState(false)
  const ownEmail = user?.email ?? ''
  const otherEmails = otherMemberEmails(members, ownEmail)
  const details = [
    { label: 'Bedriftens navn', value: farm.name },
    { label: 'Ejer', value: farm.ownerName },
    {
      label: 'CVR-nummer',
      value: farm.cvr ? formatCvr(farm.cvr) : 'Intet CVR',
    },
  ]

  const share = async (event: FormEvent) => {
    event.preventDefault()
    const email = shareEmail.trim().toLowerCase()
    if (validateEmail(email)) {
      setShareError('Skriv en e-mailadresse.')
      return
    }
    if (members.some((member) => member.email === email)) {
      setShareError('Har allerede adgang.')
      return
    }
    setSharing(true)
    setShareError(null)
    try {
      await addFarmMember(farm.id, email)
      await mutate(farmMembersKey(farm.id))
      setShareEmail('')
      showToast(`${email} har nu adgang til ${farm.name}`)
    } catch {
      setShareError(
        'Kunne ikke dele bedriften. Personen skal have en bekræftet konto i PlantPerform.',
      )
    } finally {
      setSharing(false)
    }
  }

  const removeMember = async (email: string) => {
    const leaving = email === ownEmail
    setRemovingEmail(email)
    setRemoveError(null)
    try {
      await removeFarmMember(farm.id, email)
      if (leaving) {
        await mutate(farmsKey)
        showToast(`Du har forladt ${farm.name}`)
        navigate('/', { state: HOME_OVERVIEW_STATE })
        return
      }
      await mutate(farmMembersKey(farm.id))
      showToast(`${email} har ikke længere adgang`)
    } catch {
      setRemoveError(
        leaving
          ? 'Kunne ikke forlade bedriften.'
          : `Kunne ikke fjerne ${email}.`,
      )
    } finally {
      setRemovingEmail(null)
    }
  }

  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <div className="max-w-[760px] px-6 pt-9 pb-15 sm:px-10">
        <h1 className="font-display text-4xl tracking-tight break-words">
          {farm.name}
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Navn, ejer, CVR og hvem der har adgang.
        </p>

        <Card className="mt-6" role="region" aria-labelledby="about-info">
          <h2
            id="about-info"
            className={cn(CARD_TITLE_CLASS, 'border-b px-6 py-4')}
          >
            Oplysninger
          </h2>
          <dl className="grid gap-x-4 gap-y-5 px-6 pt-5 pb-6 sm:grid-cols-2">
            {details.map(({ label, value }) => (
              <div key={label}>
                <dt className="text-[13px] text-muted-foreground">{label}</dt>
                <dd className="mt-1 text-[15px] break-words tabular-nums">
                  {value}
                </dd>
              </div>
            ))}
          </dl>
        </Card>

        <Card
          className="mt-4 overflow-hidden"
          role="region"
          aria-labelledby="about-access"
        >
          <div className="border-b px-6 py-4">
            <h2 id="about-access" className={CARD_TITLE_CLASS}>
              Adgang
            </h2>
            <p className="mt-1 text-[13px] text-muted-foreground">
              Alle med adgang kan det samme: se marker, oprette simuleringer og
              dele bedriften videre.
            </p>
          </div>
          {membersLoading ? (
            <p className="flex items-center gap-2 border-b px-6 py-4 text-sm text-muted-foreground">
              <Spinner />
              Henter, hvem der har adgang...
            </p>
          ) : membersError ? (
            <div className="border-b px-6 py-4">
              <LoadError
                message="Kunne ikke hente, hvem der har adgang."
                onRetry={() => void retryMembers()}
                retrying={membersValidating}
              />
            </div>
          ) : (
            <ul>
              {members.map((member) => {
                const isSelf = member.email === ownEmail
                const removing = removingEmail === member.email
                return (
                  <li
                    key={member.email}
                    className="flex items-center gap-3.5 border-b border-border/60 px-6 py-3"
                  >
                    <span className="flex min-w-0 flex-1 items-center gap-2 text-[15px]">
                      <TruncatedTooltip
                        content={member.email}
                        className="truncate"
                      >
                        {member.email}
                      </TruncatedTooltip>
                      {isSelf ? (
                        <span className="shrink-0 text-[13px] text-muted-foreground">
                          (dig)
                        </span>
                      ) : null}
                    </span>
                    {isSelf ? (
                      members.length > 1 ? (
                        <Button
                          variant="ghost"
                          size="sm"
                          className={ROW_ACTION_CLASS}
                          loading={removing}
                          onClick={() => setLeaveOpen(true)}
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
                        onClick={() => void removeMember(member.email)}
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
          <form
            className="bg-background/50 px-6 pt-[18px] pb-5"
            onSubmit={(event) => void share(event)}
            noValidate
          >
            <Label
              htmlFor="share-farm-email"
              className="text-[13px] font-normal"
            >
              Del med
            </Label>
            <div className="mt-1.5 flex gap-2.5">
              <Input
                id="share-farm-email"
                type="email"
                autoComplete="off"
                placeholder="navn@eksempel.dk"
                value={shareEmail}
                aria-invalid={shareError ? true : undefined}
                aria-describedby="share-farm-help share-farm-error"
                className="min-w-0 flex-1 bg-card"
                onChange={(event) => {
                  setShareEmail(event.target.value)
                  setShareError(null)
                }}
              />
              <Button type="submit" className="shrink-0" loading={sharing}>
                {sharing ? null : (
                  <UserPlus className="size-4" aria-hidden="true" />
                )}
                {sharing ? 'Deler...' : 'Del'}
              </Button>
            </div>
            <div className="mt-2">
              <FieldError id="share-farm-error" message={shareError} />
            </div>
            <p
              id="share-farm-help"
              className="mt-2 text-[13px] leading-normal text-muted-foreground"
            >
              Personen skal have en bekræftet konto i PlantPerform.
            </p>
          </form>
        </Card>

        <Card
          className="mt-4 flex flex-wrap items-center justify-between gap-x-6 gap-y-4 px-6 py-5"
          role="region"
          aria-labelledby="about-delete"
        >
          <div>
            <h2 id="about-delete" className={CARD_TITLE_CLASS}>
              Slet bedrift
            </h2>
            <p className="mt-1 max-w-[440px] text-[13px] leading-normal text-muted-foreground">
              Bedriften, alle dens marker og alle simuleringer slettes for alle,
              der har adgang.
            </p>
          </div>
          <Button
            variant="outline"
            className="shrink-0 border-destructive text-destructive hover:bg-destructive/10 hover:text-destructive"
            onClick={() => setDeleteOpen(true)}
          >
            <Trash2 className="size-4" aria-hidden="true" />
            Slet bedrift
          </Button>
        </Card>
      </div>

      <ConfirmDeleteDialog
        name={leaveOpen ? farm.name : null}
        title={`Forlad ${farm.name}?`}
        description={describeLeaveFarm(otherEmails)}
        confirmLabel="Forlad bedrift"
        onOpenChange={(open) => {
          if (!open) setLeaveOpen(false)
        }}
        onConfirm={() => void removeMember(ownEmail)}
      />
      <DeleteFarmDialog
        farm={farm}
        sharedWith={otherEmails}
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
      />
    </div>
  )
}
