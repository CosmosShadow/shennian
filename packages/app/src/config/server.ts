// @arch docs/architecture/deployment.md
// @test src/__tests__/server-config.test.ts

import { Platform } from 'react-native'
import AsyncStorage from '@react-native-async-storage/async-storage'
import { normalizeInstanceOrigin } from '@shennian/wire'

export type Region = 'cn' | 'global'

export const SERVERS = {
  cn:     { url: 'https://shennian.net', host: 'shennian.net' },
  // Keep the historical key so old cached configs and protocol payloads remain
  // compatible. Production is single-domain and resolves both keys to cn.
  global: { url: 'https://shennian.net', host: 'shennian.net' },
} as const

export const PUBLIC_SITE_URL = 'https://shennian.net'
export const WEB_APP_URL = 'https://app.shennian.net'

const STORAGE_KEY = 'shennian:server'
const CACHE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000
// Expo only guarantees build-time substitution for a direct EXPO_PUBLIC member read.
// Keep it at module scope so exported Web E2E bundles cannot silently fall back to production.
const SERVER_OVERRIDE_URL = process.env.EXPO_PUBLIC_SHENNIAN_SERVER_URL

function getServerOverrideUrl(): string | undefined {
  const value = SERVER_OVERRIDE_URL?.trim()
  if (!value) return undefined
  if (isLocalDevServerUrl(value) && !canUseLocalServerOverride()) return undefined
  return value
}

function isLocalDevServerUrl(value: string): boolean {
  try {
    const { hostname } = new URL(value)
    return (
      hostname === 'localhost' ||
      hostname === '127.0.0.1' ||
      hostname.startsWith('192.168.') ||
      hostname.startsWith('10.') ||
      /^172\.(1[6-9]|2\d|3[0-1])\./.test(hostname)
    )
  } catch {
    return false
  }
}

function canUseLocalServerOverride(): boolean {
  if (typeof __DEV__ !== 'undefined' && __DEV__) return true
  const nodeEnv = process.env.NODE_ENV
  if (nodeEnv === 'development' || nodeEnv === 'test') return true

  if (Platform.OS === 'web' && typeof window !== 'undefined') {
    const host = window.location.hostname
    return (
      host === 'localhost' ||
      host === '127.0.0.1' ||
      host.startsWith('192.168.') ||
      host.startsWith('10.') ||
      /^172\.(1[6-9]|2\d|3[0-1])\./.test(host)
    )
  }

  return false
}

interface ServerConfig {
  resolvedUrl: string
  region: Region
  detectedAt: number
  source: 'timezone' | 'ip' | 'manual'
  instanceId?: string
}

let config: ServerConfig | null = null
let loadPromise: Promise<void> | null = null

function normalizeServerConfig(parsed: ServerConfig): ServerConfig {
  if (parsed.source === 'manual') {
    if (!/^[a-zA-Z0-9_-]{16,128}$/.test(parsed.instanceId ?? '')) throw new Error('invalid_instance')
    return { ...parsed, resolvedUrl: normalizeInstanceOrigin(parsed.resolvedUrl) }
  }
  return { ...parsed, resolvedUrl: SERVERS.cn.url, region: 'cn' }
}

// --------------- storage adapter ---------------

let storage: {
  getItem(key: string): Promise<string | null>
  setItem(key: string, value: string): Promise<void>
}

if (Platform.OS === 'web') {
  storage = {
    getItem: async (k) => localStorage.getItem(k),
    setItem: async (k, v) => { localStorage.setItem(k, v) },
  }
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) {
      const parsed = JSON.parse(raw)
      if (parsed.region && parsed.resolvedUrl) config = normalizeServerConfig(parsed)
    }
  } catch { /* noop */ }
} else {
  const AS = AsyncStorage
  storage = {
    getItem: (k: string) => AS.getItem(k),
    setItem: (k: string, v: string) => AS.setItem(k, v),
  }
}

// --------------- region inference ---------------

const CN_TIMEZONES = [
  'Asia/Shanghai', 'Asia/Chongqing', 'Asia/Chungking',
  'Asia/Harbin', 'Asia/Urumqi', 'PRC',
]

function inferRegionByTimezone(): Region {
  try {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone
    if (CN_TIMEZONES.includes(tz)) return 'cn'
  } catch { /* Intl unavailable */ }
  return 'cn'
}

async function detectRegionByIP(timeoutMs = 1500): Promise<Region | null> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const res = await fetch(`${SERVERS.cn.url}/geo`, { signal: controller.signal })
    const data = await res.json()
    return data.country === 'CN' ? 'cn' : 'cn'
  } catch {
    return null
  } finally {
    clearTimeout(timer)
  }
}

async function verifyReachable(url: string, timeoutMs = 3000): Promise<boolean> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    await fetch(`${url}/health`, { signal: controller.signal })
    return true
  } catch {
    return false
  } finally {
    clearTimeout(timer)
  }
}

// --------------- internal ---------------

function isCacheValid(): boolean {
  if (!config) return false
  return (Date.now() - config.detectedAt) < CACHE_MAX_AGE_MS
}

function buildConfig(region: Region, source: 'timezone' | 'ip'): ServerConfig {
  return {
    resolvedUrl: SERVERS[region].url,
    region,
    detectedAt: Date.now(),
    source,
  }
}

async function save(cfg: ServerConfig): Promise<void> {
  await storage.setItem(STORAGE_KEY, JSON.stringify(cfg))
  config = cfg
}

// --------------- public API ---------------

