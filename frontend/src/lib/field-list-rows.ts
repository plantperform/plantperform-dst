import type { FieldRecord } from '@/api/types'
import type { CatchmentRun } from '@/lib/field-domain'

type FieldListItem =
  | { kind: 'group'; key: string; run: CatchmentRun }
  | { kind: 'field'; key: string; rowIndex: number }

export const fieldListItems = (
  fields: FieldRecord[],
  runStarts: ReadonlyMap<string, CatchmentRun>,
): FieldListItem[] =>
  fields.flatMap((field, rowIndex): FieldListItem[] => {
    const run = runStarts.get(field.id)
    const row: FieldListItem = { kind: 'field', key: field.id, rowIndex }
    return run ? [{ kind: 'group', key: `group:${field.id}`, run }, row] : [row]
  })

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
