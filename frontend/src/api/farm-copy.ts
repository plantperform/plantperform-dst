import useSWR from 'swr'

import { postJson } from '@/api/client'
import type {
  CopyFarmInput,
  Farm,
  FarmCopyLookup,
  FarmCopyPreview,
} from '@/api/types'

export const COPY_CVR = '12345678'

export const useFarmCopyPreview = (input: FarmCopyLookup) =>
  useSWR<FarmCopyPreview>(
    ['/farms/copy/preview', input.cvr, input.name, input.ownerName],
    ([path, cvr, name, ownerName]: [string, '12345678', string, string]) =>
      postJson<FarmCopyPreview, FarmCopyLookup>(path, { cvr, name, ownerName }),
    { revalidateOnFocus: false, shouldRetryOnError: false },
  )

export const copyFarm = (input: CopyFarmInput) =>
  postJson<Farm, CopyFarmInput>('/farms/copy', input)