export function getServerUrl(): string {
  if (config?.source === 'manual') return config.resolvedUrl
  const overrideUrl = getServerOverrideUrl()
  if (overrideUrl) return overrideUrl

  if (Platform.OS === 'web' && typeof window !== 'undefined') {
    const host = window.location.hostname
    if (host.endsWith('shennian.net')) return SERVERS.cn.url
    if (host.endsWith('shennian.ai')) return SERVERS.cn.url
  }
  return config?.resolvedUrl ?? SERVERS[inferRegionByTimezone()].url
}

export function getPublicSiteUrl(): string {
  if (config?.source === 'manual') return config.resolvedUrl
  if (Platform.OS === 'web' && typeof window !== 'undefined' && isLocalDevServerUrl(window.location.origin)) {
    return window.location.origin
  }
  return PUBLIC_SITE_URL
}

export function getWebAppUrl(): string {
  if (config?.source === 'manual') return config.resolvedUrl
  if (Platform.OS === 'web' && typeof window !== 'undefined' && isLocalDevServerUrl(window.location.origin)) {
    return window.location.origin
  }
  return WEB_APP_URL
}

export function isCanonicalWebAppHost(): boolean {
  return Platform.OS === 'web' && typeof window !== 'undefined' && window.location.hostname === 'app.shennian.net'
}

export function getDocsUrl(): string {
  const base = getServerUrl().replace(/\/+$/, '')
  return `${base}/docs`
}

export function getDetectedRegion(): Region {
  return config?.region ?? inferRegionByTimezone()
}

export function loadServerConfig(): Promise<void> {
  if (loadPromise) return loadPromise
  loadPromise = (async () => {
    try {
      const raw = await storage.getItem(STORAGE_KEY)
      if (raw) {
        const parsed = JSON.parse(raw)
        if (parsed.region && parsed.resolvedUrl) config = normalizeServerConfig(parsed)
        for (const listener of serverListeners) listener()
      }
    } catch { /* use default */ }
  })()
  return loadPromise
}

/**
 * Region detection: timezone as primary, IP as supplement.
 *
 * - Chinese timezone → cn immediately, no network request needed.
 * - Non-Chinese timezone → use timezone default, then async IP check to
 *   correct (e.g. foreigner in China with non-CN timezone).
 * - Cached result used directly if fresh (< 7 days).
 */
export async function ensureDetected(): Promise<void> {
  if (getServerOverrideUrl() || config?.source === 'manual') return

  await loadPromise
  if (Platform.OS === 'web' && typeof window !== 'undefined') {
    const host = window.location.hostname
    if (host.endsWith('shennian.net') || host.endsWith('shennian.ai')) return
  }

  if (isCacheValid()) return

  const tzRegion = inferRegionByTimezone()

  if (tzRegion === 'cn') {
    const reachable = await verifyReachable(SERVERS.cn.url)
    if (reachable) {
      await save(buildConfig('cn', 'timezone'))
    }
    return
  }

  // Historical region detection remains for compatibility; production is cn.
  await save(buildConfig(tzRegion, 'timezone'))

  const ipRegion = await detectRegionByIP()
  if (ipRegion && ipRegion !== tzRegion) {
    const reachable = await verifyReachable(SERVERS[ipRegion].url)
    if (reachable) {
      await save(buildConfig(ipRegion, 'ip'))
    }
  }
}

export type ProbeResult = {
  region: Region
  url: string
  latencyMs: number | null
}

// Eagerly load on native
if (Platform.OS !== 'web') {
  loadServerConfig()
}

let activeLoginAttempts = 0
export function beginLoginServerUse() {
  activeLoginAttempts++
  let released = false
  return () => { if (!released) { released = true; activeLoginAttempts-- } }
}
const serverListeners = new Set<() => void>()
export function subscribeServerSelection(listener: () => void) {
  serverListeners.add(listener)
  return () => { serverListeners.delete(listener) }
}
export function getServerSelectionKey() { return `${getServerUrl()}#${config?.instanceId ?? ''}` }
export function isSelfHostedSelection() { return config?.source === 'manual' }
export function getAuthStorageKey(key: string) {
  return isSelfHostedSelection() ? `${key}:instance:${encodeURIComponent(config!.resolvedUrl)}:${config!.instanceId}` : key
}
export async function lockServerBinding() {
  await storage.setItem('shennian:instance-binding', getServerSelectionKey())
}
export async function selectLoginServer(input: string | null) {
  await loadServerConfig()
  const origin = input === null ? SERVERS.cn.url : normalizeInstanceOrigin(input)
  const binding = await storage.getItem('shennian:instance-binding')
  // Safe rebinding of existing caches is not implemented: require a fresh installation.
  if (binding && !binding.startsWith(`${origin}#`)) throw new Error('instance_already_bound')
  let next: ServerConfig = buildConfig('cn', 'timezone')
  if (input !== null) {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 8000)
    try {
      const response = await fetch(`${origin}/public/instance`, { signal: controller.signal, redirect: 'error', credentials: 'omit' })
      if (!response.ok || (response.url && new URL(response.url).origin !== origin)) throw new Error('instance_unavailable')
      const discovery = await response.json()
      if (discovery.schemaVersion !== 1 || discovery.mode !== 'self-hosted' || !/^[a-zA-Z0-9_-]{16,128}$/.test(discovery.instanceId) || discovery.auth?.password !== true) throw new Error('invalid_instance')
      next = { resolvedUrl: origin, region: 'cn', source: 'manual', instanceId: discovery.instanceId, detectedAt: Date.now() }
      if (binding && binding !== `${origin}#${discovery.instanceId}`) throw new Error('instance_identity_changed')
    } finally { clearTimeout(timer) }
  }
  if (activeLoginAttempts) throw new Error('instance_login_in_progress')
  await save(next)
  for (const listener of serverListeners) listener()
}
