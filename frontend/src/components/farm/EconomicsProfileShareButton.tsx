import type { ComponentProps } from 'react'

import { economicsModuleMembersPath } from '@/api/economics'
import { useEconomicsProfiles } from '@/components/farm/economics-profiles-state'
import { MemberShareButton } from '@/components/farm/MemberShareButton'
import type { EconomicsProfile } from '@/lib/economics-profiles'
import { isViewerProfile } from '@/lib/economics-profiles'
import { describeLeaveProfile } from '@/lib/farm-access'

type EconomicsProfileShareButtonProps = {
  profile: EconomicsProfile
  size?: ComponentProps<typeof MemberShareButton>['size']
}

export const EconomicsProfileShareButton = ({
  profile,
  size,
}: EconomicsProfileShareButtonProps) => {
  const economics = useEconomicsProfiles()

  return (
    <MemberShareButton
      name={profile.name}
      membersPath={economicsModuleMembersPath(profile.id)}
      description="Læsere kan se profilen, bruge den på deres egne bedrifter og lave en kopi. Redaktører kan også rette, dele og slette den."
      leaveDescription={describeLeaveProfile}
      leaveLabel="Forlad profil"
      leaveFailure="Kunne ikke forlade profilen."
      shareFailure="Kunne ikke dele profilen. Personen skal have en bekræftet konto i PlantPerform."
      onLeft={() => economics.forgetProfile(profile.id)}
      viewer={isViewerProfile(profile)}
      size={size}
    />
  )
}
