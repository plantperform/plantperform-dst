import { createContext, useContext } from 'react'

import { useFarmMembers } from '@/api/hooks'
import { useAuth } from '@/auth/context'
import { ownRole } from '@/lib/farm-access'

export const FarmReadOnlyContext = createContext(false)

export const useFarmReadOnly = () => useContext(FarmReadOnlyContext)

export const useOwnFarmRole = (farmId: string | undefined) => {
  const { user } = useAuth()
  const { data: members } = useFarmMembers(farmId)
  return ownRole(members ?? [], user?.email ?? '')
}
