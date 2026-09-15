import type { CSSProperties } from 'react'

import type { CropGroupPattern } from '@/lib/crop-groups'
import { coverCropShadow } from '@/lib/field-domain'
import { cn } from '@/lib/utils'

export type CropYearSwatchSize = '12x16' | '8x12' | '14x10' | '10x8'

const SIZE_CLASSES: Record<CropYearSwatchSize, string> = {
  '12x16':
    'box-border h-3 w-4 shrink-0 rounded-xs outline-1 -outline-offset-1 outline-foreground/10',
  '8x12':
    'box-border h-2 w-3 shrink-0 rounded-xs outline-1 -outline-offset-1 outline-foreground/10',
  '14x10': 'box-border h-[14px] w-[10px] shrink-0 rounded-[3px]',
  '10x8': 'h-[10px] w-[8px] shrink-0 rounded-[2px]',
}

const PATTERN_STYLES: Record<CropGroupPattern, CSSProperties> = {
  solid: {},
  stripes: {
    backgroundImage:
      'repeating-linear-gradient(135deg, rgba(255, 255, 255, 0.55) 0 1px, transparent 1px 3px)',
  },
  dots: {
    backgroundImage:
      'radial-gradient(rgba(255, 255, 255, 0.65) 0.7px, transparent 0.8px)',
    backgroundSize: '3px 3px',
  },
}

type CropYearSwatchProps = {
  color: string
  pattern?: CropGroupPattern
  hasUdlaeg: boolean
  size: CropYearSwatchSize
  title?: string
  className?: string
}

export const CropYearSwatch = ({
  color,
  pattern = 'solid',
  hasUdlaeg,
  size,
  title,
  className,
}: CropYearSwatchProps) => (
  <span
    title={title}
    className={cn(SIZE_CLASSES[size], className)}
    style={{
      backgroundColor: color,
      boxShadow: coverCropShadow(hasUdlaeg),
      ...PATTERN_STYLES[pattern],
    }}
    aria-hidden={title ? undefined : 'true'}
  />
)
