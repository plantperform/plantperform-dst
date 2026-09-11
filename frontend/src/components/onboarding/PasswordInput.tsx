import { useState } from 'react'

import { Input } from '@/components/ui/input'

type PasswordInputProps = {
  id: string
  value: string
  onChange: (value: string) => void
  onBlur?: () => void
  autoComplete: 'current-password' | 'new-password'
  autoFocus?: boolean
  invalid?: boolean
  describedBy?: string
}

export const PasswordInput = ({
  id,
  value,
  onChange,
  onBlur,
  autoComplete,
  autoFocus = false,
  invalid = false,
  describedBy,
}: PasswordInputProps) => {
  const [visible, setVisible] = useState(false)

  return (
    <div className="relative">
      <Input
        id={id}
        type={visible ? 'text' : 'password'}
        autoComplete={autoComplete}
        autoFocus={autoFocus}
        aria-invalid={invalid || undefined}
        aria-describedby={describedBy}
        className="h-11 pr-16 aria-invalid:border-red-600 aria-invalid:ring-1 aria-invalid:ring-red-600"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        onBlur={onBlur}
      />
      <button
        type="button"
        aria-label={visible ? 'Skjul adgangskode' : 'Vis adgangskode'}
        aria-pressed={visible}
        onClick={() => setVisible((current) => !current)}
        className="absolute inset-y-0 right-3 my-auto h-7 rounded px-1.5 text-[13px] font-medium text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        {visible ? 'Skjul' : 'Vis'}
      </button>
    </div>
  )
}
