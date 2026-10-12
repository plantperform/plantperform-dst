import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import type { Simulation } from '@/api/types'
import { SimulationCreationStatus } from '@/components/farm/SimulationCreationStatus'

const simulation = (
  status: 'queued' | 'running' | 'failed',
): Simulation => ({
  id: 'simulation',
  farmId: 'farm',
  name: 'New simulation',
  createdAt: '2026-10-09',
  revision: 0,
  result: {
    status: 'not_started',
    runId: null,
    kind: null,
    inputRevision: null,
    resultRevision: null,
    queuedAt: null,
    startedAt: null,
    finishedAt: null,
    error: null,
  },
  constraints: {
    maxNLoadByCatchment: [],
    minFeedUnits: null,
    maxFeedUnits: null,
    maxFieldsWithNewRotation: null,
    cropPercentages: [],
    cropAreaLimits: [],
    globallyAllowedRotationIds: null,
  },
  rotationVariants: [],
  nNormPercentages: [],
  fertiliser: {
    farmingSystem: 'Konventionel',
    orgMineralN: 0,
    mineralSharePct: 70,
    onlyOrganic: false,
    nContentKgPerTon: 6,
  },
  catchCropSowingDate: '20/8',
  catchCropDailyBasis: false,
  precisionFarming: false,
  earlySowing: true,
  intermediateCrop: true,
  creationStatus: status,
})

describe('SimulationCreationStatus', () => {
  it('shows creation status while the browser can be closed', () => {
    for (const status of ['queued', 'running'] as const) {
      const html = renderToStaticMarkup(
        createElement(SimulationCreationStatus, {
          farmId: 'farm',
          simulation: simulation(status),
        }),
      )
      expect(html).toContain('role="status"')
      expect(html).toContain('Opretter simulering…')
      expect(html).toContain('Du kan lukke siden.')
      expect(html).not.toContain('Prøv igen')
    }
  })

  it('shows a generic failure, an unchecked optimization choice, and Retry', () => {
    const html = renderToStaticMarkup(
      createElement(SimulationCreationStatus, {
        farmId: 'farm',
        simulation: simulation('failed'),
      }),
    )
    expect(html).toContain('role="alert"')
    expect(html).toContain('Kunne ikke oprette simuleringen.')
    expect(html).toContain('type="checkbox"')
    expect(html).toContain('Optimér, når simuleringen er klar')
    expect(html).not.toContain('checked=""')
    expect(html).toContain('<button')
    expect(html).not.toContain('disabled=')
  })
})
