// @arch docs/architecture/app/modular-features.md#聊天-feature
// @covers packages/app/src/features/chat/utils/reasoningEffortStorage.ts
// @covers packages/app/src/features/chat/utils/sendParams.ts
// @covers packages/app/src/utils/models.ts

import { afterEach, describe, expect, it, vi } from 'vitest'
import { buildChatSendParams } from '../features/chat/utils/sendParams'
import { resolveReasoningEffort } from '../utils/models'

const STORAGE_KEY = 'shennian:chatReasoningEfforts'

function resetReasoningEffortStorageTestContext() {
  vi.resetModules()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
}

async function importWebReasoningEffortStorage(store = new Map<string, string>()) {
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
    module: await import('../features/chat/utils/reasoningEffortStorage'),
    store,
  }
}

async function importNativeReasoningEffortStorage(store = new Map<string, string>()) {
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
    module: await import('../features/chat/utils/reasoningEffortStorage'),
    store,
    getItem,
    setItem,
  }
}

afterEach(() => {
  resetReasoningEffortStorageTestContext()
})

describe('reasoning effort storage', () => {
  it('restores a user-selected Codex effort across conversations on this device', async () => {
    const persisted = new Map<string, string>()
    const model = {
      id: 'gpt-5.6-sol',
      name: 'GPT-5.6 Sol',
      supportedReasoningEfforts: [
        { id: 'low', name: 'Low' },
        { id: 'medium', name: 'Medium' },
        { id: 'high', name: 'High' },
        { id: 'ultra', name: 'Ultra' },
      ],
      defaultReasoningEffort: 'medium',
    }

    const firstLoad = await importWebReasoningEffortStorage(persisted)
    firstLoad.module.saveReasoningEffortPreference('codex', 'gpt-5.6-sol', 'high')

    resetReasoningEffortStorageTestContext()

    const secondLoad = await importWebReasoningEffortStorage(persisted)
    const restored = secondLoad.module.getReasoningEffortPreference(
      'codex',
      'gpt-5.6-sol',
    )
    const effective = resolveReasoningEffort('codex', model, restored)

    expect(effective).toBe('high')
    expect(
      buildChatSendParams({
        protocolVersion: 2,
        dataEpoch: 2,
        daemonInstallationId: 'daemon-1',
        sessionId: 'session-1',
        text: 'continue',
        agentType: 'codex',
        workDir: '/repo',
        modelId: 'gpt-5.6-sol',
        reasoningEffort: effective,
      }),
    ).toMatchObject({ reasoningEffort: 'high' })
  })

  it('keeps separate local defaults for different models', async () => {
    const { module } = await importWebReasoningEffortStorage()
    module.saveReasoningEffortPreference('codex', 'gpt-5.6-sol', 'low')

    expect(
      module.getReasoningEffortPreference('codex', 'gpt-5.6-terra'),
    ).toBeNull()
  })

  it('hydrates native reasoning effort preferences from AsyncStorage', async () => {
    const persisted = new Map<string, string>([
      [
        STORAGE_KEY,
        JSON.stringify({
          'expired-session': {
            agentType: 'codex',
            modelId: 'expired-model',
            effort: 'high',
            savedAt: Date.now() - 91 * 24 * 60 * 60 * 1000,
          },
          'session-1': {
            agentType: 'codex',
            modelId: 'gpt-5.6-sol',
            effort: 'high',
            savedAt: Date.now() - 1000,
          },
        }),
      ],
    ])

    const firstLoad = await importNativeReasoningEffortStorage(persisted)
    await firstLoad.module.hydrateReasoningEffortStorage()

    expect(
      firstLoad.module.getReasoningEffortPreference('codex', 'gpt-5.6-sol'),
    ).toBe('high')

    expect(firstLoad.module.getReasoningEffortPreference('codex', 'expired-model')).toBeNull()

    firstLoad.module.saveReasoningEffortPreference('codex', 'gpt-5.6-sol', 'low')
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(firstLoad.setItem).toHaveBeenCalled()
  })
})
