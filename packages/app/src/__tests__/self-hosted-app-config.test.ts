// @arch open-source/docs/mobile-app.md
// @covers packages/app/app.config.ts
import { readFileSync, mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath, URL } from 'node:url'
import { createRequire } from 'node:module'
import { afterEach, expect, it, vi } from 'vitest'
const require = createRequire(import.meta.url)
const { getConfig } = require('@expo/config')
afterEach(() => vi.unstubAllEnvs())
it('loads the same App in a fresh project with no private / Desktop tree or official build overlay', () => {
  for (const key of ['SHENNIAN_DISTRIBUTION', 'SHENNIAN_APP_COMPOSITION_MODULE']) vi.stubEnv(key, '')
  vi.stubEnv('EXPO_NO_DOTENV', '1'); vi.stubEnv('SHENNIAN_OTA_MODE', 'disabled')
  const repo = fileURLToPath(new URL('../../../../', import.meta.url))
  const parent = path.join(tmpdir(), 'shennian-tests/unit')
  mkdirSync(parent, { recursive: true })
  const root = mkdtempSync(path.join(parent, 'community-app-'))
  try {
    for (const file of ['packages/app/app.config.ts', 'packages/app/app.json', 'open-source/packages/cli/package.json', 'open-source/config/app-profile.cjs', 'open-source/config/ota.cjs']) {
      mkdirSync(path.dirname(path.join(root, file)), { recursive: true })
      writeFileSync(path.join(root, file), readFileSync(path.join(repo, file)))
    }
    writeFileSync(path.join(root, 'package.json'), '{"name":"community-fixture"}')
    writeFileSync(path.join(root, 'packages/app/package.json'), '{"name":"@shennian/app","version":"0.5.1"}')
    const config = getConfig(path.join(root, 'packages/app'), { skipSDKVersionRequirement: true, skipPlugins: true }).exp
    expect(config.updates).toEqual({ enabled: false })
    expect(config.owner).toBeUndefined()
    expect(config.extra?.eas).toBeUndefined()
    expect(config.extra?.productLinks).toBeUndefined()
    expect(config.ios.bundleIdentifier).toBe('net.shennian.community')
    expect(config.ios.appleTeamId).toBeUndefined()
    expect(config.ios.associatedDomains).toBeUndefined()
  } finally { rmSync(root, { recursive: true, force: true }) }
})
