import { generateTraceId } from './trace'
import type { AccountTier, UserEntitlements } from './entitlements'

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message)
    this.name = 'ApiError'
  }
}

type AuthUser = {
  id: string
  name: string
  avatar?: {
    version: string
    smallUrl: string
    mediumUrl: string
    updatedAt: string
  } | null
  phone?: string | null
  email?: string | null
  accountTier?: AccountTier
  entitlements?: UserEntitlements
}

type AuthStoreAccess = {
  getToken: () => string | null
  getRefreshToken: () => string | null
  getUser: () => AuthUser | null
  login: (token: string, refreshToken: string, user: AuthUser) => void | Promise<void>
  logout: () => void | Promise<void>
}

export type ApiClientOptions = {
  getBaseUrl: () => string
  auth?: AuthStoreAccess
  getRefreshBody?: () => Record<string, unknown>
  /** Desktop may refresh through main so the system-stored token never reaches renderer. */
  refreshAccessToken?: () => Promise<{ token: string; refreshToken?: string; user?: AuthUser }>
  /** Headers enforced on every application API request (but not token refresh). */
  getHeaders?: (path: string) => Record<string, string>
  timeoutMs?: number
}

const DEFAULT_API_TIMEOUT_MS = 15_000

function createTimeoutError(): Error {
  const error = new Error('Request timeout')
  error.name = 'AbortError'
  return error
}

async function fetchWithTimeout(
  input: RequestInfo | URL,
  opts: RequestInit | undefined,
  timeoutMs: number,
): Promise<Response> {
  if (timeoutMs <= 0) return fetch(input, opts)

  const upstreamSignal = opts?.signal
  if (upstreamSignal?.aborted) {
    throw upstreamSignal.reason ?? createTimeoutError()
  }

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(createTimeoutError()), timeoutMs)
  const abortFromUpstream = () => {
    controller.abort(upstreamSignal?.reason ?? createTimeoutError())
  }

  upstreamSignal?.addEventListener('abort', abortFromUpstream, { once: true })

  try {
    return await fetch(input, {
      ...opts,
      signal: controller.signal,
    })
  } finally {
    clearTimeout(timeout)
    upstreamSignal?.removeEventListener('abort', abortFromUpstream)
  }
}

function buildHeaders(
  opts?: RequestInit,
  enforcedHeaders?: Record<string, string>,
): HeadersInit {
  const base: Record<string, string> = {}
  if (opts?.body) base['Content-Type'] = 'application/json'

  base['x-trace-id'] = generateTraceId()

  return {
    ...base,
    ...(opts?.headers as Record<string, string>),
    ...enforcedHeaders,
  }
}

export function createApiClient(options: ApiClientOptions) {
  const timeoutMs = options.timeoutMs ?? DEFAULT_API_TIMEOUT_MS
  let refreshPromise: Promise<{ token: string; refreshToken?: string; user?: AuthUser }> | null = null

  async function refreshAccessToken(
    auth: AuthStoreAccess,
    refreshToken: string,
  ): Promise<{ token: string; refreshToken?: string; user?: AuthUser }> {
    if (!refreshPromise) {
      refreshPromise = (async () => {
        if (options.refreshAccessToken) return options.refreshAccessToken()
        const refreshBody = options.getRefreshBody?.() ?? {}
        const refreshRes = await fetchWithTimeout(`${options.getBaseUrl()}/auth/refresh`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ refreshToken, ...refreshBody }),
        }, timeoutMs)

        if (!refreshRes.ok) {
          const body = await refreshRes.text().catch(() => '')
          if (refreshRes.status === 401 || refreshRes.status === 403) {
            await auth.logout()
            throw new ApiError(401, 'Session expired')
          }
          throw new ApiError(refreshRes.status, body || refreshRes.statusText)
        }

        return refreshRes.json() as Promise<{ token: string; refreshToken?: string; user?: AuthUser }>
      })().finally(() => {
        refreshPromise = null
      })
    }

    return refreshPromise
  }

  async function api<T>(path: string, opts?: RequestInit, requestOptions?: { timeoutMs?: number }): Promise<T> {
    const res = await fetchWithTimeout(`${options.getBaseUrl()}${path}`, {
      ...opts,
      headers: buildHeaders(opts, options.getHeaders?.(path)),
    }, requestOptions?.timeoutMs ?? timeoutMs)
    if (!res.ok) {
      const body = await res.text().catch(() => '')
      throw new ApiError(res.status, body || res.statusText)
    }
    return res.json() as Promise<T>
  }

  async function authApi<T>(path: string, opts?: RequestInit, requestOptions?: { timeoutMs?: number }): Promise<T> {
    const auth = options.auth
    if (!auth) throw new ApiError(401, 'No auth configured')
    const token = auth.getToken()
    if (!token) throw new ApiError(401, 'Not authenticated')

    const doRequest = (accessToken: string) =>
      fetchWithTimeout(`${options.getBaseUrl()}${path}`, {
        ...opts,
        headers: {
          ...buildHeaders(opts, options.getHeaders?.(path)),
          Authorization: `Bearer ${accessToken}`,
        },
      }, requestOptions?.timeoutMs ?? timeoutMs)

    let res = await doRequest(token)

    if (res.status === 401) {
      const refreshToken = auth.getRefreshToken()
      if (!refreshToken) {
        await auth.logout()
        throw new ApiError(401, 'Session expired')
      }

      const data = await refreshAccessToken(auth, refreshToken)
      const user = data.user ?? auth.getUser()
      if (user) await auth.login(data.token, data.refreshToken ?? refreshToken, user)
      res = await doRequest(data.token)
    }

    if (!res.ok) {
      const body = await res.text().catch(() => '')
      if (res.status === 401) await auth.logout()
      throw new ApiError(res.status, body || res.statusText)
    }
    return res.json() as Promise<T>
  }

  return { api, authApi }
}
