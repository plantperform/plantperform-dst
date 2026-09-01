import { useState } from 'react'
import { Tractor, Users } from 'lucide-react'

import { useAuth } from '@/auth/context'
import { RoleCard } from '@/components/onboarding/RoleCard'
import { WorkspaceHeader } from '@/components/WorkspaceHeader'
import {
  getAutoOpenSingleFarm,
  getStoredRole,
  setAutoOpenSingleFarm,
  setStoredRole,
  type OnboardingRole,
} from '@/lib/onboarding'

export const ProfilePage = () => {
  const { user } = useAuth()
  const email = user?.email ?? ''
  const [role, setRole] = useState<OnboardingRole | null>(() =>
    email ? getStoredRole(email) : null,
  )
  const [autoOpen, setAutoOpen] = useState(() =>
    email ? getAutoOpenSingleFarm(email) : true,
  )

  const selectRole = (nextRole: OnboardingRole) => {
    setStoredRole(email, nextRole)
    setRole(nextRole)
  }

  return (
    <main className="min-h-screen bg-background">
      <WorkspaceHeader
        title="Profil"
        description="Din konto, din rolle og dine indstillinger."
      />
      <div className="mx-auto max-w-xl space-y-10 px-6 pb-16 pt-10 sm:px-10">
        <section className="space-y-3">
          <h2 className="text-lg font-semibold">Konto</h2>
          <div className="space-y-1">
            <p className="text-sm font-medium">E-mail</p>
            <p className="text-sm">{email}</p>
          </div>
          <p className="text-sm text-muted-foreground">
            Skift af adgangskode og e-mail kommer, når systemet understøtter
            det.
          </p>
        </section>

        <section className="space-y-3">
          <h2 id="profil-rolle-heading" className="text-lg font-semibold">
            Din rolle
          </h2>
          {role ? (
            <>
              <div className="flex items-center gap-3 rounded-lg border bg-card p-4">
                <span className="flex h-10 w-10 items-center justify-center rounded-full bg-primary text-primary-foreground">
                  {role === 'landmand' ? (
                    <Tractor className="h-5 w-5" aria-hidden="true" />
                  ) : (
                    <Users className="h-5 w-5" aria-hidden="true" />
                  )}
                </span>
                <span>
                  <span className="block font-medium">
                    {role === 'landmand' ? 'Landmand' : 'Konsulent'}
                  </span>
                  <span className="block text-sm text-muted-foreground">
                    {role === 'landmand'
                      ? 'Jeg driver en bedrift'
                      : 'Jeg rådgiver flere bedrifter'}
                  </span>
                </span>
              </div>
              <p className="text-sm text-muted-foreground">
                Rollen blev valgt, da kontoen blev oprettet, og kan ikke ændres.
              </p>
            </>
          ) : (
            <>
              <div
                className="grid gap-3 sm:grid-cols-2"
                role="group"
                aria-labelledby="profil-rolle-heading"
              >
                <RoleCard
                  selected={false}
                  title="Landmand"
                  description="Jeg driver en bedrift"
                  icon={Tractor}
                  onSelect={() => selectRole('landmand')}
                />
                <RoleCard
                  selected={false}
                  title="Konsulent"
                  description="Jeg rådgiver flere bedrifter"
                  icon={Users}
                  onSelect={() => selectRole('konsulent')}
                />
              </div>
              <p className="text-sm text-muted-foreground">
                Du har ikke valgt en rolle endnu. Valget gemmes og kan ikke
                ændres bagefter.
              </p>
            </>
          )}
        </section>

        <section className="space-y-3">
          <h2 className="text-lg font-semibold">Indstillinger</h2>
          <label className="flex items-start gap-2 text-sm">
            <input
              type="checkbox"
              className="mt-0.5"
              checked={autoOpen}
              onChange={(event) => {
                setAutoOpenSingleFarm(email, event.target.checked)
                setAutoOpen(event.target.checked)
              }}
            />
            Åbn automatisk bedriften, når jeg kun har en
          </label>
          <p className="text-sm text-muted-foreground">
            Slået fra lander du altid på oversigten.
          </p>
        </section>
      </div>
    </main>
  )
}
