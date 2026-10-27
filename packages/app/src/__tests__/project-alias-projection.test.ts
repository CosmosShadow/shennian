// @covers packages/app/src/features/projects/utils/projectAliasProjection.ts
import { describe, expect, it } from 'vitest'
import type { NianProject } from '@shennian/wire'
import { projectAliasProjection } from '../features/projects/utils/projectAliasProjection'

const alias: NianProject = {
  id: 'alias', machineId: 'mac', machineName: 'Test', machineOnline: true,
  workDir: '~', displayName: '~', createdAt: '2026-09-01', updatedAt: '2026-09-01', lastActivityAt: '2026-09-01',
  defaultAgentType: 'claude', defaultModelId: 'sonnet',
}
const canonical: NianProject = {
  ...alias, id: 'canonical', workDir: '/Users/actual', displayName: 'actual',
  defaultAgentType: 'opencode', defaultModelId: 'flash',
}
const prefs = { 'user\u0000mac:~': { resolvedProject: { id: canonical.id, workDir: canonical.workDir } } }

describe('verified project alias projection', () => {
  it('shows one canonical project without mutating either record or defaults', () => {
    const records = [alias, canonical]
    const before = JSON.stringify(records)
    expect(projectAliasProjection(records, 'user', prefs)).toEqual([canonical])
    expect(JSON.stringify(records)).toBe(before)
    expect(alias.defaultModelId).toBe('sonnet')
    expect(canonical.defaultModelId).toBe('flash')
  })
  it('does not guess a home directory from a username or directory name', () => {
    expect(projectAliasProjection([alias, canonical], 'user', {})).toEqual([alias, canonical])
  })
  it.each(['other-user', ''])('never reuses another account mapping (%s)', (user) => {
    expect(projectAliasProjection([alias, canonical], user, prefs)).toEqual([alias, canonical])
  })
  it('preserves the alias if its target was removed or access was revoked', () => {
    expect(projectAliasProjection([alias], 'user', prefs)).toEqual([alias])
  })
  it('does not match another machine or a changed target path', () => {
    for (const target of [{ ...canonical, machineId: 'other' }, { ...canonical, workDir: '/Users/changed' }]) {
      expect(projectAliasProjection([alias, target], 'user', prefs)).toEqual([alias, target])
    }
  })
  it('retains unrelated absolute-path projects and works with a persisted offline mapping', () => {
    const other = { ...canonical, id: 'repo', workDir: '/Users/actual/repo' }
    const records = [alias, { ...canonical, machineOnline: false }, other]
    expect(projectAliasProjection(records, 'user', JSON.parse(JSON.stringify(prefs)))).toEqual(records.slice(1))
  })
})
