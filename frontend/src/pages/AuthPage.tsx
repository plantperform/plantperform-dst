import { useState, type FormEvent } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'

import { useAuth } from '@/auth/context'
import { ApiError, postJson } from '@/api/client'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

type Mode = 'login' | 'register'

export const AuthPage = ({ mode }: { mode: Mode }) => {
  const navigate = useNavigate()
  const location = useLocation()
  const { signIn } = useAuth()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault()
    setError(null)
    setMessage(null)
    const normalizedEmail = email.trim().toLowerCase()
    if (!normalizedEmail || !normalizedEmail.includes('@')) {
      setError('Indtast en gyldig e-mailadresse.')
      return
    }
    if (password.length < 6) {
      setError('Adgangskoden skal være mindst 6 tegn.')
      return
    }

    setIsSubmitting(true)
    try {
      if (mode === 'register') {
        await postJson<{ message: string }, { email: string; password: string }>('/auth/register', {
          email: normalizedEmail,
          password,
        })
        setMessage('Tjek din e-mail og bekræft adressen, før du logger ind.')
      } else {
        await signIn({ email: normalizedEmail, password })
        const from = (location.state as { from?: string } | null)?.from ?? '/'
        navigate(from)
      }
    } catch (requestError) {
      const text = requestError instanceof Error ? requestError.message : ''
      if (mode === 'register' && requestError instanceof ApiError && requestError.status === 409) {
        setError('Der findes allerede en konto med denne e-mailadresse.')
      } else if (text.toLowerCase().includes('verification')) {
        setError('Bekræft din e-mailadresse før login.')
      } else {
        setError(mode === 'login' ? 'E-mail eller adgangskode er forkert.' : 'Kunne ikke oprette kontoen.')
      }
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <main className="min-h-screen bg-background px-6 py-10 sm:px-10">
      <div className="mx-auto max-w-md">
        <Card>
          <CardHeader>
            <CardTitle>{mode === 'login' ? 'Log ind' : 'Opret konto'}</CardTitle>
            <CardDescription>
              {mode === 'login'
                ? 'Log ind for at se dine bedrifter.'
                : 'Du modtager en e-mail, som skal bekræftes før login.'}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form className="space-y-5" onSubmit={onSubmit}>
              <div className="space-y-2">
                <Label htmlFor="email">E-mail</Label>
                <Input id="email" type="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="password">Adgangskode</Label>
                <Input id="password" type="password" minLength={6} autoComplete={mode === 'login' ? 'current-password' : 'new-password'} value={password} onChange={(event) => setPassword(event.target.value)} />
              </div>
              {error ? <p className="text-sm text-red-700">{error}</p> : null}
              {message ? <p className="text-sm text-green-700">{message}</p> : null}
              <Button className="w-full" disabled={isSubmitting}>
                {isSubmitting ? 'Arbejder...' : mode === 'login' ? 'Log ind' : 'Opret konto'}
              </Button>
            </form>
            <p className="mt-5 text-center text-sm text-muted-foreground">
              {mode === 'login' ? 'Har du ikke en konto? ' : 'Har du allerede en konto? '}
              <Link className="font-medium text-foreground underline" to={mode === 'login' ? '/register' : '/login'}>
                {mode === 'login' ? 'Opret konto' : 'Log ind'}
              </Link>
            </p>
            {mode === 'login' ? (
              <p className="mt-3 text-center text-sm text-muted-foreground">
                Mangler du bekræftelsesmailen? <Link className="underline" to="/verify-email">Send igen</Link>
              </p>
            ) : null}
          </CardContent>
        </Card>
      </div>
    </main>
  )
}
