import { useEffect, useState } from 'react'

import {
  advancePacedStep,
  restPacedStep,
  startPacedStep,
} from '@/lib/paced-step'

export const usePacedStep = (key: string, target: number, stepMs: number) => {
  const [stored, setStored] = useState(() => startPacedStep(key))
  const paced = advancePacedStep(stored, key, target)
  if (paced !== stored) setStored(paced)

  useEffect(() => {
    const timer = window.setTimeout(() => setStored(restPacedStep), stepMs)
    return () => window.clearTimeout(timer)
  }, [paced.key, paced.step, stepMs])

  return paced.step
}
