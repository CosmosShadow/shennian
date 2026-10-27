// @arch docs/architecture/launch-config.md
// @covers packages/app/src/utils/launchStorage.ts

import { afterEach, describe, expect, it, vi } from 'vitest'

const STORAGE_KEY = 'shennian:lastLaunch'
const RECENT_MODELS_KEY = 'shennian:recentLaunchModels'

function resetLaunchStorageTestContext() {
  vi.resetModules()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
}

async function importWebLaunchStorage(store = new Map<string, string>()) {
  vi.doMock('react-native', () => ({
    Platform: { OS: 'web' },
  }))
  vi.stubGlobal('localStorage', {
    getItem: vi.fn((key: string) => store.get(key) ?? null),
    setItem: vi.fn((key: string, value: string) => {
      store.set(key, value)
    }),
    removeItem: vi.fn((key: string) => {
      store.delete(key)
    }),
  })

  return {
    module: await import('../utils/launchStorage'),
    store,
  }
}

async function importNativeLaunchStorage(store = new Map<string, string>()) {
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
    module: await import('../utils/launchStorage'),
    store,
    getItem,
    setItem,
  }
}

afterEach(() => {
  resetLaunchStorageTestContext()
})

describe('launchStorage', () => {
  it('keeps three recent non-default models per agent on the current device', async () => {
    const { module, store } = await importWebLaunchStorage()

    module.recordRecentLaunchModel('cursor', 'auto', 'auto')
    module.recordRecentLaunchModel('cursor', 'cursor-1', 'auto')
    module.recordRecentLaunchModel('cursor', 'cursor-2', 'auto')
    module.recordRecentLaunchModel('cursor', 'cursor-1', 'auto')
    module.recordRecentLaunchModel('cursor', 'cursor-3', 'auto')
    module.recordRecentLaunchModel('cursor', 'cursor-4', 'auto')
    module.recordRecentLaunchModel('codex', 'gpt-5', 'auto')

    expect(module.getRecentLaunchModels('cursor')).toEqual(['cursor-4', 'cursor-3', 'cursor-1'])
    expect(module.getRecentLaunchModels('cursor', ['cursor-4', 'cursor-1'])).toEqual([
      'cursor-4',
      'cursor-1',
    ])
    expect(module.getRecentLaunchModels('codex')).toEqual(['gpt-5'])
    expect(JSON.parse(store.get(RECENT_MODELS_KEY) ?? '{}')).toEqual({
      cursor: ['cursor-4', 'cursor-3', 'cursor-1'],
      codex: ['gpt-5'],
    })
  })

  it('restores web launch config from localStorage after a reload', async () => {
    const persisted = new Map<string, string>()

    const firstLoad = await importWebLaunchStorage(persisted)
    firstLoad.module.saveLastLaunch('machine-1', {
      agentType: 'codex',
      workDir: '~/repo',
      modelId: 'gpt-5.4',
    })

    resetLaunchStorageTestContext()

    const secondLoad = await importWebLaunchStorage(persisted)
    expect(secondLoad.module.getLastLaunch('machine-1')).toEqual({
      agentType: 'codex',
      workDir: '~/repo',
      modelId: 'gpt-5.4',
      modelPreferences: {
        codex: 'gpt-5.4',
      },
    })
    expect(secondLoad.module.getLastPreferredModel('machine-1', 'codex')).toBe('gpt-5.4')
  })

  it('hydrates native launch config from AsyncStorage and keeps per-agent model preferences across restarts', async () => {
    const persisted = new Map<string, string>([
      [STORAGE_KEY, JSON.stringify({
        'machine-1': {
          agentType: 'claude',
          workDir: '~/workspace',
          modelId: 'sonnet',
          modelPreferences: {
            claude: 'sonnet',
          },
        },
      })],
    ])

    const firstLoad = await importNativeLaunchStorage(persisted)
    await firstLoad.module.hydrateLaunchStorage()
    expect(firstLoad.module.getLastLaunch('machine-1')).toEqual({
      agentType: 'claude',
      workDir: '~/workspace',
      modelId: 'sonnet',
      modelPreferences: {
        claude: 'sonnet',
      },
    })

    firstLoad.module.saveLastLaunch('machine-1', {
      agentType: 'codex',
      workDir: '~/repo',
      modelId: 'gpt-5.4',
    })

    expect(firstLoad.module.getLastPreferredModel('machine-1', 'claude')).toBe('sonnet')
    expect(firstLoad.module.getLastPreferredModel('machine-1', 'codex')).toBe('gpt-5.4')
    expect(firstLoad.setItem).toHaveBeenCalledOnce()

    resetLaunchStorageTestContext()

    const secondLoad = await importNativeLaunchStorage(persisted)
    await secondLoad.module.hydrateLaunchStorage()
    expect(secondLoad.module.getLastLaunch('machine-1')).toEqual({
      agentType: 'codex',
      workDir: '~/repo',
      modelId: 'gpt-5.4',
      modelPreferences: {
        claude: 'sonnet',
        codex: 'gpt-5.4',
      },
    })
    expect(secondLoad.getItem).toHaveBeenCalledWith(STORAGE_KEY)
  })
})

describe('corrupt launch preference isolation', () => {
  it.each(['null', '[]', '42', '"invalid"'])('ignores a non-map snapshot %s', async (raw) => {
    const { module } = await importWebLaunchStorage(new Map([[STORAGE_KEY, raw]]))
    expect(module.getLastLaunch('machine')).toBeNull()
  })
  it('keeps valid records but rejects malformed fields and selected objects as paths', async () => {
    const raw = JSON.stringify({
      valid: { agentType: 'codex', workDir: '/project', modelId: 'model-a' },
      bad: { agentType: {}, workDir: {} },
      partial: { agentType: 'codex', workDir: '/partial', modelId: { id: 'model-b', name: 'Model B' },
        modelPreferences: { codex: {}, claude: null }, sessionMode: {} },
    })
    const { module, store } = await importWebLaunchStorage(new Map([[STORAGE_KEY, raw]]))
    expect(module.getLastLaunch('valid')?.modelId).toBe('model-a')
    expect(module.getLastLaunch('bad')).toBeNull()
    expect(module.getLastLaunch('partial')).toMatchObject({ modelId: 'model-b', modelPreferences: { claude: null } })
    expect(module.getLastLaunch('partial')?.sessionMode).toBeUndefined()
    expect(store.get(STORAGE_KEY)).toBe(raw) // reading is not a destructive migration
  })
})
