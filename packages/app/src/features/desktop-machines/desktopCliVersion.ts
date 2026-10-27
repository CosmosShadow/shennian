// @arch docs/architecture/desktop/unified-desktop.md
// @test ../../__tests__/desktop-cli-version.test.ts

/** Desktop never substitutes a renderer registry request for the main-process lookup. */
export async function fetchDesktopCliVersion(): Promise<string> {
  const app = typeof window === 'undefined' ? undefined : (window as Window & {
    shennianDesktop?: { app?: { getLatestCliVersion?: () => Promise<unknown> } }
  }).shennianDesktop?.app
  if (typeof app?.getLatestCliVersion !== 'function') {
    throw new Error('Desktop CLI release bridge is unavailable')
  }
  const result = await app.getLatestCliVersion()
  if (!result || typeof result !== 'object' || !('ok' in result) || result.ok !== true ||
      !('value' in result) || !result.value || typeof result.value !== 'object' ||
      !('version' in result.value)) throw new Error('Desktop CLI release lookup failed')
  const version = result.value.version
  if (typeof version !== 'string' || version.length > 128 ||
      !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/.test(version)) {
    throw new Error('Desktop CLI release response is invalid')
  }
  return version
}
