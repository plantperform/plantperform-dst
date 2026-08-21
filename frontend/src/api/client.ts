export const API_BASE = '/api/v0'

type FastApiValidationError = {
  loc?: (string | number)[]
  msg?: string
  type?: string
  ctx?: Record<string, unknown>
}

// Pydantic's own validation-error `type` codes, translated to Danish. Built
// from `type`/`ctx` rather than translating the English `msg` string, since
// `ctx` carries the actual limit value (e.g. {le: 120}) needed to phrase it.
const describeValidationError = (item: FastApiValidationError): string | undefined => {
  const ctx = item.ctx ?? {}
  switch (item.type) {
    case 'missing':
      return 'skal udfyldes'
    case 'less_than_equal':
      return `skal være mindre end eller lig med ${ctx.le}`
    case 'greater_than_equal':
      return `skal være større end eller lig med ${ctx.ge}`
    case 'less_than':
      return `skal være mindre end ${ctx.lt}`
    case 'greater_than':
      return `skal være større end ${ctx.gt}`
    case 'string_too_short':
      return `skal være mindst ${ctx.min_length} tegn`
    case 'string_too_long':
      return `må højst være ${ctx.max_length} tegn`
    case 'int_type':
    case 'int_parsing':
      return 'skal være et helt tal'
    case 'float_type':
    case 'float_parsing':
      return 'skal være et tal'
    case 'string_type':
      return 'skal være tekst'
    case 'bool_type':
    case 'bool_parsing':
      return 'skal være sand/falsk'
    case 'value_error':
      // Our own domain ValueError messages are already Danish — Pydantic
      // just prefixes them with "Value error, ".
      return item.msg?.replace(/^Value error,\s*/, '')
    default:
      return item.msg
  }
}

// FastAPI's own automatic request-validation errors (as opposed to a route's
// own `HTTPException(detail="...")`) return `detail` as an array of
// {loc, msg, type} objects, not a string — stringifying that array directly
// (e.g. via `new Error(detail)`) renders as "[object Object]" in the UI.
const formatErrorDetail = (detail: unknown): string => {
  if (typeof detail === 'string') return detail

  if (Array.isArray(detail)) {
    const messages = detail
      .map((item: FastApiValidationError) => {
        const loc = item.loc?.filter((part) => part !== 'body').join('.')
        const description = describeValidationError(item)
        return loc && description ? `${loc}: ${description}` : description
      })
      .filter((message): message is string => Boolean(message))
    if (messages.length > 0) return messages.join('\n')
  }

  if (detail && typeof detail === 'object') {
    try {
      return JSON.stringify(detail)
    } catch {
      // Fall through to the generic status message.
    }
  }

  return ''
}

const getErrorMessage = async (response: Response) => {
  try {
    const body = (await response.json()) as { detail?: unknown }
    const message = formatErrorDetail(body.detail)
    if (message) return message
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
