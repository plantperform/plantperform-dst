import { useState, type FormEvent } from 'react'

import { ApiError, postJson } from '@/api/client'
import { useAuth } from '@/auth/context'
import { useAuthFields } from '@/components/onboarding/auth-fields'
import { AuthFields } from '@/components/onboarding/AuthFields'
import { AuthNotice } from '@/components/onboarding/AuthNotice'
import { Button } from '@/components/ui/button'
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
  const fields = useAuthFields('login', initialEmail)
  const [error, setError] = useState<string | null>(null)
  const [unverified, setUnverified] = useState(false)
  const [resendState, setResendState] = useState<ResendState>('idle')
  const [isSubmitting, setIsSubmitting] = useState(false)

  const resendVerification = async () => {
    setResendState('sending')
    try {
      await postJson<{ message: string }, { email: string }>(
        '/auth/verification/resend',
        { email: fields.normalizedEmail },
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
    if (!fields.validate()) return
    const email = fields.normalizedEmail
    setIsSubmitting(true)
    try {
      await signIn({ email, password: fields.password })
      clearHomeVisitedThisSession(email)
      onSignedIn(email)
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
    <form className="space-y-6" noValidate onSubmit={onSubmit}>
      <AuthFields
        fields={fields}
        passwordAutoComplete="current-password"
        autoFocus={
          autoFocusPassword ? 'password' : initialEmail ? 'none' : 'email'
        }
        rejected={credentialsRejected}
      />
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
