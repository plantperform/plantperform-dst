import type { LucideIcon } from 'lucide-react'
import type { ReactNode } from 'react'

import { IcoelLogo, IcoelMark } from '@/components/BrandMark'
import { cn } from '@/lib/utils'

type AuthIconProps = {
  icon: LucideIcon
  tone?: 'primary' | 'danger'
  spin?: boolean
}

export const AuthIcon = ({
  icon: Icon,
  tone = 'primary',
  spin = false,
}: AuthIconProps) => (
  <div
    className={cn(
      'flex size-12 items-center justify-center rounded-full',
      tone === 'danger'
        ? 'bg-destructive/10 text-destructive'
        : 'bg-primary/10 text-primary',
    )}
  >
    <Icon
      className={cn('h-6 w-6', spin && 'animate-spin')}
      aria-hidden="true"
    />
  </div>
)

type AuthLayoutProps = {
  title: string
  description: ReactNode
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
    <aside className="relative flex flex-col overflow-hidden bg-brand text-brand-foreground lg:w-[40%] lg:max-w-xl">
      <IcoelMark className="pointer-events-none absolute -bottom-24 -left-20 hidden size-[560px] text-brand-foreground opacity-15 lg:block" />
      <div className="relative px-6 py-6 lg:flex-1 lg:px-12 lg:pt-12">
        <IcoelLogo />
        <p className="mt-6 text-2xl font-semibold tracking-tight lg:mt-16 lg:text-3xl">
          PlantPerform
        </p>
        <p className="mt-2 text-xs font-medium uppercase tracking-[0.24em] text-brand-foreground/85 lg:text-sm">
          Beslutningsstøtte til sædskifte
        </p>
        <p className="mt-6 hidden max-w-sm font-display text-3xl leading-snug lg:block xl:text-4xl">
          Mest muligt ud af hver mark. Inden for kvoten.
        </p>
        <p className="mt-5 hidden max-w-sm text-base leading-relaxed text-brand-foreground/85 lg:block">
          Planlæg sædskiftet, og se udledningen mod kvoten for hver mark.
        </p>
      </div>
    </aside>
    <div className="flex flex-1 items-center justify-center px-6 py-10 sm:px-10 lg:py-16">
      <div className="w-full max-w-[460px] motion-safe:animate-rise-in">
        <div className="rounded-lg border bg-card p-6 shadow-[0_4px_24px_-2px_rgba(31,27,23,0.06),0_1px_3px_rgba(31,27,23,0.04)] sm:p-10">
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
