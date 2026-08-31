import { useEffect, useId, useMemo, useRef, useState } from 'react'

import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

export type CropPickerItem = {
  key: string
  label: string
  title: string
  colors: string[]
  meta?: string
}

type SearchableCropPickerListProps = {
  items: CropPickerItem[]
  selectedKey: string | null
  onSelect: (key: string) => void
  searchLabel: string
  searchPlaceholder: string
  emptyMessage?: string
  maxHeightClassName?: string
}

export const SearchableCropPickerList = ({
  items,
  selectedKey,
  onSelect,
  searchLabel,
  searchPlaceholder,
  emptyMessage = 'Ingen match',
  maxHeightClassName = 'max-h-[260px]',
}: SearchableCropPickerListProps) => {
  const inputId = useId()
  const [query, setQuery] = useState('')
  const [highlightedIndex, setHighlightedIndex] = useState(0)
  const [queryAtLastHighlightReset, setQueryAtLastHighlightReset] = useState(query)
  const itemRefs = useRef<(HTMLButtonElement | null)[]>([])

  if (query !== queryAtLastHighlightReset) {
    setQueryAtLastHighlightReset(query)
    setHighlightedIndex(0)
  }

  const filteredItems = useMemo(() => {
    const normalized = query.trim().toLowerCase()
    if (!normalized) return items
    return items.filter((item) => item.title.toLowerCase().includes(normalized))
  }, [items, query])

  useEffect(() => {
    itemRefs.current[highlightedIndex]?.scrollIntoView({ block: 'nearest' })
  }, [highlightedIndex])

  const handleKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (filteredItems.length === 0) return
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      setHighlightedIndex((prev) => Math.min(prev + 1, filteredItems.length - 1))
    } else if (event.key === 'ArrowUp') {
      event.preventDefault()
      setHighlightedIndex((prev) => Math.max(prev - 1, 0))
    } else if (event.key === 'Enter') {
      event.preventDefault()
      const item = filteredItems[highlightedIndex]
      if (item) onSelect(item.key)
    }
  }

  return (
    <div className="space-y-2">
      <Label htmlFor={inputId} className="sr-only">
        {searchLabel}
      </Label>
      <Input
        id={inputId}
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        onKeyDown={handleKeyDown}
        placeholder={searchPlaceholder}
      />
      <div
        role="listbox"
        aria-label={searchLabel}
        className={`space-y-1 overflow-y-auto rounded-lg border p-1.5 ${maxHeightClassName}`}
      >
        {filteredItems.length === 0 ? (
          <p className="px-2 py-3 text-sm text-muted-foreground">{emptyMessage}</p>
        ) : (
          filteredItems.map((item, index) => {
            const selected = item.key === selectedKey
            const highlighted = index === highlightedIndex
            return (
              <button
                key={item.key}
                ref={(el) => {
                  itemRefs.current[index] = el
                }}
                type="button"
                role="option"
                aria-selected={selected}
                title={item.title}
                onClick={() => onSelect(item.key)}
                onMouseEnter={() => setHighlightedIndex(index)}
                className={`flex w-full items-start gap-2 rounded-md border px-2 py-1.5 text-left text-xs transition-colors ${
                  selected
                    ? 'border-primary bg-primary/10'
                    : highlighted
                      ? 'border-transparent bg-muted'
                      : 'border-transparent hover:bg-muted'
                }`}
              >
                <span className="mt-0.5 flex shrink-0 gap-[2px]">
                  {item.colors.map((color, colorIndex) => (
                    <span
                      key={colorIndex}
                      className="h-[14px] w-[10px] shrink-0 rounded-[3px]"
                      style={{ backgroundColor: color }}
                      aria-hidden="true"
                    />
                  ))}
                </span>
                <span className="line-clamp-2 min-w-0 flex-1">{item.label}</span>
                {item.meta ? (
                  <span className="shrink-0 whitespace-nowrap text-muted-foreground">
                    · {item.meta}
                  </span>
                ) : null}
              </button>
            )
          })
        )}
      </div>
    </div>
  )
}
