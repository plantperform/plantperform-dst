import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'

import { BrandMark } from '@/components/BrandMark'
import { UserMenu } from '@/components/UserMenu'
import { FieldMosaic } from '@/components/onboarding/FieldMosaic'
import { HOME_OVERVIEW_STATE } from '@/lib/onboarding'

type WorkspaceHeaderProps = {
  title: string
  description: string
  actions?: ReactNode
}

export const WorkspaceHeader = ({
  title,
  description,
  actions,
}: WorkspaceHeaderProps) => (
  <header className="bg-[linear-gradient(160deg,hsl(var(--primary)),hsl(var(--primary-deep)))] text-primary-foreground">
    <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-6 pt-6 sm:px-10">
      <Link
        to="/"
        state={HOME_OVERVIEW_STATE}
        className="rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-foreground/60"
      >
        <BrandMark variant="onDark" />
      </Link>
      <UserMenu variant="onDark" />
    </div>
    <div className="mx-auto flex max-w-6xl flex-col gap-4 px-6 pt-10 sm:flex-row sm:items-end sm:justify-between sm:px-10">
      <div>
        <h1 className="font-display text-3xl tracking-tight sm:text-4xl">
          {title}
        </h1>
        <p className="mt-2 text-sm text-primary-foreground/80">{description}</p>
      </div>
      {actions}
    </div>
    <FieldMosaic variant="band" className="h-24" />
  </header>
)
