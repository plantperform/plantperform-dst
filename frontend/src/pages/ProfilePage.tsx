import { useState, type ReactNode } from 'react'
import { Check, LogOut, Tractor, Users, type LucideIcon } from 'lucide-react'

import { useAuth } from '@/auth/context'
import { AppTopBar } from '@/components/AppTopBar'
import { RoleCard } from '@/components/onboarding/RoleCard'
import {
  getAutoOpenSingleFarm,
  getStoredRole,
  setAutoOpenSingleFarm,
  setStoredRole,
  ROLE_LABELS,
  type OnboardingRole,
} from '@/lib/onboarding'
import { cn } from '@/lib/utils'

const SECTIONS = [
  { id: 'account', label: 'Konto', soon: false },
  { id: 'settings', label: 'Indstillinger', soon: true },
]

const ROLE_OPTIONS: {
  role: OnboardingRole
  icon: LucideIcon
  description: string
}[] = [
  {
    role: 'farmer',
    icon: Tractor,
    description: 'Jeg driver en bedrift og planlægger mit eget sædskifte.',
  },
  {
    role: 'advisor',
    icon: Users,
    description: 'Jeg rådgiver flere landmænd og bruger oversigten.',
  },
]

const sectionLinkClass = (active: boolean) =>
  cn(
    'rounded-md px-3 py-2 text-sm font-medium transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none',
    active
      ? 'bg-muted text-foreground'
      : 'text-muted-foreground hover:bg-muted hover:text-foreground',
  )

type SettingsSectionProps = {
  id: string
  title: string
  aside?: string
  children: ReactNode
}

const SettingsSection = ({
  id,
  title,
  aside,
  children,
}: SettingsSectionProps) => (
  <section
    id={id}
    aria-labelledby={`${id}-heading`}
    className="scroll-mt-24 overflow-hidden rounded-2xl border bg-card"
  >
    <div className="flex items-baseline justify-between gap-4 border-b border-muted px-6 pt-5 pb-4">
      <h2 id={`${id}-heading`} className="text-base font-semibold">
        {title}
      </h2>
      {aside ? (
        <span className="text-xs text-muted-foreground">{aside}</span>
      ) : null}
    </div>
    {children}
  </section>
)

type RoleTileProps = {
  title: string
  description: string
  icon: LucideIcon
  active: boolean
}

const RoleTile = ({
  title,
  description,
  icon: Icon,
  active,
}: RoleTileProps) => (
  <div
    aria-current={active ? 'true' : undefined}
    className={cn(
      'relative flex items-start gap-3.5 rounded-xl border p-4',
      active ? 'border-primary bg-primary/5' : 'opacity-55',
    )}
  >
    <span
      className={cn(
        'flex size-10 shrink-0 items-center justify-center rounded-full',
        active
          ? 'bg-primary text-primary-foreground'
          : 'bg-muted text-muted-foreground',
      )}
    >
      <Icon className="size-5" aria-hidden="true" />
    </span>
    <span className="block">
      <span className="block text-[15px] font-semibold">{title}</span>
      <span className="mt-0.5 block text-[13px] leading-[18px] text-muted-foreground">
        {description}
      </span>
    </span>
    {active ? (
      <span className="absolute top-3 right-3 flex size-5 items-center justify-center rounded-full bg-primary text-primary-foreground">
        <Check className="size-3" strokeWidth={3} aria-hidden="true" />
      </span>
    ) : null}
  </div>
)

