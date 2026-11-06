// Select credentials once per document, without shared storage or cookies.
const fragment = new URLSearchParams(
  typeof window === 'undefined' ? '' : window.location.hash.slice(1),
)
export const isEmbed = fragment.has('key')
const embedKey = fragment.get('key')

export const getEmbedKey = () =>
  embedKey && /^pp_embed_[A-Za-z0-9_-]{43}$/.test(embedKey) ? embedKey : null

export const preserveEmbedKey = () => {
  if (embedKey === null) return
  const url = new URL(window.location.href)
  url.hash = new URLSearchParams({ key: embedKey }).toString()
  window.history.replaceState(window.history.state, '', url)
}
