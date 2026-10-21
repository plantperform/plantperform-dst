import { useState } from 'react'

import { readItem, writeItem } from '@/lib/browser-storage'

export const useStoredFlag = (key: string) => {
  const [flag, setFlag] = useState(() => readItem(key) === 'true')

  const changeFlag = (next: boolean) => {
    setFlag(next)
    writeItem(key, String(next))
  }

  return [flag, changeFlag] as const
}
