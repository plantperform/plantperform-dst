import { useFarmFields } from '@/api/hooks'
import type { FieldRecord, Simulation } from '@/api/types'
import { describeFieldSetChanges } from '@/lib/simulation-overview'

export const useFieldSetChanges = (
  farmId: string,
  simulation: Simulation,
  fields: FieldRecord[] | undefined,
) => {
  const { data: farmFields } = useFarmFields(farmId)
  return describeFieldSetChanges(
    simulation.fieldsInitialized === false ? undefined : fields,
    farmFields,
  )
}
