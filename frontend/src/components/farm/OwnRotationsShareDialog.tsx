import { useState, type FormEvent } from 'react'
import { mutate } from 'swr'

import { addMember } from '@/api/members'
import { rotationDefinitionMembersPath } from '@/api/own-rotations'
import type { MembershipRole, RotationDefinition } from '@/api/types'
import { ShareByEmailForm } from '@/components/farm/MemberAccess'
import { useRotationSharedWith } from '@/components/farm/own-rotations-state'
import { useToast } from '@/components/toast'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { formatCount, formatNameList } from '@/lib/economics'
import {
  DEFAULT_SHARE_ROLE,
  describeFarmAccess,
  notShared,
  shareEmailError,
} from '@/lib/farm-access'

const SharedWithNote = ({ definitionId }: { definitionId: string }) => {
  const others = useRotationSharedWith(definitionId)
  return others ? (
    <span className="shrink-0 text-[13px] text-muted-foreground">
      {describeFarmAccess(others)}
    </span>
  ) : null
}

type OwnRotationsShareDialogProps = {
  definitions: RotationDefinition[]
  open: boolean
  onOpenChange: (open: boolean) => void
  onShared: () => void
}

export const OwnRotationsShareDialog = ({
  definitions,
  open,
  onOpenChange,
  onShared,
}: OwnRotationsShareDialogProps) => {
  const { showToast } = useToast()
  const [email, setEmail] = useState('')
  const [role, setRole] = useState<MembershipRole>(DEFAULT_SHARE_ROLE)
  const [error, setError] = useState<string | null>(null)
  const [sharing, setSharing] = useState(false)
  const count = formatCount(definitions.length, 'sædskifte', 'sædskifter')

  const share = async (event: FormEvent) => {
    event.preventDefault()
    const address = email.trim().toLowerCase()
    const invalid = shareEmailError(address, [])
    setError(invalid)
    if (invalid) return
    setSharing(true)
    const paths = definitions.map((definition) =>
      rotationDefinitionMembersPath(definition.id),
    )
    const results = await Promise.allSettled(
      paths.map((path) => addMember(path, address, role)),
    )
    await Promise.all(paths.map((path) => mutate(path)))
    setSharing(false)
    const failed = notShared(definitions, results)
    if (failed.length === definitions.length) {
      setError(
        'Kunne ikke dele sædskifterne. Personen skal have en bekræftet konto i PlantPerform.',
      )
      return
    }
    if (failed.length > 0) {
      setError(
        `Kunne ikke dele ${formatNameList(failed.map((definition) => definition.name))}. Prøv igen.`,
      )
      return
    }
    showToast(`${count} er delt med ${address}`)
    setEmail('')
    onShared()
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) setError(null)
        onOpenChange(next)
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Del {count}</DialogTitle>
          <DialogDescription>
            Læsere kan se sædskifterne, vælge dem i simuleringer på deres egne
            bedrifter og lave en kopi. Redaktører kan også rette, dele og slette
            dem.
          </DialogDescription>
        </DialogHeader>
        <div className="-mx-6 border-t">
          <ul className="max-h-48 space-y-1 overflow-y-auto px-6 py-3 text-sm">
            {definitions.map((definition) => (
              <li
                key={definition.id}
                className="flex items-baseline justify-between gap-3"
              >
                <span className="truncate">{definition.name}</span>
                <SharedWithNote definitionId={definition.id} />
              </li>
            ))}
          </ul>
          <ShareByEmailForm
            email={email}
            role={role}
            error={error}
            sharing={sharing}
            className="border-t pb-0"
            onEmailChange={(value) => {
              setEmail(value)
              setError(null)
            }}
            onRoleChange={setRole}
            onSubmit={(event) => void share(event)}
          />
        </div>
      </DialogContent>
    </Dialog>
  )
}
