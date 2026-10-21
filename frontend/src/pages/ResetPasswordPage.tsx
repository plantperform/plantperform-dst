import { useState, type FormEvent } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { CircleAlert, CircleCheck, KeyRound } from 'lucide-react'

import { setAccessToken } from '@/api/auth'
import { ApiError, postJson } from '@/api/client'
import { AuthIcon, AuthLayout } from '@/components/onboarding/AuthLayout'
import { AuthNotice } from '@/components/onboarding/AuthNotice'
import { BackToLogin } from '@/components/onboarding/BackToLogin'
import { PasswordInput } from '@/components/onboarding/PasswordInput'
import { Button } from '@/components/ui/button'
import { FieldError } from '@/components/ui/field-error'
import { Label } from '@/components/ui/label'
import {
  PASSWORD_MIN_LENGTH,
  isWellFormedResetToken,
  validatePassword,
  validatePasswordConfirmation,
} from '@/lib/auth-form'

const ResetPasswordForm = ({ token }: { token: string }) => {
  const [password, setPassword] = useState('')
  const [confirmation, setConfirmation] = useState('')
  const [passwordError, setPasswordError] = useState<string | null>(null)
  const [confirmationError, setConfirmationError] = useState<string | null>(
    null,
  )
  const [error, setError] = useState<string | null>(null)
  const [invalidToken, setInvalidToken] = useState(
    !isWellFormedResetToken(token),
  )
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [completed, setCompleted] = useState(false)

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault()
    if (isSubmitting) return
    const nextPasswordError = validatePassword(password, 'reset')
    const nextConfirmationError = validatePasswordConfirmation(
      password,
      confirmation,
    )
    setPasswordError(nextPasswordError)
    setConfirmationError(nextConfirmationError)
    setError(null)
    if (nextPasswordError || nextConfirmationError) {
      document
        .getElementById(nextPasswordError ? 'new-password' : 'confirm-password')
        ?.focus()
      return
    }
    setIsSubmitting(true)
    try {
      await postJson<{ message: string }, { token: string; password: string }>(
        '/auth/password/reset',
        { token, password },
      )
      setAccessToken(null)
      window.dispatchEvent(new Event('auth:expired'))
      setPassword('')
      setConfirmation('')
      setCompleted(true)
    } catch (requestError) {
      if (requestError instanceof ApiError && requestError.status === 400) {
        setInvalidToken(true)
      } else {
        setError('Kunne ikke gemme adgangskoden lige nu. Prøv igen om lidt.')
      }
    }
    setIsSubmitting(false)
  }

  if (completed) {
    return (
      <AuthLayout
        icon={<AuthIcon icon={CircleCheck} />}
        title="Din adgangskode er ændret"
        description="Du kan nu logge ind med din nye adgangskode."
      >
        <Button asChild size="lg" className="w-full">
          <Link to="/login">Log ind</Link>
        </Button>
      </AuthLayout>
    )
  }

  if (invalidToken) {
    return (
      <AuthLayout
        icon={<AuthIcon icon={CircleAlert} tone="danger" />}
        title="Linket virker ikke længere"
        description="Linket mangler, er udløbet eller er allerede brugt. Bed om et nyt link for at ændre din adgangskode."
        footer={<BackToLogin />}
      >
        <Button asChild size="lg" className="w-full">
          <Link to="/forgot-password">Send et nyt link</Link>
        </Button>
      </AuthLayout>
    )
  }

  return (
    <AuthLayout
      icon={<AuthIcon icon={KeyRound} />}
      title="Vælg en ny adgangskode"
      description={`Din nye adgangskode skal være mindst ${PASSWORD_MIN_LENGTH} tegn.`}
      footer={<BackToLogin />}
    >
      <form className="space-y-6" noValidate onSubmit={onSubmit}>
        <div className="space-y-2">
          <Label htmlFor="new-password">Ny adgangskode</Label>
          <PasswordInput
            id="new-password"
            value={password}
            autoComplete="new-password"
            autoFocus
            invalid={Boolean(passwordError)}
            describedBy={passwordError ? 'new-password-error' : undefined}
            onChange={(value) => {
              setPassword(value)
              if (passwordError)
                setPasswordError(validatePassword(value, 'reset'))
              if (confirmationError) {
                setConfirmationError(
                  validatePasswordConfirmation(value, confirmation),
                )
              }
            }}
            onBlur={() => {
              if (password)
                setPasswordError(validatePassword(password, 'reset'))
            }}
          />
          <FieldError id="new-password-error" message={passwordError} />
        </div>
        <div className="space-y-2">
          <Label htmlFor="confirm-password">Gentag ny adgangskode</Label>
          <PasswordInput
            id="confirm-password"
            value={confirmation}
            autoComplete="new-password"
            invalid={Boolean(confirmationError)}
            describedBy={
              confirmationError ? 'confirm-password-error' : undefined
            }
            onChange={(value) => {
              setConfirmation(value)
              if (confirmationError) {
                setConfirmationError(
                  validatePasswordConfirmation(password, value),
                )
              }
            }}
            onBlur={() => {
              if (confirmation) {
                setConfirmationError(
                  validatePasswordConfirmation(password, confirmation),
                )
              }
            }}
          />
          <FieldError id="confirm-password-error" message={confirmationError} />
        </div>
        {error ? <AuthNotice tone="error">{error}</AuthNotice> : null}
        <Button size="lg" className="w-full" loading={isSubmitting}>
          {isSubmitting ? 'Gemmer...' : 'Gem ny adgangskode'}
        </Button>
      </form>
    </AuthLayout>
  )
}

export const ResetPasswordPage = () => {
  const { hash } = useLocation()
  const token = new URLSearchParams(hash.slice(1)).get('token') ?? ''
  return <ResetPasswordForm key={token} token={token} />
}
