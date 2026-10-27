// @arch open-source/docs/cli-runtime.md
// @covers open-source/packages/cli/package.json
// @covers open-source/packages/cli/tsconfig.json
import fs from 'node:fs'
import { describe, expect, it } from 'vitest'

describe('standalone CLI source build', () => {
  const manifest = JSON.parse(fs.readFileSync(new URL('../../package.json', import.meta.url), 'utf8'))
  const config = JSON.parse(fs.readFileSync(new URL('../../tsconfig.json', import.meta.url), 'utf8'))

  it('does not inherit compiler inputs outside the public workspace', () => {
    expect(config.extends).toBeUndefined()
    expect(config.references).toEqual([{ path: '../wire' }])
    expect(config.exclude).toEqual(expect.arrayContaining(['src/__tests__/**', 'src/__experiments__/**']))
  })

  it('removes stale output and includes adapter resources without private build scripts', () => {
    expect(manifest.scripts.build).toContain("rmSync('dist', { recursive: true, force: true })")
    expect(manifest.scripts.build).toContain('tsc')
    expect(manifest.scripts.build).toContain('node scripts/copy-agent-adapter-docs.mjs')
    expect(manifest.scripts.build).not.toMatch(/private|\.\.\//)
  })
})
