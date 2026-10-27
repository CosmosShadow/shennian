// @arch open-source/docs/cli-runtime.md
// @test src/__tests__/config.test.ts

export type Region = 'cn' | 'global'

export const SERVERS: Record<Region, { url: string; label: string }> = {
  cn:     { url: 'https://shennian.net', label: 'China  (shennian.net)' },
  // Keep the historical key so old configs and protocol payloads remain
  // compatible. Production is single-domain and resolves both keys to cn.
  global: { url: 'https://shennian.net', label: 'China  (shennian.net)' },
}

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
    const data = await res.json() as { country?: string }
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

/**
 * Detect the best server region and return its URL.
 *
 * Strategy: timezone as primary signal, IP geolocation as supplement.
 * - Chinese timezone → cn immediately (covers servers with UTC too via IP fallback).
 * - Non-Chinese timezone → try IP to detect if physically in China.
 */
export async function detectAndChooseServer(): Promise<string> {
  console.log('  Detecting best server...')

  const tzRegion = inferRegionByTimezone()

  if (tzRegion === 'cn') {
    const reachable = await verifyReachable(SERVERS.cn.url)
    if (reachable) {
      console.log(`  Using ${SERVERS.cn.label} (timezone: China)`)
      return SERVERS.cn.url
    }
    console.error('  Error: cannot reach any server.')
    process.exit(1)
  }

  // Non-CN timezone: check IP to catch servers in China with UTC timezone
  const ipRegion = await detectRegionByIP()
  const region = ipRegion ?? tzRegion

  const reachable = await verifyReachable(SERVERS[region].url)
  if (reachable) {
    const source = ipRegion ? 'IP geolocation' : 'timezone'
    console.log(`  Using ${SERVERS[region].label} (${source})`)
    return SERVERS[region].url
  }

  console.error('  Error: cannot reach any server.')
  process.exit(1)
}

export function urlToRegion(url: string): Region {
  return url.includes('shennian.net') ? 'cn' : 'global'
}

export function regionToUrl(region: Region): string {
  return SERVERS[region].url
}
