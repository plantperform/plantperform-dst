import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import type { FieldRecord, FieldYearValue } from '@/api/types'
import { FieldYearStrip } from '@/components/farm/FieldYearStrip'
import { TooltipProvider } from '@/components/ui/tooltip'

const year = (dbDkkHa: number, economicsMissing = false) =>
  ({
    dbDkkHa,
    economicsMissing,
    leachingKgNHa: 20,
    feedUnitsPerHa: 0,
    winterCover: {},
  }) as FieldYearValue

const render = (yearValues: FieldYearValue[], quotaEligible: boolean) =>
  renderToStaticMarkup(
    createElement(
      TooltipProvider,
      null,
      createElement(FieldYearStrip, {
        field: {
          quotaEligible,
          retention: 0,
          cropRotation: [
            { cropCode: 11, cropName: 'Vinterhvede', undersownCropName: null },
            { cropCode: 407, cropName: 'Gulerod', undersownCropName: null },
          ],
        } as FieldRecord,
        yearValues,
        startYear: 2027,
        selectedIndex: null,
        onSelect: () => undefined,
      }),
    ),
  )

describe('FieldYearStrip', () => {
  it('shows no DB2 for a year without economics, and averages it as 0 like the mark', () => {
    const markup = render([year(6000), year(0, true)], false)
    expect(markup).toContain('aria-label="2027: Vinterhvede · DB2 6.000 kr/ha"')
    expect(markup).toContain('aria-label="2028: Gulerod · Ingen økonomi"')
    expect(markup).toContain('gns. 3.000')
  })

  it('offers no DB2 when no year of the rotation has economics', () => {
    const markup = render([year(0, true), year(0, true)], true)
    expect(markup).not.toContain('DB2')
    expect(markup).toContain('Udledning')
  })

  it('keeps DB2 when only some years have no economics', () => {
    expect(render([year(6000), year(0, true)], true)).toContain('DB2')
  })
})
