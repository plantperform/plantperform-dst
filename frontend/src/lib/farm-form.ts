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

export type FarmBasicsErrors = {
  name?: string
  ownerName?: string
  cvr?: string
}

export const farmBasicsErrors = (
  name: string,
  ownerName: string,
  cvr: string,
): FarmBasicsErrors => ({
  ...(name.trim() ? {} : { name: 'Bedriften skal have et navn.' }),
  ...(ownerName.trim() ? {} : { ownerName: 'Ejerens navn skal udfyldes.' }),
  ...(isCvrValid(cvr) ? {} : { cvr: invalidCvrMessage }),
})
