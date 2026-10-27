// @arch open-source/docs/server-runtime.md
// @covers open-source/packages/server/tsconfig.json
// @covers open-source/packages/server/prisma.config.ts
import fs from 'node:fs'
import { describe, expect, it } from 'vitest'
describe('standalone Server build inputs', () => {
  it('has local compiler settings and only sibling public references', () => {
    const config = JSON.parse(fs.readFileSync(new URL('../../tsconfig.json', import.meta.url), 'utf8'))
    expect(config.extends).toBeUndefined()
    expect(config.references).toEqual([{ path: '../wire' }, { path: '../server-extensions' }])
  })
  it('uses the self-hosted formal chain, not private official history', () => {
    const config = fs.readFileSync(new URL('../../prisma.config.ts', import.meta.url), 'utf8')
    expect(config).toContain('../../deploy/self-hosted/prisma/migrations')
    expect(config).not.toContain('private/')
  })
  it('uses formal deploy rather than development schema mutation for migrations', () => {
    const manifest = JSON.parse(fs.readFileSync(new URL('../../package.json', import.meta.url), 'utf8'))
    expect(manifest.scripts['db:migrate']).toBe('prisma migrate deploy')
    expect(manifest.scripts['db:generate']).toContain('generate-prisma.mjs')
  })
})
