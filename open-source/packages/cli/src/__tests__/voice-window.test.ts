// @covers open-source/packages/cli/src/session/handlers/voice-window.ts

import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Envelope, ReqFrame } from '@shennian/wire'

const readRecent = vi.fn()
vi.mock('../session/store.js', () => ({
  getCanonicalSessionStore: () => ({ readRecent }),
  getDaemonInstallationId: () => 'daemon-test',
}))
vi.mock('../personal-sync/identity.js', () => ({
  getDaemonInstallationId: () => 'daemon-test',
}))

import { handleVoiceSessionBodyWindow } from '../session/handlers/voice-window.js'

describe('voice session body window', () => {
  const sendRes = vi.fn()
  const runtime = { client: { sendRes } } as never

  beforeEach(() => {
    vi.clearAllMocks()
    const messages: Envelope[] = [
      { id: 'u1', sessionId: 's1', role: 'user', ts: 1, payload: '用户问题' },
      {
        id: 'tool1',
        sessionId: 's1',
        role: 'agent',
        ts: 2,
        payload: '{"v":1,"type":"tool","name":"shell_command"}',
      },
      { id: 'a1', sessionId: 's1', role: 'agent', ts: 3, payload: '最终答案' },
    ]
    readRecent.mockReturnValue({
      bodyRevision: 7,
      firstAvailableSeq: 1,
      lastAvailableSeq: 3,
      hasOlder: false,
      messages,
      entries: [],
    })
  })

  it('returns one bounded readable window without raw tool messages', () => {
    handleVoiceSessionBodyWindow(runtime, {
      type: 'req',
      id: 'req-1',
      method: 'voice.session.body.window',
      params: {
        protocolVersion: 2, dataEpoch: 2, daemonInstallationId: 'daemon-test',
        sessionId: 's1', callId: 'call-1', limit: 8, maxBytes: 32 * 1024,
      },
    } as ReqFrame)

    expect(readRecent).toHaveBeenCalledWith('s1', 48)
    expect(sendRes).toHaveBeenCalledWith({
      type: 'res',
      id: 'req-1',
      ok: true,
      payload: {
        protocolVersion: 2,
        dataEpoch: 2,
        daemonInstallationId: 'daemon-test',
        sessionId: 's1',
        callId: 'call-1',
        bodyRevision: 7,
        messages: [
          expect.objectContaining({ id: 'u1' }),
          expect.objectContaining({ id: 'a1' }),
        ],
        truncated: false,
      },
    })
  })
})
