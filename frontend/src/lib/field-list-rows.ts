import type { FieldRecord, SimulationQuotaTrade } from '@/api/types'
import type { CatchmentRun } from '@/lib/field-domain'

export type FieldListItem =
  | { kind: 'group'; key: string; run: CatchmentRun }
  | { kind: 'field'; key: string; rowIndex: number }
  | {
      kind: 'quotaTrade'
      key: string
      run: CatchmentRun
      trade: SimulationQuotaTrade
    }

export const fieldListItems = (
  fields: FieldRecord[],
  runStarts: ReadonlyMap<string, CatchmentRun>,
  trades: SimulationQuotaTrade[] = [],
): FieldListItem[] => {
  const tradesByCatchment = new Map(
    trades.map((trade) => [trade.catchmentId, trade]),
  )
  const items: FieldListItem[] = []
  let currentRun: CatchmentRun | undefined
  fields.forEach((field, rowIndex) => {
    const run = runStarts.get(field.id)
    if (run) {
      currentRun = run
      items.push({ kind: 'group', key: `group:${field.id}`, run })
    }
    items.push({ kind: 'field', key: field.id, rowIndex })
    const nextField = fields[rowIndex + 1]
    if (
      (!nextField || runStarts.has(nextField.id)) &&
      currentRun?.catchmentId != null
    ) {
      const trade = tradesByCatchment.get(currentRun.catchmentId)
      if (trade) {
        items.push({
          kind: 'quotaTrade',
          key: `quota-trade:${trade.catchmentId}`,
          run: currentRun,
          trade,
        })
      }
    }
  })
  return items
}

export const withGroupRows = (
  indexes: number[],
  groupIndexes: number[],
): number[] =>
  [...new Set([...groupIndexes, ...indexes])].sort(
    (left, right) => left - right,
  )

type RenderedSpan = { index: number; start: number; end: number }

type ListSlot =
  | { kind: 'gap'; key: string; height: number }
  | { kind: 'row'; index: number }

export const withGaps = (
  spans: RenderedSpan[],
  listStart: number,
  listEnd: number,
): ListSlot[] => {
  const slots: ListSlot[] = []
  let cursor = listStart
  const fillTo = (end: number) => {
    if (end <= cursor) return
    slots.push({
      kind: 'gap',
      key: `gap:${slots.length}`,
      height: end - cursor,
    })
  }
  for (const span of spans) {
    fillTo(span.start)
    slots.push({ kind: 'row', index: span.index })
    cursor = span.end
  }
  fillTo(listEnd)
  return slots
}

export const widestItems = <T>(
  items: T[],
  hints: ((item: T) => number)[],
): T[] => {
  const widest: T[] = []
  for (const hint of hints) {
    let best: T | undefined
    let bestWidth = 0
    for (const item of items) {
      const width = hint(item)
      if (width > bestWidth) {
        best = item
        bestWidth = width
      }
    }
    if (best !== undefined && !widest.includes(best)) widest.push(best)
  }
  return widest
}
