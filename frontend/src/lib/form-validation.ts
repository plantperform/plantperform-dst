import type { z } from 'zod'

// Checks a number field kept as the text the user typed. The first failing
// message is the one shown, so an empty field reads "Udfyld feltet", not a
// range message. An optional field may be left empty.
export const checkNumberText = (
  ctx: z.RefinementCtx,
  path: PropertyKey[],
  text: string,
  isValid: (value: number) => boolean,
  message: string,
  {
    optional = false,
    emptyMessage = 'Udfyld feltet',
  }: { optional?: boolean; emptyMessage?: string } = {},
) => {
  const trimmed = text.trim()
  if (trimmed === '') {
    if (!optional) ctx.addIssue({ code: 'custom', path, message: emptyMessage })
    return
  }
  const value = Number(trimmed)
  if (!Number.isFinite(value)) {
    ctx.addIssue({ code: 'custom', path, message: 'Angiv et tal' })
    return
  }
  if (!isValid(value)) ctx.addIssue({ code: 'custom', path, message })
}
