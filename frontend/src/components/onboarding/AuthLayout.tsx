import type { LucideIcon } from 'lucide-react'
import type { ReactNode } from 'react'

import { BrandMark } from '@/components/BrandMark'
import { FieldMosaic } from '@/components/onboarding/FieldMosaic'
import { cn } from '@/lib/utils'

type AuthIconProps = {
  icon: LucideIcon
  tone?: 'primary' | 'danger'
  spin?: boolean
}

export const AuthIcon = ({ icon: Icon, tone = 'primary', spin = false }: AuthIconProps) => (
  <div
    className={cn(
      'flex size-12 items-center justify-center rounded-full',
      tone === 'danger' ? 'bg-red-50 text-red-700' : 'bg-primary/10 text-primary',
    )}
  >
    <Icon className={cn('h-6 w-6', spin && 'animate-spin')} aria-hidden="true" />
  </div>
)

type AuthLayoutProps = {
  title: string
  description: string
  icon?: ReactNode
  footer?: ReactNode
  children: ReactNode
}

export const AuthLayout = ({
  title,
  description,
  icon,
  footer,
  children,
}: AuthLayoutProps) => (
  <main className="flex min-h-screen flex-col bg-background lg:flex-row">
    <aside className="relative flex flex-col overflow-hidden bg-[linear-gradient(160deg,hsl(var(--primary)),hsl(var(--primary-deep)))] text-primary-foreground lg:w-[40%] lg:max-w-xl">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute left-10 top-40 size-[420px] rounded-full bg-[radial-gradient(circle,rgba(255,255,255,0.07)_0%,rgba(255,255,255,0)_70%)]"
      />
      <div className="relative px-6 py-6 lg:flex-1 lg:px-12 lg:pt-12">
        <BrandMark variant="onDark" />
        <p className="mt-3 text-xs font-medium uppercase tracking-[0.24em] text-primary-foreground/85 lg:mt-14 lg:text-sm">
          Beslutningsstøtte til sædskifte
        </p>
        <p className="mt-6 hidden max-w-sm font-display text-3xl leading-snug lg:block xl:text-4xl">
          Mest muligt ud af hver mark. Inden for kvoten.
        </p>
        <p className="mt-5 hidden max-w-sm text-base leading-relaxed text-primary-foreground/80 lg:block">
          Planlæg sædskiftet, og se udledningen mod kvoten for hver mark.
        </p>
      </div>
      <div className="relative mt-auto hidden lg:block">
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-x-0 top-0 z-10 h-20 bg-linear-to-b from-[hsl(var(--primary-deep))] to-transparent"
        />
        <FieldMosaic />
      </div>
    </aside>
    <div className="flex flex-1 items-center justify-center px-6 py-10 sm:px-10 lg:py-16">
      <div className="w-full max-w-[460px] motion-safe:animate-rise-in">
        <div className="rounded-lg border bg-card p-6 shadow-[0_4px_24px_-2px_rgba(26,40,33,0.06),0_1px_3px_rgba(26,40,33,0.04)] sm:p-10">
          {icon ? <div className="mb-5">{icon}</div> : null}
          <h1 className="font-display text-[32px] leading-tight tracking-tight">
            {title}
          </h1>
          <p className="mt-2 text-sm text-muted-foreground">{description}</p>
          <div className="mt-8">{children}</div>
        </div>
        {footer ? (
          <div className="mt-8 space-y-2 text-center text-sm text-muted-foreground">
            {footer}
          </div>
        ) : null}
      </div>
    </div>
  </main>
)
