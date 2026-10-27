// @arch open-source/docs/wire.md
// @test src/__tests__/instance.test.ts

/** Strict instance origin, not an arbitrary API URL. Never embeds credentials. */
export function normalizeInstanceOrigin(input: string): string {
  const value = input.trim()
  if (!value || /[\s\\]/.test(value)) throw new Error('invalid_instance_origin')
  const candidate = /^[a-z][a-z0-9+.-]*:\/\//i.test(value) ? value : `https://${value}`
  let url: URL
  try { url = new URL(candidate) } catch { throw new Error('invalid_instance_origin') }
  if (
    !['https:', 'http:'].includes(url.protocol) || !url.hostname ||
    url.username || url.password || url.search || url.hash ||
    candidate.includes('?') || candidate.includes('#') ||
    url.pathname !== '/' || /%|@/.test(candidate)
  ) throw new Error('invalid_instance_origin')
  const loopback = url.hostname === 'localhost' || url.hostname === '[::1]' || /^127(?:\.\d{1,3}){3}$/.test(url.hostname)
  if (url.protocol === 'http:' && !loopback) throw new Error('instance_requires_https')
  const authorityAndPath = candidate.slice(candidate.indexOf('://') + 3)
  const pathStart = authorityAndPath.indexOf('/')
  if (pathStart >= 0 && authorityAndPath.slice(pathStart) !== '/') throw new Error('invalid_instance_origin')
  return url.origin
}
