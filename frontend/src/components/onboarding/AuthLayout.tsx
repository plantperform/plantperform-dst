import type { ReactNode } from 'react'

import { BrandMark } from '@/components/BrandMark'
import { FieldMosaic } from '@/components/onboarding/FieldMosaic'

type AuthLayoutProps = {
  title: string
  description: string
  children: ReactNode
}

export const AuthLayout = ({
  title,
  description,
  children,
}: AuthLayoutProps) => (
  <main className="flex min-h-screen flex-col bg-background lg:flex-row">
    <aside className="flex flex-col bg-[linear-gradient(160deg,hsl(var(--primary)),hsl(var(--primary-deep)))] text-primary-foreground lg:w-[44%] lg:max-w-xl">
      <div className="px-6 py-6 lg:flex-1 lg:px-12 lg:pt-12">
        <BrandMark variant="onDark" />
        <p className="mt-3 text-xs font-medium uppercase tracking-[0.24em] text-primary-foreground/85 lg:mt-10 lg:text-sm">
          Beslutningsstøtte til sædskifte
        </p>
        <p className="mt-6 hidden max-w-sm font-display text-3xl leading-snug lg:block xl:text-4xl">
          Mest muligt ud af hver mark. Inden for kvoten.
        </p>
      </div>
      <FieldMosaic className="mt-auto hidden lg:block" />
    </aside>
    <div className="flex flex-1 items-center justify-center px-6 py-10 sm:px-10 lg:py-16">
      <div className="w-full max-w-md">
        <h1 className="font-display text-3xl tracking-tight">{title}</h1>
        <p className="mt-2 text-sm text-muted-foreground">{description}</p>
        <div className="mt-8">{children}</div>
      </div>
    </div>
  </main>
)
