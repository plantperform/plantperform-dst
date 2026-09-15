import { Link } from 'react-router-dom'

import { BrandMark } from '@/components/BrandMark'
import { UserMenu } from '@/components/UserMenu'
import { HOME_OVERVIEW_STATE } from '@/lib/onboarding'

export const AppTopBar = () => (
  <header className="border-b bg-card">
    <div className="mx-auto flex h-12 max-w-6xl items-center justify-between gap-6 px-6 sm:px-10">
      <Link
        to="/"
        state={HOME_OVERVIEW_STATE}
        className="rounded-lg focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
      >
        <BrandMark />
      </Link>
      <UserMenu className="shrink-0" />
    </div>
  </header>
)
