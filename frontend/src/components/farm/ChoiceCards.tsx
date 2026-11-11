import type { ReactNode } from 'react'

import { CHOICE_SELECTED_CLASS } from '@/components/farm/choice-styles'
import { cn } from '@/lib/utils'

export type ChoiceCard<T extends string | number> = {
  value: T
  label: ReactNode
  description: string
  guidance: string
}

type Props<T extends string | number> = {
  legend: string
  name: string
  options: readonly ChoiceCard<T>[]
  value: T
  disabled: boolean
  onChange: (value: T) => void
}

export function ChoiceCards<T extends string | number>({
  legend,
  name,
  options,
  value,
  disabled,
  onChange,
}: Props<T>) {
  return (
    <fieldset disabled={disabled} className="space-y-3">
      <legend className="text-sm font-medium">{legend}</legend>
      {options.map((option) => (
        <label
          key={option.value}
          className={cn(
            'flex items-start gap-3 rounded-md border p-4 text-sm has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring',
            value === option.value ? CHOICE_SELECTED_CLASS : 'bg-background',
            !disabled && 'cursor-pointer hover:bg-muted/50',
          )}
        >
          <input
            type="radio"
            name={name}
            value={option.value}
            checked={value === option.value}
            onChange={() => onChange(option.value)}
            className="mt-1"
          />
          <span className="space-y-1.5">
            <span className="block font-medium">{option.label}</span>
            <span className="block text-muted-foreground">
              {option.description}
            </span>
            <span className="block text-xs text-muted-foreground">
              {option.guidance}
            </span>
          </span>
        </label>
      ))}
    </fieldset>
  )
}
