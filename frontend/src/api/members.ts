import useSWR from 'swr'

import { deleteJson, fetcher, patchJson, postJson } from '@/api/client'
import type { FarmMember, MembershipRole } from '@/api/types'

export const useMembers = (membersPath: string) =>
  useSWR<FarmMember[]>(membersPath, fetcher)

export const addMember = (
  membersPath: string,
  email: string,
  role: MembershipRole,
) => postJson<FarmMember, FarmMember>(membersPath, { email, role })

const memberPath = (membersPath: string, email: string) =>
  `${membersPath}/${encodeURIComponent(email)}`

export const changeMemberRole = (
  membersPath: string,
  email: string,
  role: MembershipRole,
) =>
  patchJson<FarmMember, { role: MembershipRole }>(
    memberPath(membersPath, email),
    { role },
  )

export const removeMember = (membersPath: string, email: string) =>
  deleteJson(memberPath(membersPath, email))
