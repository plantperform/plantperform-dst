import { Coins } from 'lucide-react'
import { Link } from 'react-router-dom'

import type { ReturnTarget } from '@/components/farm/economics-navigation'
import { useEconomicsProfiles } from '@/components/farm/economics-profiles-state'
import { NotInCalculationDot } from '@/components/farm/economics-ui'
import {
  STANDARD_PROFILE_ID,
  type EconomicsProfile,
} from '@/lib/economics-profiles'
import { cn } from '@/lib/utils'

type EconomicsChipProps = {
  profile: EconomicsProfile
  returnTo: ReturnTarget
  className?: string
}

export const EconomicsChip = ({
  profile,
  returnTo,
  className,
}: EconomicsChipProps) => {
  const { profilePath } = useEconomicsProfiles()

  return (
    <Link
      to={profilePath(profile.id)}
      state={{ returnTo }}
      className={cn(
        'inline-flex h-6 max-w-full items-center gap-1.5 rounded-full border bg-card pr-2.5 pl-2 text-xs font-medium text-foreground transition-colors hover:border-primary hover:text-primary focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none',
        className,
      )}
    >
      <Coins className="size-3 shrink-0" aria-hidden="true" />
      <span className="truncate">{profile.name}</span>
      {profile.id === STANDARD_PROFILE_ID ? null : <NotInCalculationDot />}
    </Link>
  )
}
