import { useState } from 'react'

import type { FarmMember, MembershipRole } from '@/api/types'
import {
  canLeave,
  DEFAULT_SHARE_ROLE,
  ownRole,
  shareEmailError,
} from '@/lib/farm-access'

type MemberAccessOptions = {
  name: string
  members: FarmMember[]
  ownEmail: string
  removeMember: (email: string) => Promise<unknown>
  changeRole: (email: string, role: MembershipRole) => Promise<unknown>
  onRemoved: (email: string) => Promise<unknown>
  onRoleChanged: () => Promise<unknown>
  onLeft: () => Promise<unknown>
  leaveFailure: string
}

export const useMemberAccess = ({
  name,
  members,
  ownEmail,
  removeMember,
  changeRole,
  onRemoved,
  onRoleChanged,
  onLeft,
  leaveFailure,
}: MemberAccessOptions) => {
  const [email, setEmail] = useState('')
  const [role, setRole] = useState<MembershipRole>(DEFAULT_SHARE_ROLE)
  const [shareError, setShareError] = useState<string | null>(null)
  const [sharing, setSharing] = useState(false)
  const [removingEmail, setRemovingEmail] = useState<string | null>(null)
  const [changingEmail, setChangingEmail] = useState<string | null>(null)
  const [memberError, setMemberError] = useState<string | null>(null)
  const [leaveOpen, setLeaveOpen] = useState(false)
  const canManage = ownRole(members, ownEmail) === 'editor'

  const remove = async (address: string) => {
    const leaving = address === ownEmail
    const afterRemoval = leaving ? onLeft : () => onRemoved(address)
    setRemovingEmail(address)
    setMemberError(null)
    try {
      await removeMember(address)
      await afterRemoval()
    } catch {
      setMemberError(leaving ? leaveFailure : `Kunne ikke fjerne ${address}.`)
    }
    setRemovingEmail(null)
  }

  const changeMemberRole = async (address: string, next: MembershipRole) => {
    setChangingEmail(address)
    setMemberError(null)
    try {
      await changeRole(address, next)
      await onRoleChanged()
    } catch {
      setMemberError(`Kunne ikke ændre rollen for ${address}.`)
    }
    setChangingEmail(null)
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
      }
      setSharing(false)
    },
    form: {
      email,
      role,
      error: shareError,
      sharing,
      onEmailChange: (address: string) => {
        setEmail(address)
        setShareError(null)
      },
      onRoleChange: setRole,
    },
    list: {
      members,
      ownEmail,
      canManage,
      canLeave: canLeave(members, ownEmail),
      removingEmail,
      changingEmail,
      memberError,
      onRemove: (address: string) => void remove(address),
      onChangeRole: (address: string, next: MembershipRole) =>
        void changeMemberRole(address, next),
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
