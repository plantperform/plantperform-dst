import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import type { FieldRecord } from '@/api/types'
import { FieldTooltip, type HoveredField } from '@/components/farm/FieldTooltip'
import { emptyMeasures } from '@/lib/field-domain'
import { buildRotationSpec, type ColorAttribute } from '@/lib/map-coloring'
import {
  cropSequenceOf,
  NO_ROTATION_COLOR,
  rotationColorsOf,
  rotationVariantOf,
  summarizeRotationDistribution,
} from '@/lib/rotation-overview'

const field = (rotationId: string | null): FieldRecord => ({
  id: 'f',
  farmId: 'farm',
  imkId: null,
  catchmentId: 7,
  retention: null,
  soilTypeNumber: null,
  cropRotation: [],
  rotationId,
  measures: emptyMeasures(),
  allowedRotationIds: [],
  db2: 0,
  nLoad: 0,
  leaching: 0,
  feedUnits: 0,
  name: 'Mark 1',
  areaHa: 5,
  inTakeoutPlan: '',
  nLoadLimitKgNHa: 0,
  nLoadQuotaKgN: 0,
  quotaEligible: true,
  geometry: null,
})

// The farm has a rotation (999) that is missing from the options.
const shares = summarizeRotationDistribution(
  [field('315:4:80'), field('999:1:80'), field(null)],
  [
    {
      rotationVariant: '315',
      cropSequence: ['Vinterhvede', 'Vårbyg', 'Raps'],
      activeLen: 3,
    },
  ],
)
const colors = rotationColorsOf(shares)
const rotationSpec = buildRotationSpec(shares, colors)

const render = (rotationId: string | null, colorBy: ColorAttribute) => {
  const hovered: HoveredField = {
    longitude: 9,
    latitude: 55,
    primary: 'Mark 1',
    fieldId: 'f',
    properties: {
      rotationVariant:
        rotationId === null ? 'none' : rotationVariantOf(rotationId),
    },
    registry: false,
    hasRotation: rotationId !== null,
    yearCrop: null,
    yearNLoadKgHa: null,
    yearQuotaStatus: null,
  }
  return renderToStaticMarkup(
    createElement(FieldTooltip, {
      hovered,
      field: field(rotationId),
      rotationName: null,
      catchmentLabel: () => 'Opland',
      colorBy,
      rotationSpec,
      rotationCropSequence: cropSequenceOf(rotationId, shares),
      isSimulationView: true,
      selectedCalendarYear: null,
      yearValuesLoading: false,
    }),
  )
}

describe('FieldTooltip with the Sædskifte colouring', () => {
  it('shows the number of the sædskifte and its crops in the order of the years', () => {
    const html = render('315:4:80', 'rotation')
    expect(html).toContain('Sædskifte 315')
    expect(html).toContain('1. Vinterhvede')
    expect(html).toContain('2. Vårbyg')
    expect(html).toContain('3. Raps')
    expect(html.indexOf('1. Vinterhvede')).toBeLessThan(
      html.indexOf('2. Vårbyg'),
    )
  })

  it('shows the colour of the sædskifte beside its number', () => {
    expect(render('315:4:80', 'rotation')).toContain(
      `background-color:${colors.get('315')}`,
    )
  })

  it('names the sædskifte once, not in a row of its own as well', () => {
    const html = render('315:4:80', 'rotation')
    expect(html.split('Sædskifte 315')).toHaveLength(2)
    expect(html).not.toContain('ingen værdi')
  })

  it('shows a field without a sædskifte in the grey and without crops', () => {
    const html = render(null, 'rotation')
    expect(html).toContain('Uden sædskifte')
    expect(html).toContain(`background-color:${NO_ROTATION_COLOR}`)
    expect(html).not.toContain('→')
  })

  it('shows the number but no crops when the rotation is not among the options', () => {
    const html = render('999:1:80', 'rotation')
    expect(html).toContain('Sædskifte 999')
    expect(html).not.toContain('1. ')
  })
})

describe('FieldTooltip with another colouring', () => {
  it('leaves the sædskifte out', () => {
    const html = render('315:4:80', 'retention')
    expect(html).not.toContain('Sædskifte 315')
    expect(html).not.toContain('1. Vinterhvede')
  })
})
