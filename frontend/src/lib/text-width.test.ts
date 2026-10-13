// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'

import { textWidth } from '@/lib/text-width'

describe('textWidth', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('measures in the weight the text is shown in', () => {
    const fonts: string[] = []
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(
      () =>
        ({
          set font(value: string) {
            fonts.push(value)
          },
          measureText: (text: string) => ({ width: text.length * 7 }),
        }) as never,
    )

    expect(textWidth('Mark', 'semibold')).toBe(28)
    expect(textWidth('Mark')).toBe(28)
    expect(fonts.map((font) => font.split(' ')[0])).toEqual(['600', '400'])
  })
})
