// @covers src/agents/config-status.ts

import { describe, expect, it, vi } from 'vitest'
import { parseBuiltinAuthStatus } from '../agents/auth-status.js'
import { getAgentConfigSummary, maskToken } from '../agents/config-status.js'
import { readLatestUserEnv } from '../agent-env.js'

vi.mock('../agent-env.js', () => ({ readLatestUserEnv: vi.fn(() => ({})) }))

vi.mock('../config/index.js', () => ({
  resolveShennianPath: (...parts: string[]) => `/tmp/shennian-test/${parts.join('/')}`,
  loadConfig: () => ({}),
}))

// Point homedir at an empty temp dir so detectFromKnownConfigFiles can't read
// the real ~/.claude/settings.json on the dev machine — that file holds a live
// token and would flip the "unconfigured" case to detected, leaking the
// machine's credentials into the assertion.
vi.mock('node:os', async () => {
  const actual = await vi.importActual<typeof import('node:os')>('node:os')
  return { ...actual, default: { ...actual, homedir: () => '/tmp/shennian-test-home' }, homedir: () => '/tmp/shennian-test-home' }
})

describe('agent config status', () => {
  it('masks tokens without exposing secret body', () => {
    expect(maskToken('sk-test-abcdef')).toBe('••••cdef')
  })

  it('detects codex env config as non-secret summary', () => {
    const summary = getAgentConfigSummary('codex', {
      OPENAI_BASE_URL: 'https://proxy.example.com/v1',
      OPENAI_API_KEY: 'sk-test-7890',
    })
    expect(summary).toMatchObject({
      status: 'detected',
      source: 'env',
      tokenPresent: true,
      tokenHint: '••••7890',
      baseUrlHost: 'proxy.example.com',
    })
  })

  it('detects Nian DashScope env config as non-secret summary', () => {
    const summary = getAgentConfigSummary('pi', {
      DASHSCOPE_BASE_URL: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
      DASHSCOPE_API_KEY: 'unit-7890',
    })
    expect(summary).toMatchObject({
      status: 'detected',
      source: 'env',
      tokenPresent: true,
      tokenHint: '••••7890',
      baseUrlHost: 'dashscope.aliyuncs.com',
    })
  })

  it('returns missing for unsupported or unconfigured agents', () => {
    vi.mocked(readLatestUserEnv).mockClear()
    expect(getAgentConfigSummary('gemini')).toBeUndefined()
    expect(getAgentConfigSummary('pi-coding-agent')).toBeUndefined()
    expect(readLatestUserEnv).not.toHaveBeenCalled()
    expect(getAgentConfigSummary('claude', {})).toMatchObject({
      status: 'missing',
      tokenPresent: false,
    })
  })

  it('reads the current user environment only when a configurable agent needs it', () => {
    vi.mocked(readLatestUserEnv).mockClear()
    getAgentConfigSummary('claude')
    expect(readLatestUserEnv).toHaveBeenCalledTimes(1)
  })
})

// @covers src/agents/auth-status.ts
describe('non-interactive vendor sign-in status', () => {
  it('reads supported Codex status on either output stream', () => {
    expect(parseBuiltinAuthStatus('codex', 0, '', 'Logged in using ChatGPT')).toBe('ready')
    expect(parseBuiltinAuthStatus('codex', 0, 'Logged in using an API key', '')).toBe('ready')
    expect(parseBuiltinAuthStatus('codex', 1, '', 'Not logged in')).toBe('required')
  })
  it('reads only documented Claude JSON status and exit combinations', () => {
    expect(parseBuiltinAuthStatus('claude', 0, '{"loggedIn":true,"email":"private@example.com"}', '')).toBe('ready')
    expect(parseBuiltinAuthStatus('claude', 1, '{"loggedIn":false}', '')).toBe('required')
    expect(parseBuiltinAuthStatus('claude', 0, '{"loggedIn":false}', '')).toBe('unknown')
  })
  it.each(['codex', 'claude'] as const)('keeps old launchers, failures and unsupported %s output unknown', provider => {
    expect(parseBuiltinAuthStatus(provider, 0, '0.1.2', '')).toBe('unknown')
    expect(parseBuiltinAuthStatus(provider, 0, 'login window opened', '')).toBe('unknown')
    expect(parseBuiltinAuthStatus(provider, null, '', 'timeout')).toBe('unknown')
    expect(parseBuiltinAuthStatus(provider, 1, 'Logged in using ChatGPT', '')).toBe('unknown')
  })
})
