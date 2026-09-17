import { useState } from 'react'

import {
  useOptimizationRun,
  useOptimizationRunActions,
} from '@/api/optimization-runs'
import type { OptimizationKind } from '@/lib/optimization-run'

export type OptimizationDialogView = 'form' | 'running' | 'succeeded'

// Run state for one optimization dialog. The confirmation is only shown for a
// run the user started and watched to the end without closing the dialog.
export const useOptimizationDialogRun = (
  simulationId: string,
  kind: OptimizationKind,
  open: boolean,
) => {
  const run = useOptimizationRun(simulationId)
  const { startRun } = useOptimizationRunActions()
  const [watchedRunId, setWatchedRunId] = useState<number | null>(null)
  if (!open && watchedRunId !== null) setWatchedRunId(null)

  const view: OptimizationDialogView =
    run?.status === 'running'
      ? 'running'
      : run?.status === 'succeeded' && run.id === watchedRunId
        ? 'succeeded'
        : 'form'

  return {
    run,
    view,
    runError: run?.status === 'failed' && run.kind === kind ? run.error : null,
    startRun: (request: Parameters<typeof startRun>[0]) => {
      const id = startRun(request)
      if (id !== null) setWatchedRunId(id)
    },
  }
}
