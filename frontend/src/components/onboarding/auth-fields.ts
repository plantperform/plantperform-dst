import { useState } from 'react'

import {
  validateEmail,
  validatePassword,
  type PasswordPurpose,
} from '@/lib/auth-form'

export const EMAIL_FIELD_ID = 'email'
export const PASSWORD_FIELD_ID = 'password'

type FieldErrors = {
  email: string | null
  password: string | null
}

const focusField = (id: string) => document.getElementById(id)?.focus()

export const useAuthFields = (purpose: PasswordPurpose, initialEmail = '') => {
  const [email, setEmail] = useState(initialEmail)
  const [password, setPassword] = useState('')
  const [errors, setErrors] = useState<FieldErrors>({
    email: null,
    password: null,
  })

  const setEmailError = (message: string | null) =>
    setErrors((current) => ({ ...current, email: message }))
  const setPasswordError = (message: string | null) =>
    setErrors((current) => ({ ...current, password: message }))

  const changeEmail = (value: string) => {
    setEmail(value)
    if (errors.email) setEmailError(validateEmail(value))
  }

  const changePassword = (value: string) => {
    setPassword(value)
    if (errors.password) setPasswordError(validatePassword(value, purpose))
  }

  const blurEmail = () => {
    if (email.trim()) setEmailError(validateEmail(email))
  }

  const blurPassword = () => {
    if (password) setPasswordError(validatePassword(password, purpose))
  }

  const rejectEmail = (message: string) => {
    setEmailError(message)
    focusField(EMAIL_FIELD_ID)
  }

  const validate = () => {
    const next = {
      email: validateEmail(email),
      password: validatePassword(password, purpose),
    }
    setErrors(next)
    if (!next.email && !next.password) return true
    focusField(next.email ? EMAIL_FIELD_ID : PASSWORD_FIELD_ID)
    return false
  }

  return {
    email,
    normalizedEmail: email.trim().toLowerCase(),
    password,
    errors,
    changeEmail,
    changePassword,
    blurEmail,
    blurPassword,
    rejectEmail,
    validate,
  }
}

export type AuthFieldsState = ReturnType<typeof useAuthFields>
