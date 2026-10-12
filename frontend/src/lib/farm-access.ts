import type { FarmMember } from '@/api/types'

export const otherMemberEmails = (
  members: FarmMember[],
  ownEmail: string,
): string[] =>
  members
    .map((member) => member.email)
    .filter((email) => email.toLowerCase() !== ownEmail.toLowerCase())

export const describeLeaveFarm = (otherEmails: string[]): string =>
  `Du mister adgangen til bedriften. ${
    otherEmails.length === 1
      ? `${otherEmails[0]} kan`
      : 'De andre med adgang kan'
  } dele den med dig igen.`

export const describeFarmAccess = (otherEmails: string[]): string => {
  if (otherEmails.length === 0) return 'Kun dig'
  if (otherEmails.length === 1) return `Delt med ${otherEmails[0]}`
  return `Delt med ${otherEmails.length} andre`
}
