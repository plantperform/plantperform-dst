import {
  EMAIL_FIELD_ID,
  PASSWORD_FIELD_ID,
  type AuthFieldsState,
} from '@/components/onboarding/auth-fields'
import { FieldError } from '@/components/onboarding/FieldError'
import { PasswordInput } from '@/components/onboarding/PasswordInput'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

type AuthFieldsProps = {
  fields: AuthFieldsState
  passwordAutoComplete: 'current-password' | 'new-password'
  autoFocus?: 'email' | 'password' | 'none'
  rejected?: boolean
}

export const AuthFields = ({
  fields,
  passwordAutoComplete,
  autoFocus = 'none',
  rejected = false,
}: AuthFieldsProps) => (
  <>
    <div className="space-y-2">
      <Label htmlFor={EMAIL_FIELD_ID}>E-mail</Label>
      <Input
        id={EMAIL_FIELD_ID}
        type="email"
        autoComplete="email"
        autoFocus={autoFocus === 'email'}
        aria-invalid={rejected || Boolean(fields.errors.email) || undefined}
        aria-describedby={fields.errors.email ? 'email-error' : undefined}
        className="h-11 aria-invalid:border-red-600 aria-invalid:ring-1 aria-invalid:ring-red-600"
        value={fields.email}
        onChange={(event) => fields.changeEmail(event.target.value)}
        onBlur={fields.blurEmail}
      />
      <FieldError id="email-error" message={fields.errors.email} />
    </div>
    <div className="space-y-2">
      <Label htmlFor={PASSWORD_FIELD_ID}>Adgangskode</Label>
      <PasswordInput
        id={PASSWORD_FIELD_ID}
        value={fields.password}
        onChange={fields.changePassword}
        onBlur={fields.blurPassword}
        autoComplete={passwordAutoComplete}
        autoFocus={autoFocus === 'password'}
        invalid={rejected || Boolean(fields.errors.password)}
        describedBy={fields.errors.password ? 'password-error' : undefined}
      />
      <FieldError id="password-error" message={fields.errors.password} />
    </div>
  </>
)
