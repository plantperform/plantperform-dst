import { CROP_YEAR_COVER_CROP_BORDER } from '@/lib/field-domain'

type CropYearSwatchSize = '14x10' | '10x8'

const SIZE_CLASSES: Record<CropYearSwatchSize, string> = {
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
      borderBottom: hasUdlaeg
        ? `3px solid ${CROP_YEAR_COVER_CROP_BORDER}`
        : undefined,
    }}
    aria-hidden={title ? undefined : 'true'}
  />
)
