import type { ViewState } from '@/api/types'

export const isViewPreparing = (view: ViewState | undefined) =>
  view?.status === 'queued' || view?.status === 'running'

export const mergeViewStatus = async <T extends ViewState & { data: unknown }>(
  current: T,
  status: T,
  load: () => Promise<T>,
): Promise<T> => {
  if (
    status.inputRevision < current.inputRevision ||
    status.viewVersion < current.viewVersion
  ) {
    return current
  }
  if (
    status.status === 'done' &&
    (status.viewVersion !== current.viewVersion || current.data === null)
  ) {
    return load()
  }
  return {
    ...status,
    data: status.status === 'done' ? current.data : null,
  }
}
