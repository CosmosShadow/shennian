// @arch docs/architecture/session-organization.md
// @covers packages/app/src/features/projects/utils/projectPrefs.ts
// @covers packages/app/src/features/projects/utils/mobileProjectOrder.ts

import { afterEach, describe, expect, it, vi } from 'vitest'
import { orderMobileProjects } from '../features/projects/utils/mobileProjectOrder'

function resetProjectPrefsTestContext() {
  vi.resetModules()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
}

async function importWebProjectPrefs(store = new Map<string, string>()) {
  vi.doMock('react-native', () => ({
    Platform: { OS: 'web' },
  }))
  vi.stubGlobal('localStorage', {
    getItem: vi.fn((key: string) => store.get(key) ?? null),
    setItem: vi.fn((key: string, value: string) => {
      store.set(key, value)
    }),
  })

  return {
    module: await import('../features/projects/utils/projectPrefs'),
    store,
  }
}

async function importNativeProjectPrefs(store = new Map<string, string>()) {
  const getItem = vi.fn(async (key: string) => store.get(key) ?? null)
  const setItem = vi.fn(async (key: string, value: string) => {
    store.set(key, value)
  })

  vi.doMock('react-native', () => ({
    Platform: { OS: 'ios' },
  }))
  vi.doMock('@react-native-async-storage/async-storage', () => ({
    default: { getItem, setItem },
  }))

  return {
    module: await import('../features/projects/utils/projectPrefs'),
    getItem,
  }
}

afterEach(() => {
  resetProjectPrefsTestContext()
})

describe('project prefs', () => {
  it('persists project pinning without exposing a home-view switch', async () => {
    const { module, store } = await importWebProjectPrefs()

    module.setProjectPinned('machine:/project', true)
    expect(module.isProjectPinned('machine:/project')).toBe(true)
    expect(store.has('shennian:projectPrefs')).toBe(true)
    expect(module).not.toHaveProperty('getHomeViewModeSnapshot')
    expect(module).not.toHaveProperty('setHomeViewMode')
  })

  it('ignores the retired native home-view preference during hydration', async () => {
    const { module, getItem } = await importNativeProjectPrefs()

    await module.hydrateProjectPrefs()

    expect(getItem).toHaveBeenCalledWith('shennian:projectPrefs')
    expect(getItem).not.toHaveBeenCalledWith('shennian:homeViewMode')
  })

})

describe('mobile project ordering', () => {
  it('puts all pinned projects first by newest pin, then groups regular projects by machine', () => {
    const projects = [
      { key: 'b-pinned', machineId: 'b' },
      { key: 'a-pinned', machineId: 'a' },
      { key: 'b-regular', machineId: 'b' },
      { key: 'a-regular', machineId: 'a' },
    ]
    const pinnedAt: Record<string, string> = {
      'a-pinned': '2026-09-17T10:00:00.000Z',
      'b-pinned': '2026-09-17T11:00:00.000Z',
    }
    expect(
      orderMobileProjects(projects, ['a', 'b'], (project) => pinnedAt[project.key])
        .map((item) => item.key),
    )
      .toEqual(['b-pinned', 'a-pinned', 'a-regular', 'b-regular'])
  })

  it('keeps delayed inventory projects grouped in first-seen machine order', () => {
    const projects = [
      { key: 'unknown-1', machineId: 'unknown' },
      { key: 'known', machineId: 'known' },
      { key: 'other', machineId: 'other' },
      { key: 'unknown-2', machineId: 'unknown' },
    ]
    expect(orderMobileProjects(projects, ['known'], () => null).map((item) => item.key))
      .toEqual(['known', 'unknown-1', 'unknown-2', 'other'])
  })

  it('returns an unpinned project to its normal machine group', () => {
    const projects = [
      { key: 'b-recent', machineId: 'b' },
      { key: 'a-recent', machineId: 'a' },
      { key: 'a-older', machineId: 'a' },
    ]

    expect(orderMobileProjects(projects, ['a', 'b'], () => null).map((item) => item.key))
      .toEqual(['a-recent', 'a-older', 'b-recent'])
  })
})


describe('project alias bookmarks', () => {
  it('persists verified aliases by account and inherits a pin without losing the original', async () => {
    const { module, store } = await importWebProjectPrefs()
    module.setProjectPinned('machine:~', true)
    module.rememberProjectAlias('user', 'machine:~', 'machine:/Users/actual', { id: 'canonical', workDir: '/Users/actual' })
    expect(module.isProjectPinned('machine:~')).toBe(true)
    expect(module.isProjectPinned('machine:/Users/actual')).toBe(true)
    const saved = JSON.parse(store.get('shennian:projectPrefs')!)
    expect(saved['user\u0000machine:~'].resolvedProject.id).toBe('canonical')
    expect(saved['other\u0000machine:~']).toBeUndefined()
  })
  it('never overwrites an explicit canonical unpin', async () => {
    const { module } = await importWebProjectPrefs()
    module.setProjectPinned('machine:~', true)
    module.setProjectPinned('machine:/Users/actual', false)
    module.rememberProjectAlias('user', 'machine:~', 'machine:/Users/actual', { id: 'canonical', workDir: '/Users/actual' })
    expect(module.isProjectPinned('machine:/Users/actual')).toBe(false)
  })
})

describe('corrupt project preference isolation', () => {
  it.each(['null', '[]', 'false', '"invalid"'])('ignores non-map snapshot %s', async raw => {
    const { module } = await importWebProjectPrefs(new Map([['shennian:projectPrefs', raw]]))
    expect(module.getProjectPrefsSnapshot()).toEqual({})
  })
  it('keeps valid records and drops malformed optional fields without rewriting storage', async () => {
    const raw = JSON.stringify({ bad: null, mixed: { pinnedAt: {}, resolvedProject: { id: 'p', workDir: {} } },
      valid: { pinnedAt: '2026-10-21', resolvedProject: { id: 'p', workDir: '/project' } } })
    const { module, store } = await importWebProjectPrefs(new Map([['shennian:projectPrefs', raw]]))
    expect(module.getProjectPrefsSnapshot()).toEqual({ mixed: {}, valid: { pinnedAt: '2026-10-21', resolvedProject: { id: 'p', workDir: '/project' } } })
    expect(store.get('shennian:projectPrefs')).toBe(raw)
  })
})
