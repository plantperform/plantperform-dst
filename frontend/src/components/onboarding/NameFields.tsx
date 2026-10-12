import {
  FIRST_NAME_FIELD_ID,
  LAST_NAME_FIELD_ID,
  type NameFieldsState,
} from '@/components/onboarding/name-fields'
import { FieldError } from '@/components/ui/field-error'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

const NAME_ERROR_ID = 'name-error'

type NameFieldProps = {
  id: string
  label: string
  autoComplete: 'given-name' | 'family-name'
  value: string
  missing: boolean
  autoFocus?: boolean
  onChange: (value: string) => void
}

const NameField = ({
  id,
  label,
  autoComplete,
  value,
  missing,
  autoFocus = false,
  onChange,
}: NameFieldProps) => (
  <div className="space-y-2">
    <Label htmlFor={id}>{label}</Label>
    <Input
      id={id}
      autoComplete={autoComplete}
      autoFocus={autoFocus}
      aria-invalid={missing || undefined}
      aria-describedby={missing ? NAME_ERROR_ID : undefined}
      className="h-11 aria-invalid:border-destructive aria-invalid:ring-1 aria-invalid:ring-destructive"
      value={value}
      onChange={(event) => onChange(event.target.value)}
    />
  </div>
)

type NameFieldsProps = {
  fields: NameFieldsState
  autoFocus?: boolean
}

export const NameFields = ({ fields, autoFocus = false }: NameFieldsProps) => {
  const { name, error, setName } = fields

  return (
    <div className="space-y-2">
      <div className="grid grid-cols-2 gap-3.5">
        <NameField
          id={FIRST_NAME_FIELD_ID}
          label="Fornavn"
          autoComplete="given-name"
          value={name.firstName}
          missing={error !== null && !name.firstName.trim()}
          autoFocus={autoFocus}
          onChange={(firstName) => setName({ ...name, firstName })}
        />
        <NameField
          id={LAST_NAME_FIELD_ID}
          label="Efternavn"
          autoComplete="family-name"
          value={name.lastName}
          missing={error !== null && !name.lastName.trim()}
          onChange={(lastName) => setName({ ...name, lastName })}
        />
      </div>
      <FieldError id={NAME_ERROR_ID} message={error} />
    </div>
  )
}
