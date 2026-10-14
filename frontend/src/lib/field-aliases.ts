import type {
  FieldAliases,
  FieldRecord,
  FarmView,
  SavedResultView,
  SimulationView,
} from '@/api/types'

export const EMPTY_FIELD_ALIASES: FieldAliases = {}

export const fieldAliasKey = (field: Pick<FieldRecord, 'id' | 'imkId'>) =>
  field.imkId != null ? `imk:${field.imkId}` : `field:${field.id}`

export const applyFieldAliases = (
  fields: FieldRecord[],
  aliases: FieldAliases,
): FieldRecord[] =>
  fields.map((field) => ({
    ...field,
    alias: aliases[fieldAliasKey(field)] ?? null,
  }))

export const applySavedResultAliases = (
  saved: SavedResultView,
  aliases: FieldAliases,
): SavedResultView => ({
  ...saved,
  response: {
    ...saved.response,
    fields: applyFieldAliases(saved.response.fields, aliases),
  },
  fieldsBefore: applyFieldAliases(saved.fieldsBefore, aliases),
})

export const applyFarmViewAliases = (
  view: FarmView | undefined,
  aliases: FieldAliases,
): FarmView | undefined =>
  view?.data
    ? {
        ...view,
        data: {
          ...view.data,
          fields: applyFieldAliases(view.data.fields, aliases),
        },
      }
    : view

export const applySimulationViewAliases = (
  view: SimulationView | undefined,
  aliases: FieldAliases,
): SimulationView | undefined =>
  view?.data
    ? {
        ...view,
        data: {
          ...view.data,
          fields: applyFieldAliases(view.data.fields, aliases),
          savedResult: view.data.savedResult
            ? applySavedResultAliases(view.data.savedResult, aliases)
            : null,
        },
      }
    : view
