import { Search } from 'lucide-react'
import { useId, useMemo, useState, type KeyboardEvent } from 'react'

import type { FieldRecord } from '@/api/types'
import { Input } from '@/components/ui/input'
import { formatNumber } from '@/lib/field-domain'
import { cn } from '@/lib/utils'

const MAX_RESULTS = 8

const matchFields = (fields: FieldRecord[], query: string): FieldRecord[] => {
  const needle = query.trim().toLowerCase()
  if (needle === '') return []
  const ranked = fields.flatMap((field) => {
    const name = field.name.toLowerCase()
    if (name.startsWith(needle)) return [{ field, rank: 0 }]
    if (name.includes(needle)) return [{ field, rank: 1 }]
    return []
  })
  return ranked
    .sort((left, right) => left.rank - right.rank)
    .slice(0, MAX_RESULTS)
    .map((entry) => entry.field)
}

type FieldSearchProps = {
  fields: FieldRecord[]
  loading: boolean
  onSelectField: (fieldId: string) => void
}

export const FieldSearch = ({
  fields,
  loading,
  onSelectField,
}: FieldSearchProps) => {
  const listId = useId()
  const [query, setQuery] = useState('')
  const [activeIndex, setActiveIndex] = useState(0)
  const matches = useMemo(() => matchFields(fields, query), [fields, query])
  const hasQuery = query.trim() !== ''
  const hasMatches = matches.length > 0
  const highlightedIndex = hasMatches
    ? Math.min(activeIndex, matches.length - 1)
    : -1
  const optionId = (index: number) => `${listId}-option-${index}`

  const clear = () => {
    setQuery('')
    setActiveIndex(0)
  }

  const choose = (field: FieldRecord | undefined) => {
    if (!field) return
    onSelectField(field.id)
    clear()
  }

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Escape') {
      if (!hasQuery) return
      event.preventDefault()
      clear()
      return
    }
    if (matches.length === 0) return
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      setActiveIndex((highlightedIndex + 1) % matches.length)
      return
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault()
      setActiveIndex((highlightedIndex - 1 + matches.length) % matches.length)
      return
    }
    if (event.key === 'Enter') {
      event.preventDefault()
      choose(matches[Math.max(0, highlightedIndex)])
    }
  }

  return (
    <div className="grid w-44 gap-1">
      <div className="relative">
        <Search
          className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground"
          aria-hidden="true"
        />
        <Input
          type="search"
          role="combobox"
          placeholder="Find mark..."
          aria-label="Find mark"
          aria-expanded={hasMatches}
          aria-controls={hasMatches ? listId : undefined}
          aria-autocomplete="list"
          aria-activedescendant={
            highlightedIndex >= 0 ? optionId(highlightedIndex) : undefined
          }
          autoComplete="off"
          className="h-7 pl-8 text-xs"
          value={query}
          onChange={(event) => {
            setQuery(event.target.value)
            setActiveIndex(0)
          }}
          onKeyDown={onKeyDown}
        />
      </div>
      {hasQuery ? (
        !hasMatches ? (
          <p role="status" className="px-2 text-xs text-muted-foreground">
            {loading ? 'Henter marker' : 'Ingen marker matcher'}
          </p>
        ) : (
          <ul
            id={listId}
            role="listbox"
            aria-label="Marker der matcher"
            className="rounded-md border bg-card py-1 text-xs shadow-xs"
          >
            {matches.map((field, index) => {
              const highlighted = index === highlightedIndex
              return (
                <li key={field.id} role="none">
                  <button
                    type="button"
                    id={optionId(index)}
                    role="option"
                    aria-selected={highlighted}
                    tabIndex={-1}
                    className={cn(
                      'flex w-full items-center gap-2 px-2 py-1 text-left',
                      highlighted && 'bg-muted',
                    )}
                    onMouseDown={(event) => event.preventDefault()}
                    onMouseEnter={() => setActiveIndex(index)}
                    onClick={() => choose(field)}
                  >
                    <span className="truncate">{field.name}</span>
                    <span className="ml-auto shrink-0 text-muted-foreground tabular-nums">
                      {formatNumber(field.areaHa)} ha
                    </span>
                  </button>
                </li>
              )
            })}
          </ul>
        )
      ) : null}
    </div>
  )
}
