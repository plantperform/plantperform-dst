import { readItem, writeItem } from '@/lib/browser-storage'

export type UserName = {
  firstName: string
  lastName: string
}

export const EMPTY_USER_NAME: UserName = { firstName: '', lastName: '' }

export const USER_NAME_CHANGED_EVENT = 'user-name:changed'

const USER_NAME_ERROR = 'Skriv både fornavn og efternavn.'

const storageKey = (email: string) => `plantperform.userName.${email}`

export const normalizeUserName = ({
  firstName,
  lastName,
}: UserName): UserName => ({
  firstName: firstName.trim(),
  lastName: lastName.trim(),
})

export const validateUserName = (name: UserName): string | null => {
  const { firstName, lastName } = normalizeUserName(name)
  return firstName && lastName ? null : USER_NAME_ERROR
}

export const formatFullName = (name: UserName) =>
  `${name.firstName} ${name.lastName}`.trim()

export const userInitials = (name: UserName | null, email: string) =>
  (name
    ? name.firstName.charAt(0) + name.lastName.charAt(0)
    : email.charAt(0)
  ).toUpperCase()

export const welcomeGreeting = (name: UserName | null) =>
  name ? `Velkommen, ${name.firstName}` : 'Velkommen'

export const parseStoredUserName = (raw: string | null): UserName | null => {
  if (!raw) return null
  try {
    const parsed: unknown = JSON.parse(raw)
    if (typeof parsed !== 'object' || parsed === null) return null
    const { firstName, lastName } = parsed as Record<string, unknown>
    if (typeof firstName !== 'string' || typeof lastName !== 'string') {
      return null
    }
    const name = normalizeUserName({ firstName, lastName })
    return validateUserName(name) ? null : name
  } catch {
    return null
  }
}

export const readStoredUserName = (email: string): string | null =>
  readItem(storageKey(email))

export const storeUserName = (email: string, name: UserName): boolean => {
  const stored = writeItem(
    storageKey(email),
    JSON.stringify(normalizeUserName(name)),
  )
  if (stored) window.dispatchEvent(new Event(USER_NAME_CHANGED_EVENT))
  return stored
}
