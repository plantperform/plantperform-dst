export const invalidCvrMessage = 'CVR skal være præcis 8 cifre, hvis det udfyldes.'

export const isCvrValid = (value: string) => {
  const trimmed = value.trim()
  return trimmed === '' || /^\d{8}$/.test(trimmed)
}

export const validateFarmBasics = (
  name: string,
  ownerName: string,
  cvr: string,
): string | null => {
  if (!name.trim() || !ownerName.trim()) {
    return 'Bedriftens navn og ejerens navn skal udfyldes.'
  }
  if (!isCvrValid(cvr)) {
    return invalidCvrMessage
  }
  return null
}
