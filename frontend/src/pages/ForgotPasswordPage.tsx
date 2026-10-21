import { useState, type FormEvent } from 'react'
import { useLocation } from 'react-router-dom'
import { Mail, MailCheck } from 'lucide-react'

import { postJson } from '@/api/client'
import { AuthIcon, AuthLayout } from '@/components/onboarding/AuthLayout'
import { AuthNotice } from '@/components/onboarding/AuthNotice'
import { BackToLogin } from '@/components/onboarding/BackToLogin'
import { EmailField } from '@/components/onboarding/EmailField'
import { Button } from '@/components/ui/button'
import { validateEmail } from '@/lib/auth-form'

export const ForgotPasswordPage = () => {
  const location = useLocation()
  const [email, setEmail] = useState(
    (location.state as { email?: string } | null)?.email ?? '',
  )
  const [emailError, setEmailError] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [sentTo, setSentTo] = useState<string | null>(null)

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault()
    if (isSubmitting) return
    const nextError = validateEmail(email)
    setEmailError(nextError)
    setError(null)
    if (nextError) {
      document.getElementById('reset-email')?.focus()
      return
    }
    const address = email.trim().toLowerCase()
    setIsSubmitting(true)
    try {
      await postJson<{ message: string }, { email: string }>(
        '/auth/password/forgot',
        { email: address },
      )
      setSentTo(address)
    } catch {
      setError('Kunne ikke sende mailen lige nu. Prøv igen om lidt.')
    }
    setIsSubmitting(false)
  }

  return (
    <AuthLayout
      icon={<AuthIcon icon={sentTo ? MailCheck : Mail} />}
      title={sentTo ? 'Tjek din e-mail' : 'Glemt adgangskode?'}
      description={
        sentTo ? (
          <>
            Hvis der findes en konto med{' '}
            <strong className="font-medium text-foreground">{sentTo}</strong>,
            har vi sendt et link til at vælge en ny adgangskode.
          </>
        ) : (
          'Skriv den e-mail, du oprettede kontoen med, så sender vi et link til en ny adgangskode.'
        )
      }
      footer={<BackToLogin />}
    >
      {sentTo ? (
        <div className="space-y-6" role="status">
          <p className="text-sm text-muted-foreground">
            Linket virker i 1 time og kan kun bruges én gang. Kig i spam, hvis
            mailen ikke dukker op inden for et par minutter. Vent mindst et
            minut, før du beder om en ny mail.
          </p>
          <Button
            type="button"
            variant="outline"
            className="w-full"
            onClick={() => setSentTo(null)}
          >
            Send et nyt link
          </Button>
        </div>
      ) : (
        <form className="space-y-6" noValidate onSubmit={onSubmit}>
          <EmailField
            id="reset-email"
            value={email}
            error={emailError}
            autoFocus
            onChange={(value) => {
              setEmail(value)
              if (emailError) setEmailError(validateEmail(value))
            }}
            onBlur={() => {
              if (email.trim()) setEmailError(validateEmail(email))
            }}
          />
          {error ? <AuthNotice tone="error">{error}</AuthNotice> : null}
          <Button size="lg" className="w-full" loading={isSubmitting}>
            {isSubmitting ? 'Sender...' : 'Send link til ny adgangskode'}
          </Button>
        </form>
      )}
    </AuthLayout>
  )
}
