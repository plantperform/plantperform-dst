import { useState, type FormEvent } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { CircleAlert, MailCheck } from 'lucide-react'

import { postJson } from '@/api/client'
import { AuthLayout } from '@/components/onboarding/AuthLayout'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

export const VerifyEmailPage = () => {
  const [searchParams] = useSearchParams()
  const [token, setToken] = useState(searchParams.get('token') ?? '')
  const [email, setEmail] = useState('')
  const [status, setStatus] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [isVerified, setIsVerified] = useState(false)

  const verify = async (value: string) => {
    if (!value) return
    setIsSubmitting(true)
    setError(null)
    try {
      await postJson<{ message: string }, { token: string }>('/auth/verify', { token: value })
      setIsVerified(true)
      setStatus('Din e-mailadresse er bekræftet. Du kan nu logge ind.')
    } catch {
      setError('Linket er ugyldigt eller udløbet.')
    } finally {
      setIsSubmitting(false)
    }
  }

  const resend = async (event: FormEvent) => {
    event.preventDefault()
    setError(null)
    try {
      await postJson('/auth/verification/resend', { email: email.trim().toLowerCase() })
      setStatus('Hvis adressen mangler bekræftelse, er en ny e-mail sendt.')
    } catch {
      setError('Kunne ikke sende en ny bekræftelsesmail.')
    }
  }

  return (
    <AuthLayout
      title="Bekræft e-mail"
      description={
        isVerified
          ? 'Din e-mailadresse er nu bekræftet.'
          : 'Bekræft linket fra e-mailen, eller bed om at få det sendt igen.'
      }
    >
      <div className="space-y-6">
        {status ? (
          <div className="flex items-start gap-2.5 rounded-md border border-primary/30 bg-primary/5 p-3 text-sm text-primary">
            <MailCheck className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
            {status}
          </div>
        ) : null}
        {error ? (
          <p className="flex items-start gap-2 text-sm text-red-700">
            <CircleAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
            {error}
          </p>
        ) : null}
        {token && !status ? (
          <div className="space-y-3">
            <Label htmlFor="token">Bekræftelsestoken</Label>
            <Input id="token" value={token} onChange={(event) => setToken(event.target.value)} />
            <Button disabled={isSubmitting} onClick={() => void verify(token)}>Bekræft</Button>
          </div>
        ) : null}
        {!isVerified ? (
          <form className="space-y-3" onSubmit={resend}>
            <Label htmlFor="verification-email">E-mail</Label>
            <Input id="verification-email" type="email" value={email} onChange={(event) => setEmail(event.target.value)} />
            <Button variant="outline">Send bekræftelsesmail igen</Button>
          </form>
        ) : null}
        <Link className="inline-block text-sm underline underline-offset-4" to="/login">Tilbage til login</Link>
      </div>
    </AuthLayout>
  )
}
