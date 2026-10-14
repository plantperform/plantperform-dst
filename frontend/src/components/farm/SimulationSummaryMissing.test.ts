import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'

import { SimulationSummaryMissing } from '@/components/farm/SimulationSummaryMissing'

describe('missing simulation summary', () => {
  it('explains how to create a summary and offers settings without a loading state', () => {
    const html = renderToStaticMarkup(
      createElement(SimulationSummaryMissing, {
        onOpenSettings: vi.fn(),
      }),
    )
    expect(html).toContain(
      'Simuleringens oversigt mangler. Kør en optimering for at oprette den.',
    )
    expect(html).toContain('Åbn indstillinger')
    expect(html).toContain('role="status"')
    expect(html).not.toContain('disabled=')
    expect(html).not.toContain('aria-busy')
  })

  it('can explain a missing summary on a card without showing an inactive button', () => {
    const html = renderToStaticMarkup(createElement(SimulationSummaryMissing))
    expect(html).toContain('oversigt mangler')
    expect(html).not.toContain('<button')
  })
})
