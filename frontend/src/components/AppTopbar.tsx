import { Link } from 'react-router-dom'

import { BrandMark } from '@/components/BrandMark'
import { UserMenu } from '@/components/UserMenu'
import { HOME_OVERVIEW_STATE } from '@/lib/onboarding'

export const AppTopbar = () => (
  <header className="bg-[linear-gradient(160deg,hsl(var(--primary)),hsl(var(--primary-deep)))] text-primary-foreground">
    <div className="flex h-14 items-center justify-between gap-4 px-4 sm:px-6">
      <Link
        to="/"
        state={HOME_OVERVIEW_STATE}
        className="rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-foreground/60"
      >
        <BrandMark variant="onDark" />
      </Link>
      <UserMenu variant="onDark" />
    </div>
  </header>
)
