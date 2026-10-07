export const invalidCvrMessage = 'CVR skal være præcis 8 cifre, hvis det udfyldes.'

export const isCvrComplete = (value: string) => /^\d{8}$/.test(value.trim())

export const isCvrValid = (value: string) =>
  value.trim() === '' || isCvrComplete(value)

export const toCvrDigits = (value: string) =>
  value.replace(/\D/g, '').slice(0, 8)

export const formatCvr = (cvr: string) =>
  toCvrDigits(cvr).replace(/(\d{2})(?=\d)/g, '$1 ')

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

export const farmLookupErrors = (
  name: string,
  ownerName: string,
  cvr: string,
): FarmBasicsErrors => ({
  ...farmBasicsErrors(name, ownerName, ''),
  ...(isCvrComplete(cvr) ? {} : { cvr: 'Skriv de 8 cifre i CVR-nummeret.' }),
})
