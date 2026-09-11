import { useState, type FormEvent } from 'react'

import { ApiError, postJson } from '@/api/client'
import { useAuth } from '@/auth/context'
import { AuthNotice } from '@/components/onboarding/AuthNotice'
import { PasswordInput } from '@/components/onboarding/PasswordInput'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { clearHomeVisitedThisSession } from '@/lib/onboarding'

type ResendState = 'idle' | 'sending' | 'sent' | 'failed'

type LoginFormProps = {
  initialEmail?: string
  autoFocusPassword?: boolean
  onSignedIn: (email: string) => void
}

export const LoginForm = ({
  initialEmail = '',
  autoFocusPassword = false,
  onSignedIn,
}: LoginFormProps) => {
  const { signIn } = useAuth()
  const [email, setEmail] = useState(initialEmail)
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [unverified, setUnverified] = useState(false)
  const [resendState, setResendState] = useState<ResendState>('idle')
  const [isSubmitting, setIsSubmitting] = useState(false)

  const resendVerification = async () => {
    setResendState('sending')
    try {
      await postJson<{ message: string }, { email: string }>(
        '/auth/verification/resend',
        { email: email.trim().toLowerCase() },
      )
      setResendState('sent')
    } catch {
      setResendState('failed')
    }
  }

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault()
    setError(null)
    setUnverified(false)
    setResendState('idle')
    const normalizedEmail = email.trim().toLowerCase()
    if (!normalizedEmail.includes('@')) {
      setError('Indtast en gyldig e-mailadresse.')
      return
    }
    if (password.length < 6) {
      setError('Adgangskoden skal være mindst 6 tegn.')
      return
    }
    setIsSubmitting(true)
    try {
      await signIn({ email: normalizedEmail, password })
      clearHomeVisitedThisSession(normalizedEmail)
      onSignedIn(normalizedEmail)
    } catch (requestError) {
      const status =
        requestError instanceof ApiError ? requestError.status : null
      if (status === 403) {
        setUnverified(true)
        setError(
          'Din e-mail er ikke bekræftet endnu. Klik på linket i mailen, eller få den sendt igen.',
        )
      } else {
        setError('E-mail eller adgangskode er forkert.')
      }
    } finally {
      setIsSubmitting(false)
    }
  }

  const credentialsRejected = error !== null && !unverified

  return (
    <form className="space-y-6" onSubmit={onSubmit}>
      <div className="space-y-2">
        <Label htmlFor="email">E-mail</Label>
        <Input
          id="email"
          type="email"
          autoComplete="email"
          autoFocus={!autoFocusPassword && !initialEmail}
          aria-invalid={credentialsRejected || undefined}
          className="h-11 aria-invalid:border-red-600 aria-invalid:ring-1 aria-invalid:ring-red-600"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="password">Adgangskode</Label>
        <PasswordInput
          id="password"
          value={password}
          onChange={setPassword}
          autoComplete="current-password"
          autoFocus={autoFocusPassword}
          invalid={credentialsRejected}
        />
      </div>
      {error ? <AuthNotice tone="error">{error}</AuthNotice> : null}
      <div className="space-y-3">
        {unverified ? (
          <Button
            type="button"
            size="lg"
            variant="outline"
            className="w-full"
            disabled={resendState === 'sending' || resendState === 'sent'}
            onClick={() => void resendVerification()}
          >
            {resendState === 'sending'
              ? 'Sender...'
              : resendState === 'sent'
                ? 'Mailen er sendt igen'
                : 'Send bekræftelsesmailen igen'}
          </Button>
        ) : null}
        {resendState === 'sent' ? (
          <AuthNotice tone="success">
            Tjek din indbakke, og klik på linket. Så kan du logge ind.
          </AuthNotice>
        ) : null}
        {resendState === 'failed' ? (
          <AuthNotice tone="error">
            Kunne ikke sende mailen igen. Prøv om lidt.
          </AuthNotice>
        ) : null}
        <Button size="lg" className="w-full" disabled={isSubmitting}>
          {isSubmitting ? 'Logger ind...' : 'Log ind'}
        </Button>
      </div>
    </form>
  )
}
