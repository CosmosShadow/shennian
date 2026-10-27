// @arch open-source/docs/cli-runtime.md
// @covers open-source/packages/cli/src/runtime-distribution.ts
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { readCliDistribution } from '../runtime-distribution.js'

const roots: string[] = []
function fixture(marker?: unknown) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cli-distribution-'))
  roots.push(root)
  const pkg = path.join(root, 'resources', 'daemon')
  fs.mkdirSync(path.join(pkg, 'dist', 'src'), { recursive: true })
  fs.writeFileSync(path.join(pkg, 'package.json'), JSON.stringify({ name: 'shennian', version: '1.2.3', ...(marker !== undefined ? { shennianDistribution: marker } : {}) }))
  return { root, entry: path.join(pkg, 'dist', 'src', 'runtime-distribution.js') }
}
afterEach(() => { for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true }) })
describe('CLI distribution provenance', () => {
  it('reports every current package as independently owned by Client', () => {
    const { entry } = fixture()
    expect(readCliDistribution(entry)).toEqual({
      source: 'global-cli', cliVersion: '1.2.3', updateOwner: 'cli',
    })
  })
  it('does not restore Desktop ownership from an obsolete package marker', () => {
    const { entry } = fixture({ source: 'desktop-managed', desktopVersion: '2.0.0' })
    expect(readCliDistribution(entry)).toEqual({
      source: 'global-cli', cliVersion: '1.2.3', updateOwner: 'cli',
    })
  })
})
