import { useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'

import { ApiError, postJson } from '@/api/client'
import { useAuth } from '@/auth/context'
import { useAuthFields } from '@/components/onboarding/auth-fields'
import { AuthFields } from '@/components/onboarding/AuthFields'
import { AuthNotice } from '@/components/onboarding/AuthNotice'
import { Button } from '@/components/ui/button'
import {
  LOGIN_FAILURE_MESSAGES,
  loginFailure,
  type LoginFailure,
} from '@/lib/auth-form'
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
  const [failure, setFailure] = useState<LoginFailure | null>(null)
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
    setFailure(null)
    setResendState('idle')
    if (!fields.validate()) return
    const email = fields.normalizedEmail
    setIsSubmitting(true)
    try {
      await signIn({ email, password: fields.password })
      clearHomeVisitedThisSession(email)
      onSignedIn(email)
    } catch (requestError) {
      setFailure(
        requestError instanceof ApiError
          ? loginFailure(requestError.status, requestError.message)
          : 'unavailable',
      )
    }
    setIsSubmitting(false)
  }

  return (
    <form className="space-y-6" noValidate onSubmit={onSubmit}>
      <AuthFields
        fields={fields}
        passwordAutoComplete="current-password"
        autoFocus={
          autoFocusPassword ? 'password' : initialEmail ? 'none' : 'email'
        }
        rejected={failure === 'credentials'}
      />
      {failure ? (
        <AuthNotice tone="error">{LOGIN_FAILURE_MESSAGES[failure]}</AuthNotice>
      ) : null}
      <div className="space-y-3">
        {failure === 'unverified' ? (
          <Button
            type="button"
            size="lg"
            variant="outline"
            className="w-full"
            disabled={resendState === 'sent'}
            loading={resendState === 'sending'}
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
        <Button size="lg" className="w-full" loading={isSubmitting}>
          {isSubmitting ? 'Logger ind...' : 'Log ind'}
        </Button>
        <Button asChild variant="ghost" className="w-full">
          <Link to="/forgot-password" state={{ email: fields.normalizedEmail }}>
            Glemt adgangskode?
          </Link>
        </Button>
      </div>
    </form>
  )
}
