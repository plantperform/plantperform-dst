const FONT_WEIGHTS = { normal: 400, semibold: 600 }

type FontWeight = keyof typeof FONT_WEIGHTS

const contexts = new Map<FontWeight, CanvasRenderingContext2D | null>()

const measuringContext = (weight: FontWeight) => {
  if (!contexts.has(weight)) {
    const context = document.createElement('canvas').getContext('2d')
    if (context) {
      const { fontSize, fontFamily } = getComputedStyle(document.body)
      context.font = `${FONT_WEIGHTS[weight]} ${fontSize} ${fontFamily}`
    }
    contexts.set(weight, context)
  }
  return contexts.get(weight)
}

export const textWidth = (
  text: string,
  weight: FontWeight = 'normal',
): number => measuringContext(weight)?.measureText(text).width ?? text.length
