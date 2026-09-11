import { useEffect, useRef, useState, type FormEvent } from 'react'
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router-dom'
import { CircleAlert, CircleCheck, LoaderCircle, Mail, MailOpen } from 'lucide-react'

import { postJson } from '@/api/client'
import { AuthIcon, AuthLayout } from '@/components/onboarding/AuthLayout'
import { AuthNotice } from '@/components/onboarding/AuthNotice'
import { LoginForm } from '@/components/onboarding/LoginForm'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  clearLastRegisteredEmail,
  getLastRegisteredEmail,
} from '@/lib/onboarding'

type VerifyState = 'idle' | 'verifying' | 'verified' | 'invalid'
type ResendState = 'idle' | 'sending' | 'sent' | 'failed'

const resendVerification = (email: string) =>
  postJson<{ message: string }, { email: string }>(
    '/auth/verification/resend',
    { email: email.trim().toLowerCase() },
  )

const BackToLogin = () => (
  <p>
    <Link
      className="font-medium text-foreground underline underline-offset-4"
      to="/login"
    >
      Tilbage til login
    </Link>
  </p>
)

type ResendNoticeProps = {
  state: ResendState
  sentText: string
}

const ResendNotice = ({ state, sentText }: ResendNoticeProps) => {
  if (state === 'sent') return <AuthNotice tone="success">{sentText}</AuthNotice>
  if (state === 'failed') {
    return (
      <AuthNotice tone="error">
        Kunne ikke sende en ny bekræftelsesmail. Prøv igen om lidt.
      </AuthNotice>
    )
  }
  return null
}

export const VerifyEmailPage = () => {
  const [searchParams] = useSearchParams()
  const location = useLocation()
  const navigate = useNavigate()
  const token = searchParams.get('token')
  const sentTo =
    (location.state as { sentTo?: string } | null)?.sentTo ?? null
  const [verifyState, setVerifyState] = useState<VerifyState>(
    token ? 'verifying' : 'idle',
  )
  const attemptedToken = useRef<string | null>(null)
  const [rememberedEmail] = useState(() => getLastRegisteredEmail() ?? '')
  const [email, setEmail] = useState(sentTo ?? rememberedEmail)
  const [resendState, setResendState] = useState<ResendState>('idle')

  useEffect(() => {
    if (!token || attemptedToken.current === token) return
    attemptedToken.current = token
    postJson<{ message: string }, { token: string }>('/auth/verify', { token })
      .then(() => setVerifyState('verified'))
      .catch(() => setVerifyState('invalid'))
  }, [token])

  const resend = async (event: FormEvent) => {
    event.preventDefault()
    if (!email.trim()) return
    setResendState('sending')
    try {
      await resendVerification(email)
      setResendState('sent')
    } catch {
      setResendState('failed')
    }
  }

  const resendForm = (
    <form className="space-y-3" onSubmit={resend}>
      <Label htmlFor="verification-email">E-mail</Label>
      <Input
        id="verification-email"
        type="email"
        autoComplete="email"
        className="h-11"
        value={email}
        onChange={(event) => setEmail(event.target.value)}
      />
      <Button
        size="lg"
        variant="outline"
        className="w-full"
        disabled={resendState === 'sending'}
      >
        {resendState === 'sending' ? 'Sender...' : 'Send ny bekræftelsesmail'}
      </Button>
      <ResendNotice
        state={resendState}
        sentText="Hvis adressen mangler bekræftelse, har vi sendt en ny mail."
      />
    </form>
  )

  if (verifyState === 'verifying') {
    return (
      <AuthLayout
        icon={<AuthIcon icon={LoaderCircle} spin />}
        title="Bekræfter din e-mail"
        description="Et øjeblik, vi tjekker linket fra mailen."
      >
        <p className="text-sm text-muted-foreground">
          Det tager normalt under et sekund.
        </p>
      </AuthLayout>
    )
  }

  if (verifyState === 'verified') {
    return (
      <AuthLayout
        icon={<AuthIcon icon={CircleCheck} />}
        title="Du er klar"
        description={
          rememberedEmail
            ? `${rememberedEmail} er bekræftet. Skriv din adgangskode, så er du inde.`
            : 'Din e-mail er bekræftet. Log ind, så er du inde.'
        }
      >
        <LoginForm
          initialEmail={rememberedEmail}
          autoFocusPassword={Boolean(rememberedEmail)}
          onSignedIn={() => {
            clearLastRegisteredEmail()
            navigate('/')
          }}
        />
      </AuthLayout>
    )
  }

  if (verifyState === 'invalid') {
    return (
      <AuthLayout
        icon={<AuthIcon icon={CircleAlert} tone="danger" />}
        title="Linket virker ikke længere"
        description="Det er enten brugt allerede eller ældre end 24 timer. Skriv din e-mail, så sender vi et nyt."
        footer={<BackToLogin />}
      >
        {resendForm}
      </AuthLayout>
    )
  }

  if (sentTo) {
    return (
      <AuthLayout
        icon={<AuthIcon icon={MailOpen} />}
        title="Tjek din e-mail"
        description={`Vi har sendt et link til ${sentTo}.`}
        footer={<BackToLogin />}
      >
        <div className="space-y-6">
          <p className="text-sm text-muted-foreground">
            Klik på linket i mailen, så er din konto klar. Linket virker i 24
            timer. Kig i spam, hvis mailen ikke dukker op inden for et par
            minutter.
          </p>
          <form className="space-y-3" onSubmit={resend}>
            <Button
              size="lg"
              variant="outline"
              className="w-full"
              disabled={resendState === 'sending'}
            >
              {resendState === 'sending' ? 'Sender...' : 'Send mailen igen'}
            </Button>
            <ResendNotice
              state={resendState}
              sentText={`Vi har sendt mailen igen til ${sentTo}.`}
            />
          </form>
        </div>
      </AuthLayout>
    )
  }

  return (
    <AuthLayout
      icon={<AuthIcon icon={Mail} />}
      title="Send bekræftelsesmail igen"
      description="Skriv den e-mail, du oprettede kontoen med, så sender vi et nyt link."
      footer={<BackToLogin />}
    >
      {resendForm}
    </AuthLayout>
  )
}
