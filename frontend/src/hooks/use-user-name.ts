import { useCallback, useMemo, useSyncExternalStore } from 'react'

import { useAuth } from '@/auth/context'
import {
  parseStoredUserName,
  readStoredUserName,
  storeUserName,
  USER_NAME_CHANGED_EVENT,
  type UserName,
} from '@/lib/user-name'

const subscribe = (onChange: () => void) => {
  window.addEventListener(USER_NAME_CHANGED_EVENT, onChange)
  window.addEventListener('storage', onChange)
  return () => {
    window.removeEventListener(USER_NAME_CHANGED_EVENT, onChange)
    window.removeEventListener('storage', onChange)
  }
}

export const useUserName = () => {
  const email = useAuth().user?.email ?? ''
  const stored = useSyncExternalStore(subscribe, () =>
    readStoredUserName(email),
  )
  const name = useMemo(() => parseStoredUserName(stored), [stored])
  const saveName = useCallback(
    (next: UserName) => storeUserName(email, next),
    [email],
  )

  return { name, saveName }
}
