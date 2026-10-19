import { useState } from 'react'

import type { FarmMember } from '@/api/types'
import { shareEmailError } from '@/lib/farm-access'

type MemberAccessOptions = {
  name: string
  members: FarmMember[]
  ownEmail: string
  removeMember: (email: string) => Promise<unknown>
  onRemoved: (email: string) => Promise<unknown>
  onLeft: () => Promise<unknown>
  leaveFailure: string
}

export const useMemberAccess = ({
  name,
  members,
  ownEmail,
  removeMember,
  onRemoved,
  onLeft,
  leaveFailure,
}: MemberAccessOptions) => {
  const [email, setEmail] = useState('')
  const [shareError, setShareError] = useState<string | null>(null)
  const [sharing, setSharing] = useState(false)
  const [removingEmail, setRemovingEmail] = useState<string | null>(null)
  const [removeError, setRemoveError] = useState<string | null>(null)
  const [leaveOpen, setLeaveOpen] = useState(false)

  const remove = async (address: string) => {
    const leaving = address === ownEmail
    setRemovingEmail(address)
    setRemoveError(null)
    try {
      await removeMember(address)
      await (leaving ? onLeft() : onRemoved(address))
    } catch {
      setRemoveError(leaving ? leaveFailure : `Kunne ikke fjerne ${address}.`)
    } finally {
      setRemovingEmail(null)
    }
  }

  return {
    validEmail: () => {
      const address = email.trim().toLowerCase()
      const error = shareEmailError(address, members)
      setShareError(error)
      return error ? null : address
    },
    share: async (
      run: () => Promise<void>,
      failure: (error: unknown) => string,
    ) => {
      setSharing(true)
      try {
        await run()
        setEmail('')
      } catch (error) {
        setShareError(failure(error))
      } finally {
        setSharing(false)
      }
    },
    form: {
      email,
      error: shareError,
      sharing,
      onEmailChange: (address: string) => {
        setEmail(address)
        setShareError(null)
      },
    },
    list: {
      members,
      ownEmail,
      removingEmail,
      removeError,
      onRemove: (address: string) => void remove(address),
      onLeave: () => setLeaveOpen(true),
    },
    leave: {
      name: leaveOpen ? name : null,
      title: `Forlad ${name}?`,
      onOpenChange: (open: boolean) => {
        if (!open) setLeaveOpen(false)
      },
      onConfirm: () => void remove(ownEmail),
    },
  }
}
