import { useState } from 'react'

import {
  EMPTY_USER_NAME,
  normalizeUserName,
  validateUserName,
  type UserName,
} from '@/lib/user-name'

export const FIRST_NAME_FIELD_ID = 'first-name'
export const LAST_NAME_FIELD_ID = 'last-name'

export const useNameFields = (initial: UserName | null) => {
  const [name, setName] = useState(initial ?? EMPTY_USER_NAME)
  const [checked, setChecked] = useState(false)

  const validate = (): UserName | null => {
    const normalized = normalizeUserName(name)
    if (!validateUserName(normalized)) return normalized
    setChecked(true)
    document
      .getElementById(
        normalized.firstName ? LAST_NAME_FIELD_ID : FIRST_NAME_FIELD_ID,
      )
      ?.focus()
    return null
  }

  return {
    name,
    error: checked ? validateUserName(name) : null,
    setName,
    validate,
  }
}

export type NameFieldsState = ReturnType<typeof useNameFields>
