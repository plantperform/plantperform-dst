import { AlertTriangle } from 'lucide-react'
import { Link } from 'react-router-dom'

import type { RotationOptionsError } from '@/api/types'
import { TEXT_LINK_CLASS } from '@/components/farm/economics-ui'
import { ownRotationsPath } from '@/components/farm/own-rotations-state'
import { describeRotationOptionsError } from '@/lib/own-rotations'

type OwnRotationOptionsWarningProps = {
  farmId: string
  error: RotationOptionsError
}

export const OwnRotationOptionsWarning = ({
  farmId,
  error,
}: OwnRotationOptionsWarningProps) => (
  <div className="flex w-full gap-2 rounded-lg border border-warning/40 bg-warning/10 px-3 py-2 text-sm text-warning-strong">
    <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
    <div className="min-w-0 space-y-1">
      <p className="font-medium">
        Simuleringen kan ikke optimeres igen, som den er nu
      </p>
      <p>{describeRotationOptionsError(error)}</p>
      <Link to={ownRotationsPath(farmId)} className={TEXT_LINK_CLASS}>
        Gå til Egne sædskifter
      </Link>
    </div>
  </div>
)
