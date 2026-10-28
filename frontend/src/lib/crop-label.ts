import type { CropCodeOption, RotationYear } from '@/api/types'

// A crop's full name with its afgrødekode in front, e.g. "210 - Vårbyg,
// helsæd". A missing or non-positive code means the code is unknown, and the
// name stands alone.
export const cropLabel = (
  cropCode: number | null | undefined,
  cropName: string,
): string =>
  cropCode !== null && cropCode !== undefined && cropCode > 0
    ? `${cropCode} - ${cropName}`
    : cropName

// Constraints and settings refer to a crop by its afgrødekode only, so the
// name is looked up. A code without a name is shown as "Afgrøde <kode>".
export const cropLabelByCode = (
  cropCode: number,
  cropCodes: readonly CropCodeOption[],
): string => {
  const cropName = cropCodes.find(({ code }) => code === cropCode)?.name
  return cropName !== undefined
    ? cropLabel(cropCode, cropName)
    : `Afgrøde ${cropCode}`
}

// The chosen crops of a simulation are stored as crop
// names, so the afgrødekode is looked up by name. Names in the rotation
// categories and in the crop codes both come from the NUAR table, so a name
// has at most one code.
export const cropCodeByName = (
  cropName: string,
  cropCodes: readonly CropCodeOption[],
): number | undefined => cropCodes.find(({ name }) => name === cropName)?.code

// A name that is not among the crop codes is shown alone.
export const cropLabelByName = (
  cropName: string,
  cropCodes: readonly CropCodeOption[],
): string => cropLabel(cropCodeByName(cropName, cropCodes), cropName)

// One year's crop, followed by the undersown/catch crop in parentheses when
// that year has one. Both carry their afgrødekode.
export const rotationYearLabel = (year: RotationYear): string => {
  const crop = cropLabel(year.cropCode, year.cropName)
  return year.undersownCropName
    ? `${crop} (${cropLabel(year.undersownCropCode, year.undersownCropName)})`
    : crop
}
