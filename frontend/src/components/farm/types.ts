export type FarmViewSelection =
  | { kind: 'current' }
  | { kind: 'simulation'; id: string }

export type FarmInspectorMode = 'values' | 'rules'

export type FarmView = 'list' | 'split' | 'map'
