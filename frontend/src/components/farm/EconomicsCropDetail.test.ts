// @vitest-environment jsdom

import { act, createElement, useState } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { EconomicsCropDetail } from '@/components/farm/EconomicsCropDetail'
import { TooltipProvider } from '@/components/ui/tooltip'
import {
  NO_OVERRIDES,
  withPriceOverride,
  type CropEconomics,
  type EconomicsAssumptions,
} from '@/lib/economics'

const ploughed = (cropCode: number, cropName: string): CropEconomics => ({
  cropCode,
  cropName,
  precedingCropValueKgNHa: 0,
  revenue: [],
  subsidies: [],
  costs: {
    fertiliser: [],
    otherFertilisers: [],
    seed: [],
    cropProtection: [],
    fieldWork: [
      {
        id: `${cropCode}/ploughing`,
        label: 'Pløjning med pakning',
        quantity: 1,
        quantityUnit: 'gange',
        quantityId: `${cropCode}/ploughing`,
        priceId: 'ploughing',
        followsYield: false,
      },
    ],
    drying: [],
  },
})

const ASSUMPTIONS: EconomicsAssumptions = {
  soilTypeNumber: 6,
  farmingSystem: 'Konventionel',
  prices: [
    {
      id: 'ploughing',
      label: 'Pløjning med pakning',
      unit: 'kr/gang',
      valueDkk: 825,
      source: 'SEGES Budgetkalkuler 2026 (standardsats)',
    },
  ],
  crops: [
    ploughed(1, 'Vårbyg'),
    ploughed(10, 'Vinterbyg'),
    ploughed(11, 'Vinterhvede'),
  ],
  soilVariants: {},
}
const RESTORE_PLOUGHING = 'Gendan standard for Pløjning med pakning'

let container: HTMLDivElement
let root: Root

const Detail = () => {
  const [overrides, setOverrides] = useState(
    withPriceOverride(ASSUMPTIONS, NO_OVERRIDES, 'ploughing', 1000),
  )
  return createElement(EconomicsCropDetail, {
    assumptions: ASSUMPTIONS,
    overrides,
    crop: ASSUMPTIONS.crops[0],
    onOverridesChange: setOverrides,
  })
}

const findButton = (name: string) =>
  [...container.querySelectorAll('button')].find(
    (button) =>
      button.getAttribute('aria-label') === name || button.textContent === name,
  )

const click = (name: string) => act(async () => findButton(name)!.click())

describe('restoring a shared price', () => {
  beforeEach(async () => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
    container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)
    await act(async () =>
      root.render(createElement(TooltipProvider, null, createElement(Detail))),
    )
    const fieldWork = [...container.querySelectorAll('button')].find((button) =>
      button.textContent?.startsWith('Markarbejde'),
    )
    await act(async () => fieldWork!.click())
  })

  afterEach(async () => {
    await act(async () => root.unmount())
    container.remove()
  })

  it('asks before the row takes the price back for every crop', async () => {
    await click(RESTORE_PLOUGHING)
    expect(container.textContent).toContain('1.000 → 825 kr/gang')
    expect(findButton(RESTORE_PLOUGHING)).toBeDefined()

    await click('Gendan for alle 3')
    expect(findButton(RESTORE_PLOUGHING)).toBeUndefined()
  })

  it('asks before the whole crop takes a shared price back', async () => {
    await click('Gendan standard')
    expect(container.textContent).toContain(
      'Pløjning med pakning er en fælles pris',
    )
    expect(findButton(RESTORE_PLOUGHING)).toBeDefined()

    await click('Gendan for alle 3')
    expect(findButton('Gendan standard')).toBeUndefined()
    expect(findButton(RESTORE_PLOUGHING)).toBeUndefined()
  })
})
