import type { Farm } from '@/api/types'
import { farmMatchesSearch } from '@/lib/farm-overview'

const SEARCH_FROM_FARM_COUNT = 8

const RECENT_FARM_COUNT = 6

type SwitcherFarms = {
  heading: string
  farms: Farm[]
  searchable: boolean
}

export const switcherFarms = (
  farms: Farm[],
  lastOpened: Record<string, number>,
  searchText: string,
): SwitcherFarms => {
  const byLastOpened = [...farms].sort(
    (left, right) =>
      (lastOpened[right.id] ?? 0) - (lastOpened[left.id] ?? 0) ||
      left.name.localeCompare(right.name, 'da-DK'),
  )
  if (farms.length < SEARCH_FROM_FARM_COUNT) {
    return { heading: 'Bedrifter', farms: byLastOpened, searchable: false }
  }
  if (searchText.trim() === '') {
    return {
      heading: 'Sidst åbnet',
      farms: byLastOpened.slice(0, RECENT_FARM_COUNT),
      searchable: true,
    }
  }
  return {
    heading: 'Bedrifter',
    farms: byLastOpened.filter((farm) => farmMatchesSearch(farm, searchText)),
    searchable: true,
  }
}
