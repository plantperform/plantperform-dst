import { describe, expect, it } from 'vitest'

import {
  buildFillColor,
  buildRotationSpec,
  colorLegendLabel,
  COLOR_SPECS,
  describeSpecValue,
  excludedFromSpec,
  legendEntries,
  registryPropertyFor,
  specColorFor,
} from '@/lib/map-coloring'
import {
  NO_ROTATION_COLOR,
  rotationColorsOf,
  type RotationShare,
} from '@/lib/rotation-overview'

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

describe('buildRotationSpec', () => {
  const sharesOf = (variants: (string | null)[]): RotationShare[] =>
    variants.map((rotationVariant) => ({
      rotationVariant,
      name: null,
      cropSequence: null,
      areaHa: 1,
      share: 1 / variants.length,
      fieldCount: 1,
    }))
  const shares = sharesOf(['315', 'permanent', null])
  const colors = rotationColorsOf(shares)
  const spec = buildRotationSpec(shares, colors)

  it('has a bin per sædskifte, named and coloured as in the Sædskifter tab', () => {
    expect(spec.bins).toEqual([
      { value: '315', color: colors.get('315'), label: 'Sædskifte 315' },
      {
        value: 'permanent',
        color: colors.get('permanent'),
        label: 'Permanente sædskifter',
      },
      { value: 'none', color: NO_ROTATION_COLOR, label: 'Uden sædskifte' },
    ])
  })

  it('lists the sædskifter in the legend in the order of the shares', () => {
    expect(legendEntries(spec).map((entry) => entry.label)).toEqual([
      'Sædskifte 315',
      'Permanente sædskifter',
      'Uden sædskifte',
    ])
  })

  it('colours the fields by the sædskifte of their rotationVariant', () => {
    expect(buildFillColor(spec)).toEqual([
      'match',
      ['get', 'rotationVariant'],
      '315',
      colors.get('315'),
      'permanent',
      colors.get('permanent'),
      'none',
      NO_ROTATION_COLOR,
      NO_ROTATION_COLOR,
    ])
  })

  it('names and colours the sædskifte of a hovered field', () => {
    expect(describeSpecValue(spec, '315')).toBe('Sædskifte 315')
    expect(specColorFor(spec, '315')).toBe(colors.get('315'))
    expect(describeSpecValue(spec, 'permanent')).toBe('Permanente sædskifter')
    expect(describeSpecValue(spec, 'none')).toBe('Uden sædskifte')
    expect(specColorFor(spec, 'none')).toBe(NO_ROTATION_COLOR)
  })

  it('has no name and the grey for a sædskifte that is not among the bins', () => {
    expect(describeSpecValue(spec, '999')).toBeNull()
    expect(describeSpecValue(spec, undefined)).toBeNull()
    expect(specColorFor(spec, '999')).toBe(NO_ROTATION_COLOR)
  })

  it('is the grey everywhere on a farm without fields', () => {
    expect(buildFillColor(buildRotationSpec([], new Map()))).toBe(
      NO_ROTATION_COLOR,
    )
  })

  it('keeps a number-like string as the sædskifte it is, not as a number', () => {
    // 315 is no number to the map: the property is the string "315".
    expect(specColorFor(spec, 315)).toBe(NO_ROTATION_COLOR)
    expect(describeSpecValue(spec, 315)).toBeNull()
  })
})

describe('categories of numbers', () => {
  it('still match a number that arrives as a string', () => {
    expect(describeSpecValue(COLOR_SPECS.fieldLocked, 1)).toBe(
      'Låst - Optimér må ikke ændre',
    )
    expect(describeSpecValue(COLOR_SPECS.fieldLocked, '0')).toBe(
      'Fri - Optimér vælger',
    )
    expect(specColorFor(COLOR_SPECS.fieldLocked, '1')).toBe(
      COLOR_SPECS.fieldLocked.kind === 'category'
        ? COLOR_SPECS.fieldLocked.bins[0].color
        : null,
    )
  })

  it('have no name for a value that is not a bin', () => {
    expect(describeSpecValue(COLOR_SPECS.fieldLocked, 7)).toBeNull()
    expect(describeSpecValue(COLOR_SPECS.fieldLocked, undefined)).toBeNull()
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
