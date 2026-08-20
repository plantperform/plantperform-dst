export const API_BASE = '/api/v0'

const getErrorMessage = async (response: Response) => {
  try {
    const body = (await response.json()) as { detail?: string }
    if (body.detail) return body.detail
  } catch {
    // Fall through to the generic status message.
  }

  return `API-kald fejlede med status ${response.status}`
}

export const fetcher = async <T>(path: string): Promise<T> => {
  const response = await fetch(`${API_BASE}${path}`)

  if (!response.ok) {
    throw new Error(await getErrorMessage(response))
  }

  return response.json() as Promise<T>
}

export const postJson = async <TResponse, TBody>(
  path: string,
  body: TBody,
): Promise<TResponse> => {
  const response = await fetch(`${API_BASE}${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  })

  if (!response.ok) {
    throw new Error(await getErrorMessage(response))
  }

  return response.json() as Promise<TResponse>
}

export const patchJson = async <TResponse, TBody>(
  path: string,
  body: TBody,
): Promise<TResponse> => {
  const response = await fetch(`${API_BASE}${path}`, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  })

  if (!response.ok) {
    throw new Error(await getErrorMessage(response))
  }

  return response.json() as Promise<TResponse>
}

export const deleteJson = async (path: string): Promise<void> => {
  const response = await fetch(`${API_BASE}${path}`, {
    method: 'DELETE',
  })

  if (!response.ok) {
    throw new Error(await getErrorMessage(response))
  }
}
