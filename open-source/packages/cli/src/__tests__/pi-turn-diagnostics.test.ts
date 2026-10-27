// @covers src/agents/pi-turn-diagnostics.ts

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  classifyPiFailure,
  formatPiDiagnostic,
  inspectPiTurnConfiguration,
  type PiTurnDiagnostic,
} from '../agents/pi-turn-diagnostics.js'

const roots: string[] = []

afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true })
})

function tempAgentDir(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pi-diagnostic-'))
  roots.push(root)
  return root
}

describe('Pi turn diagnostics', () => {
  it('reports the selected Pi request configuration without URL secrets or credential values', () => {
    const agentDir = tempAgentDir()
    const secret = 'synthetic-key-never-log-123456'
    fs.writeFileSync(path.join(agentDir, 'models.json'), JSON.stringify({
      providers: {
        deepseek: {
          baseUrl: 'https://user:pass@api.deepseek.com/v1?token=private#fragment',
          apiKey: '$DEEPSEEK_API_KEY',
          headers: { Authorization: `Bearer ${secret}`, 'X-Private': secret },
        },
      },
    }))

    const inspected = inspectPiTurnConfiguration({
      agentDir,
      env: { DEEPSEEK_API_KEY: secret },
      model: {
        provider: 'deepseek',
        id: 'deepseek-flash',
        api: 'openai-completions',
        baseUrl: 'https://user:pass@api.deepseek.com/v1?token=private#fragment',
      },
    })
    const serialized = JSON.stringify(inspected)

    expect(inspected).toEqual(expect.objectContaining({
      provider: 'deepseek',
      model: 'deepseek-flash',
      api: 'openai-completions',
      target: { scheme: 'https', host: 'api.deepseek.com' },
      providerConfigSource: 'models_file',
      credentialSource: 'process_environment',
      credentialPresent: true,
    }))
    expect(serialized).not.toContain(secret)
    expect(serialized).not.toContain('user')
    expect(serialized).not.toContain('pass')
    expect(serialized).not.toContain('token')
    expect(serialized).not.toContain('Authorization')
    expect(serialized).not.toContain('X-Private')
  })

  it('only exposes auth-file presence and never stored credential contents', () => {
    const agentDir = tempAgentDir()
    const secret = 'stored-synthetic-secret-654321'
    fs.writeFileSync(path.join(agentDir, 'auth.json'), JSON.stringify({
      deepseek: { type: 'api_key', key: secret, env: { PRIVATE_HEADER: secret } },
    }))

    const inspected = inspectPiTurnConfiguration({
      agentDir,
      env: {},
      model: { provider: 'deepseek', id: 'deepseek-flash' },
    })

    expect(inspected.credentialSource).toBe('auth_file')
    expect(inspected.credentialPresent).toBe(true)
    expect(JSON.stringify(inspected)).not.toContain(secret)
    expect(JSON.stringify(inspected)).not.toContain('PRIVATE_HEADER')
  })

  it('whitelists error summaries and omits arbitrary upstream response text', () => {
    const secret = 'sk-synthetic-never-log-123456789'
    expect(classifyPiFailure(`403 {"message":"Request not allowed","secret":"${secret}"}`)).toEqual({
      errorCode: 'http_403',
      httpStatus: 403,
      safeDetail: 'Request not allowed',
    })
    const unknown = classifyPiFailure(`opaque upstream body ${secret}`)
    expect(unknown).toEqual({ errorCode: 'pi_error' })
    expect(JSON.stringify(unknown)).not.toContain(secret)
  })

  it('formats only a random marker and bounded counts, never internal identifiers or content', () => {
    const entry: PiTurnDiagnostic = {
      marker: 'random-marker',
      phase: 'request_config',
      modelSelectionSource: 'room_effective_model',
      piObservedRequestConfig: true,
      finalHttpRequestObserved: false,
      provider: 'deepseek',
      model: 'deepseek-flash',
      api: 'openai-completions',
      target: { scheme: 'https', host: 'api.deepseek.com' },
      providerConfigSource: 'pi_runtime_catalog',
      credentialSource: 'process_environment',
      credentialPresent: true,
      agentDirSource: 'user_home_default',
      historyMessageCount: 2,
      attachmentCount: 1,
      imageAttachmentCount: 0,
      toolCallCount: 0,
      queuedIntoActiveRun: false,
    }
    const line = formatPiDiagnostic(entry)
    expect(line).toContain('"finalHttpRequestObserved":false')
    expect(line).not.toMatch(/roomId|agentId|sessionId|bindingId|membershipId|machineId/i)
  })
})