export const ProfilePage = () => {
  const { user, signOut } = useAuth()
  const email = user?.email ?? ''
  const initial = email.charAt(0).toUpperCase()
  const [role, setRole] = useState<OnboardingRole | null>(() =>
    email ? getStoredRole(email) : null,
  )
  const [autoOpen, setAutoOpen] = useState(() =>
    email ? getAutoOpenSingleFarm(email) : true,
  )
  const [activeSection, setActiveSection] = useState(SECTIONS[0].id)

  const selectRole = (nextRole: OnboardingRole) => {
    setStoredRole(email, nextRole)
    setRole(nextRole)
  }
  const toggleAutoOpen = () => {
    setAutoOpenSingleFarm(email, !autoOpen)
    setAutoOpen(!autoOpen)
  }

  return (
    <main className="min-h-screen bg-background">
      <AppTopBar />
      <div className="mx-auto max-w-6xl px-6 pt-12 pb-20 sm:px-10">
        <div className="grid items-start gap-10 lg:grid-cols-[260px_minmax(0,1fr)] lg:gap-16">
          <div className="flex flex-col gap-5 lg:sticky lg:top-[72px]">
            <div className="flex items-center gap-3.5">
              <span
                aria-hidden="true"
                className="flex size-14 shrink-0 items-center justify-center rounded-full bg-primary font-display text-[26px] text-primary-foreground"
              >
                {initial}
              </span>
              <div className="min-w-0">
                <h1 className="font-display text-[32px] leading-[1.1] tracking-tight">
                  Profil
                </h1>
                <p className="mt-1 truncate text-sm text-muted-foreground">
                  {email}
                </p>
              </div>
            </div>
            <nav
              aria-label="Afsnit på profilen"
              className="flex flex-col gap-0.5 border-t pt-4"
            >
              {SECTIONS.map((section) =>
                section.soon ? (
                  <span
                    key={section.id}
                    aria-disabled="true"
                    className="flex items-center justify-between gap-2 rounded-md px-3 py-2 text-sm font-medium text-muted-foreground/60"
                  >
                    {section.label}
                    <span className="rounded-full border px-2 py-px text-[11px] font-medium">
                      Kommer snart
                    </span>
                  </span>
                ) : (
                  <a
                    key={section.id}
                    href={`#${section.id}`}
                    aria-current={
                      activeSection === section.id ? 'location' : undefined
                    }
                    onClick={() => setActiveSection(section.id)}
                    className={sectionLinkClass(activeSection === section.id)}
                  >
                    {section.label}
                  </a>
                ),
              )}
            </nav>
            <button
              type="button"
              onClick={() => void signOut()}
              className="mt-2 inline-flex w-fit items-center gap-2 rounded-md px-3 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-destructive focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
            >
              <LogOut className="size-4" aria-hidden="true" />
              Log ud
            </button>
          </div>

          <div className="flex max-w-[680px] flex-col gap-6">
            <SettingsSection id="account" title="Konto">
              <div className="divide-y divide-muted">
                <div className="flex items-center justify-between gap-4 px-6 py-4">
                  <div>
                    <p className="text-xs text-muted-foreground">E-mail</p>
                    <p className="mt-0.5 text-[15px] font-medium">{email}</p>
                  </div>
                  <span className="rounded-full border px-2.5 py-[3px] text-xs text-muted-foreground">
                    Bekræftet
                  </span>
                </div>
                <div className="flex items-center justify-between gap-4 px-6 py-4">
                  <div>
                    <p className="text-xs text-muted-foreground">Adgangskode</p>
                    <p
                      className="mt-0.5 text-[15px] font-medium tracking-[0.2em]"
                      aria-label="Skjult adgangskode"
                    >
                      ••••••••
                    </p>
                  </div>
                  <span className="text-[13px] text-muted-foreground">
                    Skift kommer, når systemet understøtter det
                  </span>
                </div>
              </div>
            </SettingsSection>

            <SettingsSection
              id="role"
              title="Din rolle"
              aside={
                role
                  ? 'Valgt ved oprettelsen · kan ikke ændres'
                  : 'Valget gemmes og kan ikke ændres bagefter'
              }
            >
              <div
                className="grid gap-3 p-6 sm:grid-cols-2"
                role={role ? undefined : 'group'}
                aria-labelledby={role ? undefined : 'role-heading'}
              >
                {ROLE_OPTIONS.map((option) =>
                  role ? (
                    <RoleTile
                      key={option.role}
                      title={ROLE_LABELS[option.role]}
                      description={option.description}
                      icon={option.icon}
                      active={role === option.role}
                    />
                  ) : (
                    <RoleCard
                      key={option.role}
                      selected={false}
                      title={ROLE_LABELS[option.role]}
                      description={option.description}
                      icon={option.icon}
                      onSelect={() => selectRole(option.role)}
                    />
                  ),
                )}
              </div>
            </SettingsSection>

            <SettingsSection
              id="settings"
              title="Indstillinger"
              aside="Kommer snart"
            >
              <label className="flex cursor-pointer items-center justify-between gap-6 px-6 py-[18px]">
                <span className="block">
                  <span className="block text-[15px] font-medium">
                    Åbn automatisk bedriften, når jeg kun har en
                  </span>
                  <span className="mt-0.5 block text-[13px] text-muted-foreground">
                    {autoOpen
                      ? 'Du lander direkte i bedriften, når du logger ind.'
                      : 'Slået fra lander du altid på oversigten.'}
                  </span>
                </span>
                <button
                  type="button"
                  role="switch"
                  aria-checked={autoOpen}
                  onClick={toggleAutoOpen}
                  className={cn(
                    'relative h-[26px] w-11 shrink-0 rounded-full transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:outline-none',
                    autoOpen ? 'bg-primary' : 'bg-border',
                  )}
                >
                  <span
                    aria-hidden="true"
                    className={cn(
                      'absolute top-[3px] size-5 rounded-full bg-card shadow-sm transition-[left]',
                      autoOpen ? 'left-[21px]' : 'left-[3px]',
                    )}
                  />
                </button>
              </label>
            </SettingsSection>
          </div>
        </div>
      </div>
    </main>
  )
}
