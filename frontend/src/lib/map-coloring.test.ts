import { describe, expect, it } from 'vitest'

import {
  buildFillColor,
  colorLegendLabel,
  COLOR_SPECS,
  excludedFromSpec,
  registryPropertyFor,
} from '@/lib/map-coloring'

describe('colorLegendLabel', () => {
  it('names the selected year on Udvaskning and Udledning', () => {
    expect(colorLegendLabel(COLOR_SPECS.leaching, 'leaching', 2023)).toBe(
      'Udvaskning 2023',
    )
    expect(colorLegendLabel(COLOR_SPECS.nLoad, 'nLoad', 2030)).toBe(
      'Udledning 2030',
    )
  })

  it('keeps the label without a selected year', () => {
    expect(colorLegendLabel(COLOR_SPECS.nLoad, 'nLoad', null)).toBe('Udledning')
  })

  it('keeps the label of a scheme that does not follow the year', () => {
    expect(colorLegendLabel(COLOR_SPECS.db2, 'db2', 2023)).toBe(
      COLOR_SPECS.db2.label,
    )
  })
})

describe('buildFillColor', () => {
  const stepInput = (spec = COLOR_SPECS.nLoadLimitKgNHa, property?: string) =>
    (buildFillColor(spec, property) as unknown[])[1]
  const value = (property: string) => [
    'to-number',
    ['coalesce', ['get', property], -1],
    -1,
  ]

  it('greys out fields that are not kvotegivende on Udledningsgrænse', () => {
    expect(stepInput()).toEqual([
      'case',
      ['==', ['to-number', ['get', 'quotaEligible'], 1], 0],
      -1,
      value('nLoadLimitKgNHa'),
    ])
  })

  it('uses the registry quota column on the registry layer', () => {
    const spec = COLOR_SPECS.nLoadLimitKgNHa
    expect(stepInput(spec, registryPropertyFor(spec) ?? undefined)).toEqual([
      'case',
      ['==', ['to-number', ['get', 'kvotegivende'], 1], 0],
      -1,
      value('udledningsgraense_kgn_ha'),
    ])
  })

  it('keeps the plain value on other numeric schemes', () => {
    expect(stepInput(COLOR_SPECS.retention)).toEqual(value('retention'))
  })
})

describe('excludedFromSpec', () => {
  it('leaves a field that is not kvotegivende out of Udledningsgrænse', () => {
    expect(excludedFromSpec(COLOR_SPECS.nLoadLimitKgNHa, 0)).toBe(true)
    expect(excludedFromSpec(COLOR_SPECS.nLoadLimitKgNHa, 1)).toBe(false)
  })

  it('keeps a field whose quota flag is unknown', () => {
    expect(excludedFromSpec(COLOR_SPECS.nLoadLimitKgNHa, undefined)).toBe(false)
  })

  it('keeps every field on other schemes', () => {
    expect(excludedFromSpec(COLOR_SPECS.retention, 0)).toBe(false)
  })
})
