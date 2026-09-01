export type OnboardingRole = 'landmand' | 'konsulent'

export type PendingFarm = {
  name: string
  ownerName: string
  cvr: string | null
}

export type HomeOverviewState = { showOverview: boolean }

export const HOME_OVERVIEW_STATE: HomeOverviewState = { showOverview: true }

const roleKey = (email: string) => `pp-rolle:${email}`
const pendingFarmKey = (email: string) => `pp-ny-bedrift:${email}`
const lastOpenedKey = (email: string) => `pp-sidst-åbnet:${email}`
const autoOpenKey = (email: string) => `pp-auto-åbn:${email}`

const readItem = (key: string): string | null => {
  try {
    return window.localStorage.getItem(key)
  } catch {
    return null
  }
}

const writeItem = (key: string, value: string | null) => {
  try {
    if (value === null) {
      window.localStorage.removeItem(key)
    } else {
      window.localStorage.setItem(key, value)
    }
  } catch {
    return
  }
}

export const getStoredRole = (email: string): OnboardingRole | null => {
  const value = readItem(roleKey(email))
  return value === 'landmand' || value === 'konsulent' ? value : null
}

export const setStoredRole = (email: string, role: OnboardingRole) => {
  writeItem(roleKey(email), role)
}

export const getAutoOpenSingleFarm = (email: string): boolean =>
  readItem(autoOpenKey(email)) !== '0'

export const setAutoOpenSingleFarm = (email: string, value: boolean) => {
  writeItem(autoOpenKey(email), value ? '1' : '0')
}

export const getPendingFarm = (email: string): PendingFarm | null => {
  const raw = readItem(pendingFarmKey(email))
  if (!raw) return null
  try {
    const parsed: unknown = JSON.parse(raw)
    if (typeof parsed !== 'object' || parsed === null) return null
    const candidate = parsed as {
      name?: unknown
      ownerName?: unknown
      cvr?: unknown
    }
    if (
      typeof candidate.name !== 'string' ||
      typeof candidate.ownerName !== 'string'
    )
      return null
    if (
      candidate.cvr !== null &&
      candidate.cvr !== undefined &&
      typeof candidate.cvr !== 'string'
    )
      return null
    return {
      name: candidate.name,
      ownerName: candidate.ownerName,
      cvr: candidate.cvr ?? null,
    }
  } catch {
    return null
  }
}

export const getLastOpenedMap = (email: string): Record<string, number> => {
  const raw = readItem(lastOpenedKey(email))
  if (!raw) return {}
  try {
    const parsed: unknown = JSON.parse(raw)
    if (
      typeof parsed !== 'object' ||
      parsed === null ||
      Array.isArray(parsed)
    ) {
      return {}
    }
    const map: Record<string, number> = {}
    for (const [farmId, timestamp] of Object.entries(parsed)) {
      if (typeof timestamp === 'number' && Number.isFinite(timestamp)) {
        map[farmId] = timestamp
      }
    }
    return map
  } catch {
    return {}
  }
}

export const markFarmOpened = (email: string, farmId: string) => {
  const map = getLastOpenedMap(email)
  map[farmId] = Date.now()
  writeItem(lastOpenedKey(email), JSON.stringify(map))
}

export const setPendingFarm = (email: string, farm: PendingFarm) => {
  writeItem(pendingFarmKey(email), JSON.stringify(farm))
}

export const clearPendingFarm = (email: string) => {
  writeItem(pendingFarmKey(email), null)
}
