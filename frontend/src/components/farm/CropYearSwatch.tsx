import { coverCropShadow } from '@/lib/field-domain'

type CropYearSwatchSize = '12x16' | '14x10' | '10x8'

const SIZE_CLASSES: Record<CropYearSwatchSize, string> = {
  '12x16':
    'box-border h-3 w-4 shrink-0 rounded-xs outline-1 -outline-offset-1 outline-foreground/10',
  '14x10': 'box-border h-[14px] w-[10px] shrink-0 rounded-[3px]',
  '10x8': 'h-[10px] w-[8px] shrink-0 rounded-[2px]',
}

type CropYearSwatchProps = {
  color: string
  hasUdlaeg: boolean
  size: CropYearSwatchSize
  title?: string
}

export const CropYearSwatch = ({
  color,
  hasUdlaeg,
  size,
  title,
}: CropYearSwatchProps) => (
  <span
    title={title}
    className={SIZE_CLASSES[size]}
    style={{
      backgroundColor: color,
      boxShadow: coverCropShadow(hasUdlaeg),
    }}
    aria-hidden={title ? undefined : 'true'}
  />
)
