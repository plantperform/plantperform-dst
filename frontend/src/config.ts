const DEFAULT_ROTATION_START_CALENDAR_YEAR = 2027
const configuredYear = Number(
  import.meta.env.VITE_ROTATION_START_CALENDAR_YEAR ??
    DEFAULT_ROTATION_START_CALENDAR_YEAR,
)

if (!Number.isInteger(configuredYear) || configuredYear < 1) {
  throw new Error('VITE_ROTATION_START_CALENDAR_YEAR must be a positive integer')
}

export const ROTATION_START_CALENDAR_YEAR = configuredYear
