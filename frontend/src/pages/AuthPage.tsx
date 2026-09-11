import { useState, type FormEvent } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { Tractor, Users } from 'lucide-react'

import { ApiError, postJson } from '@/api/client'
import { useAuthFields } from '@/components/onboarding/auth-fields'
import { AuthFields } from '@/components/onboarding/AuthFields'
import { AuthLayout } from '@/components/onboarding/AuthLayout'
import { AuthNotice } from '@/components/onboarding/AuthNotice'
import { FarmBasicsFields } from '@/components/onboarding/FarmBasicsFields'
import { LoginForm } from '@/components/onboarding/LoginForm'
import { RoleCard } from '@/components/onboarding/RoleCard'
import { Button } from '@/components/ui/button'
import { validateFarmBasics } from '@/lib/farm-form'
import {
  setLastRegisteredEmail,
  setPendingFarm,
  setStoredRole,
  type OnboardingRole,
} from '@/lib/onboarding'

type Mode = 'login' | 'register'

const RegisterForm = () => {
  const navigate = useNavigate()
  const fields = useAuthFields('register')
  const [role, setRole] = useState<OnboardingRole | null>(null)
  const [farmName, setFarmName] = useState('')
  const [ownerName, setOwnerName] = useState('')
  const [cvr, setCvr] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault()
    setError(null)
    if (!role) {
      setError('Vælg, om du er landmand eller konsulent.')
      return
    }
    if (!fields.validate()) return
    if (role === 'landmand') {
      const farmError = validateFarmBasics(farmName, ownerName, cvr)
      if (farmError) {
        setError(farmError)
        return
      }
    }

    const email = fields.normalizedEmail
    setIsSubmitting(true)
    try {
      await postJson<{ message: string }, { email: string; password: string }>(
        '/auth/register',
        { email, password: fields.password },
      )
      setStoredRole(email, role)
      if (role === 'landmand') {
        setPendingFarm(email, {
          name: farmName.trim(),
          ownerName: ownerName.trim(),
          cvr: cvr.trim() || null,
        })
      }
      setLastRegisteredEmail(email)
      navigate('/verify-email', { state: { sentTo: email } })
    } catch (requestError) {
      const status =
        requestError instanceof ApiError ? requestError.status : null
      if (status === 409) {
        fields.rejectEmail(
          'Der findes allerede en konto med denne e-mailadresse.',
        )
      } else {
        setError('Kunne ikke oprette kontoen.')
      }
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <form className="space-y-6" noValidate onSubmit={onSubmit}>
      <div className="space-y-3">
        <p id="rolle-valg-label" className="text-sm font-medium leading-none">
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
      <AuthFields fields={fields} passwordAutoComplete="new-password" />
      {role === 'landmand' ? (
        <div className="space-y-5 rounded-md border bg-muted/30 p-4 motion-safe:animate-rise-in sm:p-5">
          <div>
            <p className="text-sm font-semibold leading-none">Om din bedrift</p>
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
      {error ? <AuthNotice tone="error">{error}</AuthNotice> : null}
      <Button size="lg" className="w-full" disabled={isSubmitting}>
        {isSubmitting ? 'Opretter...' : 'Opret konto'}
      </Button>
    </form>
  )
}

const LINK_CLASS = 'font-medium text-foreground underline underline-offset-4'

export const AuthPage = ({ mode }: { mode: Mode }) => {
  const navigate = useNavigate()
  const location = useLocation()
  const from = (location.state as { from?: string } | null)?.from ?? '/'

  return (
    <AuthLayout
      title={mode === 'login' ? 'Log ind' : 'Opret konto'}
      description={
        mode === 'login'
          ? 'Log ind for at se dine bedrifter.'
          : 'Du får en mail med et link, der gør kontoen klar.'
      }
      footer={
        <>
          <p>
            {mode === 'login'
              ? 'Har du ikke en konto? '
              : 'Har du allerede en konto? '}
            <Link
              className={LINK_CLASS}
              to={mode === 'login' ? '/register' : '/login'}
            >
              {mode === 'login' ? 'Opret konto' : 'Log ind'}
            </Link>
          </p>
          {mode === 'login' ? (
            <p>
              Mangler du bekræftelsesmailen?{' '}
              <Link className={LINK_CLASS} to="/verify-email">
                Send igen
              </Link>
            </p>
          ) : null}
        </>
      }
    >
      {mode === 'login' ? (
        <LoginForm onSignedIn={() => navigate(from)} />
      ) : (
        <RegisterForm />
      )}
    </AuthLayout>
  )
}
