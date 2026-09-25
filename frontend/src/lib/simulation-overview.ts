import {
  formatCompactDkk,
  formatFieldCount,
  formatNumber,
  formatSigned,
  formatWholeNumber,
  QUOTA_STATUS_NEAR_THRESHOLD,
  ROTATION_START_CALENDAR_YEAR,
  type CatchmentTotalsByYear,
} from '@/lib/field-domain'

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

export type CatchmentQuotaLevel = 'ok' | 'near' | 'over' | 'noData'

export type CatchmentYearStatus = {
  catchmentId: number
  level: CatchmentQuotaLevel
  overYears: number[]
}

export const summarizeCatchmentYearStatuses = (
  totalsByYear: CatchmentTotalsByYear,
  history: boolean,
): CatchmentYearStatus[] => {
  const statuses: CatchmentYearStatus[] = []
  for (const [catchmentId, byYear] of totalsByYear) {
    if (catchmentId === null) continue
    let nLoadKg = 0
    let quotaKgN = 0
    const overYears: number[] = []
    for (const [year, totals] of Object.entries(byYear)) {
      if (totals.quotaKgN <= 0) continue
      nLoadKg += totals.nLoadKg
      quotaKgN += totals.quotaKgN
      if (totals.nLoadKg > totals.quotaKgN) {
        overYears.push(
          history
            ? Number(year)
            : ROTATION_START_CALENDAR_YEAR + Number(year) - 1,
        )
      }
    }
    const level: CatchmentQuotaLevel =
      quotaKgN === 0
        ? 'noData'
        : overYears.length > 0
          ? 'over'
          : nLoadKg / quotaKgN >= QUOTA_STATUS_NEAR_THRESHOLD
            ? 'near'
            : 'ok'
    statuses.push({
      catchmentId,
      level,
      overYears: overYears.sort((left, right) => left - right),
    })
  }
  return statuses.sort((left, right) => left.catchmentId - right.catchmentId)
}

const describeYears = (years: number[]): string => {
  const periods: string[] = []
  let start = 0
  for (let end = 1; end <= years.length; end += 1) {
    if (end < years.length && years[end] === years[end - 1] + 1) continue
    const run = years.slice(start, end)
    periods.push(
      ...(run.length >= 3
        ? [`${run[0]}-${run[run.length - 1]}`]
        : run.map(String)),
    )
    start = end
  }
  return periods.length > 1
    ? `${periods.slice(0, -1).join(', ')} og ${periods[periods.length - 1]}`
    : periods.join('')
}

const CATCHMENT_LEVEL_LABELS: Record<
  Exclude<CatchmentQuotaLevel, 'over'>,
  string
> = {
  near: 'Tæt på kvoten',
  ok: 'Under kvoten',
  noData: 'Ingen kvote',
}

export const describeCatchmentYearStatus = (
  status: CatchmentYearStatus,
): string =>
  status.level === 'over'
    ? `Over kvoten i ${describeYears(status.overYears)}`
    : CATCHMENT_LEVEL_LABELS[status.level]

export type DeltaTone = 'better' | 'worse' | 'same'

export type KeyFigureDelta = {
  text: string
  tone: DeltaTone
}

const roundPercent = (value: number): number =>
  value >= 10 ? Math.round(value) : Math.round(value * 10) / 10

const toneOf = (difference: number, higherIsBetter: boolean): DeltaTone => {
  if (difference === 0) return 'same'
  return difference > 0 === higherIsBetter ? 'better' : 'worse'
}

export const describeDb2Delta = (
  value: number,
  baseline: number,
): KeyFigureDelta => {
  const difference = Math.round(value - baseline)
  const amount = formatSigned(difference, formatCompactDkk)
  const percent =
    baseline === 0
      ? 0
      : roundPercent((Math.abs(difference) / Math.abs(baseline)) * 100)
  return {
    text: percent > 0 ? `${amount} (${formatNumber(percent)} %)` : amount,
    tone: toneOf(difference, true),
  }
}

export const describeNLoadDelta = (
  value: number,
  baseline: number,
): KeyFigureDelta => {
  const difference = Math.round(value - baseline)
  return {
    text: `${formatSigned(difference, formatWholeNumber)} kg N`,
    tone: toneOf(difference, false),
  }
}

export const describeFieldChanges = ({
  changed,
  locked,
  uncalculated,
}: {
  changed: number
  locked: number
  uncalculated: number
}): string => {
  const parts = [
    changed > 0 ? `${formatFieldCount(changed)} ændret` : 'Ingen marker ændret',
  ]
  if (locked > 0) parts.push(`${formatFieldCount(locked)} låst`)
  if (uncalculated > 0) {
    parts.push(`${formatFieldCount(uncalculated)} er ikke beregnet`)
  }
  return parts.join(' · ')
}
