export type FarmViewSelection =
  | { kind: 'current' }
  | { kind: 'simulation'; id: string }
