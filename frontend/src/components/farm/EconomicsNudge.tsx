import { useStartGuide } from '@/components/farm/economics-navigation'
import { useEconomicsProfiles } from '@/components/farm/economics-profiles-state'
import { EconomicsBanner } from '@/components/farm/EconomicsBanner'
import { Button } from '@/components/ui/button'
import { useStoredFlag } from '@/hooks/use-stored-flag'
import {
  ECONOMICS_INVITATION,
  STANDARD_PROFILE,
  STANDARD_PROFILE_ID,
} from '@/lib/economics-profiles'

export const EconomicsNudge = ({ farmId }: { farmId: string }) => {
  const economics = useEconomicsProfiles()
  const startGuide = useStartGuide()
  const [dismissed, setDismissed] = useStoredFlag(
    `plantperform.economicsNudgeDismissed.${farmId}`,
  )

  if (dismissed || economics.ownProfiles?.length !== 0) return null

  return (
    <EconomicsBanner
      label="Økonomi"
      title={`Simuleringerne regner med ${STANDARD_PROFILE.name}`}
      text={ECONOMICS_INVITATION}
    >
      <Button
        size="sm"
        onClick={() => startGuide({ fromProfileId: STANDARD_PROFILE_ID })}
      >
        Tilpas økonomien til bedriften
      </Button>
      <Button variant="ghost" size="sm" onClick={() => setDismissed(true)}>
        Ikke nu
      </Button>
    </EconomicsBanner>
  )
}
