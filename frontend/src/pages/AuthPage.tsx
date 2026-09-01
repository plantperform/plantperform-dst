import { useState, type FormEvent } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { CircleAlert, MailCheck, Tractor, Users } from 'lucide-react'

import { useAuth } from '@/auth/context'
import { ApiError, postJson } from '@/api/client'
import { AuthLayout } from '@/components/onboarding/AuthLayout'
import { FarmBasicsFields } from '@/components/onboarding/FarmBasicsFields'
import { RoleCard } from '@/components/onboarding/RoleCard'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { validateFarmBasics } from '@/lib/farm-form'
import {
  setPendingFarm,
  setStoredRole,
  type OnboardingRole,
} from '@/lib/onboarding'

type Mode = 'login' | 'register'

export const AuthPage = ({ mode }: { mode: Mode }) => {
  const navigate = useNavigate()
  const location = useLocation()
  const { signIn } = useAuth()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [role, setRole] = useState<OnboardingRole | null>(null)
  const [farmName, setFarmName] = useState('')
  const [ownerName, setOwnerName] = useState('')
  const [cvr, setCvr] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault()
    setError(null)
    setMessage(null)
    if (mode === 'register' && !role) {
      setError('Vælg, om du er landmand eller konsulent.')
      return
    }
    const normalizedEmail = email.trim().toLowerCase()
    if (!normalizedEmail || !normalizedEmail.includes('@')) {
      setError('Indtast en gyldig e-mailadresse.')
      return
    }
    if (password.length < 6) {
      setError('Adgangskoden skal være mindst 6 tegn.')
      return
    }
    if (mode === 'register' && role === 'landmand') {
      const farmError = validateFarmBasics(farmName, ownerName, cvr)
      if (farmError) {
        setError(farmError)
        return
      }
    }

    setIsSubmitting(true)
    try {
      if (mode === 'register') {
        await postJson<
          { message: string },
          { email: string; password: string }
        >('/auth/register', {
          email: normalizedEmail,
          password,
        })
        if (role) {
          setStoredRole(normalizedEmail, role)
        }
        if (role === 'landmand') {
          setPendingFarm(normalizedEmail, {
            name: farmName.trim(),
            ownerName: ownerName.trim(),
            cvr: cvr.trim() || null,
          })
        }
        setMessage('Tjek din e-mail og bekræft adressen, før du logger ind.')
      } else {
        await signIn({ email: normalizedEmail, password })
        const from = (location.state as { from?: string } | null)?.from ?? '/'
        navigate(from)
      }
    } catch (requestError) {
      const text = requestError instanceof Error ? requestError.message : ''
      if (
        mode === 'register' &&
        requestError instanceof ApiError &&
        requestError.status === 409
      ) {
        setError('Der findes allerede en konto med denne e-mailadresse.')
      } else if (text.toLowerCase().includes('verification')) {
        setError('Bekræft din e-mailadresse før login.')
      } else {
        setError(
          mode === 'login'
            ? 'E-mail eller adgangskode er forkert.'
            : 'Kunne ikke oprette kontoen.',
        )
      }
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <AuthLayout
      title={mode === 'login' ? 'Log ind' : 'Opret konto'}
      description={
        mode === 'login'
          ? 'Log ind for at se dine bedrifter.'
          : 'Du modtager en e-mail, som skal bekræftes før login.'
      }
    >
      <form className="space-y-6" onSubmit={onSubmit}>
        {mode === 'register' ? (
          <div className="space-y-3">
            <p
              id="rolle-valg-label"
              className="text-sm font-medium leading-none"
            >
              Hvem er du?
            </p>
            <div
              className="grid gap-3 sm:grid-cols-2"
              role="group"
              aria-labelledby="rolle-valg-label"
            >
              <RoleCard
                selected={role === 'landmand'}
                title="Landmand"
                description="Jeg driver en bedrift"
                icon={Tractor}
                onSelect={() => setRole('landmand')}
              />
              <RoleCard
                selected={role === 'konsulent'}
                title="Konsulent"
                description="Jeg rådgiver flere bedrifter"
                icon={Users}
                onSelect={() => setRole('konsulent')}
              />
            </div>
          </div>
        ) : null}
        <div className="space-y-2">
          <Label htmlFor="email">E-mail</Label>
          <Input
            id="email"
            type="email"
            autoComplete="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="password">Adgangskode</Label>
          <Input
            id="password"
            type="password"
            minLength={6}
            autoComplete={
              mode === 'login' ? 'current-password' : 'new-password'
            }
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />
        </div>
        {mode === 'register' && role === 'landmand' ? (
          <div className="space-y-5 rounded-lg border bg-muted/30 p-4 motion-safe:animate-[rise-in_280ms_ease-out] sm:p-5">
            <div>
              <p className="text-sm font-medium leading-none">Om din bedrift</p>
              <p className="mt-1.5 text-sm text-muted-foreground">
                Vi opretter bedriften for dig, når du logger ind første gang.
              </p>
            </div>
            <FarmBasicsFields
              name={farmName}
              ownerName={ownerName}
              cvr={cvr}
              onNameChange={setFarmName}
              onOwnerNameChange={setOwnerName}
              onCvrChange={setCvr}
            />
          </div>
        ) : null}
        {error ? (
          <p className="flex items-start gap-2 text-sm text-red-700">
            <CircleAlert
              className="mt-0.5 h-4 w-4 shrink-0"
              aria-hidden="true"
            />
            {error}
          </p>
        ) : null}
        {message ? (
          <div className="flex items-start gap-2.5 rounded-md border border-primary/30 bg-primary/5 p-3 text-sm text-primary">
            <MailCheck className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
            {message}
          </div>
        ) : null}
        <Button className="w-full" disabled={isSubmitting}>
          {isSubmitting
            ? 'Arbejder...'
            : mode === 'login'
              ? 'Log ind'
              : 'Opret konto'}
        </Button>
      </form>
      <p className="mt-6 text-center text-sm text-muted-foreground">
        {mode === 'login'
          ? 'Har du ikke en konto? '
          : 'Har du allerede en konto? '}
        <Link
          className="font-medium text-foreground underline underline-offset-4"
          to={mode === 'login' ? '/register' : '/login'}
        >
          {mode === 'login' ? 'Opret konto' : 'Log ind'}
        </Link>
      </p>
      {mode === 'login' ? (
        <p className="mt-3 text-center text-sm text-muted-foreground">
          Mangler du bekræftelsesmailen?{' '}
          <Link className="underline underline-offset-4" to="/verify-email">
            Send igen
          </Link>
        </p>
      ) : null}
    </AuthLayout>
  )
}
