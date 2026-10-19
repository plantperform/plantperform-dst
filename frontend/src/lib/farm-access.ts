import type { FarmMember } from '@/api/types'
import { validateEmail } from '@/lib/auth-form'

export const shareEmailError = (
  email: string,
  members: FarmMember[],
): string | null => {
  if (validateEmail(email)) return 'Skriv en e-mailadresse.'
  return members.some((member) => member.email === email)
    ? 'Har allerede adgang.'
    : null
}

export const otherMemberEmails = (
  members: FarmMember[],
  ownEmail: string,
): string[] =>
  members
    .map((member) => member.email)
    .filter((email) => email.toLowerCase() !== ownEmail.toLowerCase())

const shareAgain = (otherEmails: string[]): string =>
  `${
    otherEmails.length === 1
      ? `${otherEmails[0]} kan`
      : 'De andre med adgang kan'
  } dele den med dig igen.`

export const describeLeaveFarm = (otherEmails: string[]): string =>
  `Du mister adgangen til bedriften. ${shareAgain(otherEmails)}`

export const describeLeaveProfile = (otherEmails: string[]): string =>
  `Du mister adgangen til profilen. Simuleringer, der bruger den, beholder deres tal, men du kan ikke genberegne dem med den. ${shareAgain(otherEmails)}`

type ProfileMembers = { name: string; members: FarmMember[] }

export const memberProfileNames = (
  email: string,
  profiles: ProfileMembers[],
): string[] =>
  profiles
    .filter((profile) =>
      profile.members.some(
        (member) => member.email.toLowerCase() === email.toLowerCase(),
      ),
    )
    .map((profile) => profile.name)

export const memberProfilesLabel = (count: number): string =>
  `Har også ${count === 1 ? 'økonomiprofilen' : 'økonomiprofilerne'}:`

export const describeShareFarm = (email: string): string =>
  `${email} får samme adgang som dig og kan ændre marker og simuleringer, dele bedriften med andre, fjerne andres adgang og slette bedriften.`

export const describeFarmAccess = (otherEmails: string[]): string => {
  if (otherEmails.length === 0) return 'Kun dig'
  if (otherEmails.length === 1) return `Delt med ${otherEmails[0]}`
  return `Delt med ${otherEmails.length} andre`
}
