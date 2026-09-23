import { FieldError } from '@/components/ui/field-error'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

type EmailFieldProps = {
  id: string
  value: string
  error: string | null
  onChange: (value: string) => void
  onBlur: () => void
  autoFocus?: boolean
  invalid?: boolean
}

export const EmailField = ({
  id,
  value,
  error,
  onChange,
  onBlur,
  autoFocus = false,
  invalid = false,
}: EmailFieldProps) => (
  <div className="space-y-2">
    <Label htmlFor={id}>E-mail</Label>
    <Input
      id={id}
      type="email"
      autoComplete="email"
      autoFocus={autoFocus}
      aria-invalid={invalid || Boolean(error) || undefined}
      aria-describedby={error ? `${id}-error` : undefined}
      className="h-11 aria-invalid:border-destructive aria-invalid:ring-1 aria-invalid:ring-destructive"
      value={value}
      onChange={(event) => onChange(event.target.value)}
      onBlur={onBlur}
    />
    <FieldError id={`${id}-error`} message={error} />
  </div>
)
