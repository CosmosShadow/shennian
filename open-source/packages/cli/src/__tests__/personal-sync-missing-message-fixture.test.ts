// @arch open-source/docs/cli-runtime.md
// @covers src/native-fusion/local-repository.ts
// @covers src/session/history-subscriptions.ts

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { NativeFusionLocalRepository } from '../native-fusion/local-repository.js'
import { CanonicalSessionStore } from '../session/canonical-store.js'
import { PersonalHistorySubscriptions } from '../session/history-subscriptions.js'

vi.mock('../personal-sync/identity.js', () => ({
  getDaemonInstallationId: () => 'fixture-installation',
}))

const roots: string[] = []
afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true })
})

describe('missing first user message regression fixture', () => {
  it('keeps identity, role, order, preview and terminal revision from native import through phone snapshot', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'personal-sync-regression-'))
    roots.push(root)
    const canonical = new CanonicalSessionStore(path.join(root, 'canonical'), 'fixture-installation')
    const indexWrites = vi.fn()
    const repository = new NativeFusionLocalRepository({
      rootDir: path.join(root, 'fusion'),
      daemonInstallationId: 'fixture-installation',
      canonicalStore: canonical,
      recordLocalSession: indexWrites,
    })
    const commits = repository.commitEvents([
      {
        agentType: 'codex', sourceMode: 'codex_rollout_import', sourceSessionKey: 'fixture-thread',
        sourceEventKey: 'fixture-user', cursor: '/rollout.jsonl:100', role: 'user', ts: 1000,
        payload: 'fixture user turn', title: 'fixture user turn', workDir: '/fixture',
      },
      {
        agentType: 'codex', sourceMode: 'codex_rollout_import', sourceSessionKey: 'fixture-thread',
        sourceEventKey: 'fixture-agent', cursor: '/rollout.jsonl:200', role: 'agent', ts: 2000,
        payload: 'fixture agent turn', terminal: true, title: 'fixture user turn', workDir: '/fixture',
      },
    ])
    const responses: Array<Record<string, unknown>> = []
    const subscriptions = new PersonalHistorySubscriptions({
      sendRes: (frame) => responses.push(frame as unknown as Record<string, unknown>),
      sendEvent: vi.fn(),
    }, canonical)

    subscriptions.handleOpen({
      type: 'req', id: 'open-fixture', method: 'session.history.open',
      params: {
        protocolVersion: 2, dataEpoch: 2, daemonInstallationId: 'fixture-installation',
        sessionId: commits[0]!.sessionId, subscriptionId: 'fixture-subscription', limit: 8,
      },
    })

    const payload = responses[0]!.payload as {
      snapshotRevision: number
      messages: Array<{ sequence: number; message: { id: string; role: string; payload: string } }>
    }
    expect(payload.snapshotRevision).toBe(2)
    expect(payload.messages.map((entry) => ({
      id: entry.message.id,
      sequence: entry.sequence,
      role: entry.message.role,
      payload: entry.message.payload,
    }))).toEqual([
      { id: commits[0]!.messageId, sequence: 1, role: 'user', payload: 'fixture user turn' },
      { id: commits[1]!.messageId, sequence: 2, role: 'agent', payload: 'fixture agent turn' },
    ])
    expect(indexWrites).toHaveBeenLastCalledWith(expect.objectContaining({
      sessionId: commits[0]!.sessionId,
      status: 'completed',
      lastMessagePreview: 'fixture agent turn',
    }))
    expect(canonical.getManifest(commits[0]!.sessionId)).toMatchObject({
      bodyRevision: 2,
      visibleMessageCount: 2,
      lastVisibleMessageId: commits[1]!.messageId,
    })
    subscriptions.closeAll()
  })
})
