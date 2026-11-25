import { ApiError } from '@/api/client'
import type { FarmMember, MembershipRole } from '@/api/types'
import { validateEmail } from '@/lib/auth-form'
import { formatNameList } from '@/lib/economics'

export const shareEmailError = (
  email: string,
  members: FarmMember[],
): string | null => {
  if (validateEmail(email)) return 'Skriv en e-mailadresse.'
  return members.some((member) => member.email === email)
    ? 'Har allerede adgang.'
    : null
}

export const notShared = <T>(
  items: T[],
  results: PromiseSettledResult<unknown>[],
): T[] =>
  items.filter((_, index) => {
    const result = results[index]
    return (
      result.status === 'rejected' &&
      !(result.reason instanceof ApiError && result.reason.status === 409)
    )
  })

export const sameEmail = (left: string, right: string) =>
  left.toLowerCase() === right.toLowerCase()

export const otherRoleHolders = <T>(
  items: T[],
  rosters: (FarmMember[] | undefined)[],
  email: string,
  role: MembershipRole,
): T[] =>
  items.filter((_, index) => {
    const member = rosters[index]?.find((entry) =>
      sameEmail(entry.email, email),
    )
    return member !== undefined && member.role !== role
  })

export const otherMemberEmails = (
  members: FarmMember[],
  ownEmail: string,
): string[] =>
  members
    .map((member) => member.email)
    .filter((email) => !sameEmail(email, ownEmail))

export const MEMBERSHIP_ROLE_LABELS: Record<MembershipRole, string> = {
  viewer: 'Læser',
  editor: 'Redaktør',
}

export const MEMBERSHIP_ROLE_DESCRIPTIONS: Record<MembershipRole, string> = {
  viewer: 'Kan se og lave en kopi',
  editor: 'Kan også rette og dele',
}

export const MEMBERSHIP_ROLE_TINTS: Record<MembershipRole, string> = {
  viewer: 'bg-muted text-muted-foreground',
  editor: 'bg-primary text-primary-foreground',
}

export const DEFAULT_SHARE_ROLE: MembershipRole = 'viewer'

export const describeKeptRoles = (
  email: string,
  names: string[],
  role: MembershipRole,
): string =>
  `${email} har allerede adgang til ${formatNameList(names)} som ${MEMBERSHIP_ROLE_LABELS[role === 'viewer' ? 'editor' : 'viewer'].toLowerCase()}. Rollen er ikke ændret.`

export const ownRole = (
  members: FarmMember[],
  ownEmail: string,
): MembershipRole | null =>
  members.find((member) => sameEmail(member.email, ownEmail))?.role ?? null

export const canLeave = (members: FarmMember[], ownEmail: string): boolean => {
  const role = ownRole(members, ownEmail)
  return (
    role === 'viewer' ||
    (role === 'editor' &&
      members.some(
        (member) =>
          member.role === 'editor' && !sameEmail(member.email, ownEmail),
      ))
  )
}

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

export const describeLeaveRotation = (otherEmails: string[]): string =>
  `Du mister adgangen til sædskiftet. Simuleringer, hvor det er valgt, kan stadig regne med det, men du kan ikke rette det. ${shareAgain(otherEmails)}`

type ProfileMembers = { name: string; members: FarmMember[] }

export const memberProfileNames = (
  email: string,
  profiles: ProfileMembers[],
): string[] =>
  profiles
    .filter((profile) =>
      profile.members.some((member) => sameEmail(member.email, email)),
    )
    .map((profile) => profile.name)

export const memberProfilesLabel = (count: number): string =>
  `Har også ${count === 1 ? 'økonomiprofilen' : 'økonomiprofilerne'}:`

export const farmCreator = (members: FarmMember[]): string | null =>
  members.find((member) => member.creator)?.email ?? null

export const describeShareFarm = (
  email: string,
  role: MembershipRole,
  creator: string | null,
): string => {
  if (role === 'viewer') {
    return `${email} kan se bedriftens marker og simuleringer og lave en kopi af bedriften, men ikke ændre noget.`
  }
  return creator
    ? `${email} kan ændre marker og simuleringer, dele bedriften med andre og fjerne andres adgang, men ikke fjerne ${creator} eller slette bedriften.`
    : `${email} får samme adgang som dig og kan ændre marker og simuleringer, dele bedriften med andre, fjerne andres adgang og slette bedriften.`
}

export const describeFarmAccess = (otherEmails: string[]): string => {
  if (otherEmails.length === 0) return 'Kun dig'
  if (otherEmails.length === 1) return `Delt med ${otherEmails[0]}`
  return `Delt med ${otherEmails.length} andre`
}
