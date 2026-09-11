export const PASSWORD_MIN_LENGTH = 6

const EMAIL_MAX_LENGTH = 320
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export type PasswordPurpose = 'login' | 'register'

export const validateEmail = (value: string): string | null => {
  const email = value.trim()
  if (!email) return 'Skriv din e-mailadresse.'
  if (email.length > EMAIL_MAX_LENGTH || !EMAIL_PATTERN.test(email)) {
    return 'Skriv en gyldig e-mailadresse.'
  }
  return null
}

export const validatePassword = (
  value: string,
  purpose: PasswordPurpose,
): string | null => {
  if (!value) {
    return purpose === 'login'
      ? 'Skriv din adgangskode.'
      : 'Vælg en adgangskode.'
  }
  if (value.length < PASSWORD_MIN_LENGTH) {
    return `Adgangskoden skal være mindst ${PASSWORD_MIN_LENGTH} tegn.`
  }
  return null
}
