import type { ComponentProps } from 'react'

import { rotationDefinitionMembersPath } from '@/api/own-rotations'
import type { RotationDefinition } from '@/api/types'
import { MemberShareButton } from '@/components/farm/MemberShareButton'
import { forgetDefinition } from '@/components/farm/own-rotations-state'
import { describeLeaveRotation } from '@/lib/farm-access'

type OwnRotationShareButtonProps = {
  definition: RotationDefinition
  onLeft?: () => void
  size?: ComponentProps<typeof MemberShareButton>['size']
}

export const OwnRotationShareButton = ({
  definition,
  onLeft,
  size,
}: OwnRotationShareButtonProps) => (
  <MemberShareButton
    name={definition.name}
    membersPath={rotationDefinitionMembersPath(definition.id)}
    description="Alle, sædskiftet er delt med, kan vælge det i simuleringer på deres egne bedrifter og rette, dele og slette det."
    leaveDescription={describeLeaveRotation}
    leaveLabel="Forlad sædskifte"
    leaveFailure="Kunne ikke forlade sædskiftet."
    shareFailure="Kunne ikke dele sædskiftet. Personen skal have en bekræftet konto i PlantPerform."
    onLeft={async () => {
      await forgetDefinition(definition.id)
      onLeft?.()
    }}
    size={size}
  />
)
