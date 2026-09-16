import { mutate } from 'swr'

import { simulationYearlySummaryKey } from '@/api/hooks'

// After an "Optimér" or "Års-optimering" run, simulationFieldsKey has already
// been updated directly from the response (no refetch needed). The yearly
// overview strip uses a separate SWR key, however, and would otherwise retain
// data from before the run. That is invisible to the user but makes new
// constraints or caps appear to have been ignored, so force a refetch.
//
// The "Beregningsgennemgang pr. år" panel (candidate detail) is deliberately no
// longer invalidated here. A broadly matching key revalidation previously
// refreshed every candidate-detail key the user had ever opened in this
// simulation, regardless of whether the field actually received a new
// assignment. In scenarios with unoptimised fields, this caused a burst of
// concurrent failed requests (422 "ikke optimeret endnu") for every previously
// opened field. SWR automatically reloads candidate detail the next time the
// panel opens (revalidation on mount), which is sufficient in practice.
export const invalidateOptimizationDisplays = async (
  farmId: string,
  simulationId: string,
) => {
  await mutate(simulationYearlySummaryKey(farmId, simulationId))
}

