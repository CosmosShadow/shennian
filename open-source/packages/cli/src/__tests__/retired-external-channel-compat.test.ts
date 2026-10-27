// @covers open-source/packages/cli/src/manager/retired-external-channel-compat.ts

import { describe, expect, it } from 'vitest'
import {
  RetiredChannelRuntime,
  RetiredWeChatRpaSessionBindingSync,
  createRetiredChannelApiClient,
} from '../manager/retired-external-channel-compat.js'

describe('retired external channel compatibility', () => {
  it('does not expose provider state and rejects every write path', async () => {
    const runtime = new RetiredChannelRuntime()

    expect(runtime.listManagerExternalChannels()).toEqual([])
    expect(runtime.getManagerChannel()).toBeNull()
    await expect(runtime.upsertManagerChannel()).rejects.toMatchObject({ message: 'feature_retired' })
    await expect(runtime.upsertManagerWeChatRpaChannel()).rejects.toMatchObject({ message: 'feature_retired' })
    await expect(runtime.reply()).rejects.toMatchObject({ message: 'feature_retired' })
  })

  it('keeps old sync hooks inert and reports the feature as retired', async () => {
    const sync = new RetiredWeChatRpaSessionBindingSync()
    await expect(sync.reconcileAll()).resolves.toBeUndefined()
    await expect(sync.reconcileSession()).resolves.toBeUndefined()

    const api = createRetiredChannelApiClient()
    await expect(api.listBindings()).resolves.toEqual({ bindings: [] })
  })
})
