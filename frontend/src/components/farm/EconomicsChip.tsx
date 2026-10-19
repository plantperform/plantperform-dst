import { Coins } from 'lucide-react'
import { Link } from 'react-router-dom'

import type { FarmingSystem } from '@/api/types'
import type { ReturnTarget } from '@/components/farm/economics-navigation'
import { useEconomicsProfiles } from '@/components/farm/economics-profiles-state'
import type { EconomicsProfile } from '@/lib/economics-profiles'
import { cn } from '@/lib/utils'

const CHIP_CLASS =
  'inline-flex h-6 max-w-full items-center gap-1.5 rounded-full border bg-card pr-2.5 pl-2 text-xs font-medium text-foreground'

type EconomicsChipProps = {
  profile: EconomicsProfile
  farmingSystem: FarmingSystem
  returnTo: ReturnTarget
  className?: string
}

export const EconomicsChip = ({
  profile,
  farmingSystem,
  returnTo,
  className,
}: EconomicsChipProps) => {
  const { profilePath, findProfile, setFarmingSystem } = useEconomicsProfiles()
  const content = (
    <>
      <Coins className="size-3 shrink-0" aria-hidden="true" />
      <span className="truncate">{profile.name}</span>
    </>
  )

  if (!findProfile(profile.id)) {
    return <span className={cn(CHIP_CLASS, className)}>{content}</span>
  }

  return (
    <Link
      to={profilePath(profile.id)}
      state={{ returnTo }}
      onClick={() => setFarmingSystem(farmingSystem)}
      className={cn(
        CHIP_CLASS,
        'transition-colors hover:border-primary hover:text-primary focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none',
        className,
      )}
    >
      {content}
    </Link>
  )
}
