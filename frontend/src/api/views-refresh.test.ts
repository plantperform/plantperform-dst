// @vitest-environment jsdom

import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { describe, expect, it, vi } from 'vitest'

import { useRefreshWhenChanged } from '@/api/views'

describe('useRefreshWhenChanged', () => {
  it('refreshes when the signature changes after it has loaded', async () => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
    const refresh = vi.fn()
    const Probe = ({ signature }: { signature: string | null }) => {
      useRefreshWhenChanged(signature, refresh)
      return null
    }
    const root = createRoot(document.createElement('div'))
    const render = (signature: string | null) =>
      act(async () => root.render(createElement(Probe, { signature })))

    await render(null)
    await render('own-1:1')
    expect(refresh).not.toHaveBeenCalled()
    await render('own-1:1')
    await render('own-1:2')
    expect(refresh).toHaveBeenCalledTimes(1)
    root.unmount()
  })
})
