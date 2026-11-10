import useSWR from 'swr'

import { deleteJson, fetcher, postJson } from '@/api/client'
import type { FarmMember } from '@/api/types'

export const useMembers = (membersPath: string) =>
  useSWR<FarmMember[]>(membersPath, fetcher)

export const addMember = (membersPath: string, email: string) =>
  postJson<FarmMember, { email: string }>(membersPath, { email })

export const removeMember = (membersPath: string, email: string) =>
  deleteJson(`${membersPath}/${encodeURIComponent(email)}`)
