export const formatCreatedAt = (value: string) => {
  const createdAt = new Date(value).getTime()
  if (Number.isNaN(createdAt)) return 'Oprettet for nylig'

  const diffMinutes = Math.max(0, Math.round((Date.now() - createdAt) / 60_000))
  if (diffMinutes < 1) return 'Oprettet netop nu'
  if (diffMinutes < 60) return `Oprettet for ${diffMinutes} min. siden`

  const diffHours = Math.round(diffMinutes / 60)
  if (diffHours < 24) return `Oprettet for ${diffHours} t. siden`

  const diffDays = Math.round(diffHours / 24)
  return `Oprettet for ${diffDays} d. siden`
}
