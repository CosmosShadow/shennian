import { builtinPersonalSystemPrompt } from '../personal-agent/system-prompt.js'
import { STEWARD_SYSTEM_PROMPT } from '../steward/session.js'
import { FEATURE_GUIDE_INSTRUCTIONS } from '../guides/catalog.js'
// @covers src/personal-agent/model-settings.ts
// @covers src/personal-agent/official-credential.ts
// @covers src/personal-workspace/service.ts
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { saveAutomaticPersonalModel } from '../personal-agent/automatic-model.js'
import { readPersonalModel, savePersonalModel, personalModelSummary, validatePersonalModel, OFFICIAL_MODEL, personalCompactionSettings } from '../personal-agent/model-settings.js'
import { saveConfig } from '../config/index.js'
import { OfficialModelCredential } from '../personal-agent/official-credential.js'
import { personalWorkspace } from '../personal-workspace/service.js'
let root: string, prior: string | undefined
const custom = { mode: 'custom' as const, baseUrl: 'https://provider.example/v1', apiKey: 'synthetic-test-key', model: 'my-model', contextWindow: 32768 }
beforeEach(() => { root = fs.mkdtempSync(path.join(os.tmpdir(), 'personal-model-')); prior = process.env.SHENNIAN_HOME; process.env.SHENNIAN_HOME = root })
afterEach(() => { vi.useRealTimers(); if (prior === undefined) delete process.env.SHENNIAN_HOME; else process.env.SHENNIAN_HOME = prior; fs.rmSync(root, { recursive: true, force: true }) })
describe('private local model settings', () => {
  it('scales compaction budgets to small user-provided model windows', () => {
    expect(personalCompactionSettings(8192)).toEqual({ enabled: true, reserveTokens: 2048, keepRecentTokens: 2048 })
    expect(personalCompactionSettings()).toEqual({ enabled: true, reserveTokens: 8192, keepRecentTokens: 16000 })
  })
  it('defaults to official and returns only non-secret status from the personal settings API', async () => {
    expect(readPersonalModel()).toEqual({ mode: 'official' })
    expect(personalModelSummary().model).toBe(OFFICIAL_MODEL)
    expect(personalModelSummary().contextWindow).toBe(1000000)
    const result = await personalWorkspace({ action: 'model_set', settings: custom })
    expect(result).toMatchObject({ mode: 'custom', hasApiKey: true })
    expect(JSON.stringify(result)).not.toContain(custom.apiKey)
    expect(JSON.stringify(personalWorkspace({ action: 'model_info' }))).not.toContain(custom.apiKey)
    const file = fs.readdirSync(root).find(name => name.startsWith('personal-model-'))!
    if (process.platform !== 'win32') expect(fs.statSync(path.join(root, file)).mode & 0o777).toBe(0o600)
    expect(readPersonalModel()).toEqual(custom)
  })
  it('preserves a saved key when omitted and never falls back to another provider after a failure', () => {
    savePersonalModel(custom)
    savePersonalModel({ mode: 'official' })
    expect(readPersonalModel().apiKey).toBe(custom.apiKey)
    savePersonalModel({ mode: 'custom', model: 'another' })
    expect(readPersonalModel()).toMatchObject({ mode: 'custom', model: 'another', apiKey: custom.apiKey })
    expect(() => savePersonalModel({ apiKey: '' })).toThrow('personal_model_settings_invalid')
    expect(readPersonalModel().apiKey).toBe(custom.apiKey)
  })
  it('rejects insecure URLs, embedded credentials, command interpolation and invalid limits', () => {
    for (const patch of [{ baseUrl: 'http://provider.example/v1' }, { baseUrl: 'https://u:p@provider.example' }, { baseUrl: 'https://provider.example?token=secret' }, { baseUrl: 'file:///tmp/key' }, { model: 'bad\nvalue' }, { contextWindow: 8191 }, { contextWindow: Infinity }, { unrecognized: true }]) expect(() => validatePersonalModel({ ...custom, ...patch })).toThrow()
    expect(validatePersonalModel({ ...custom, baseUrl: 'http://127.0.0.1:8080/v1' }).baseUrl).toContain('127.0.0.1')
    // Literal key strings are never interpreted as shell commands by our settings layer.
    expect(validatePersonalModel({ ...custom, apiKey: '!do-not-execute' }).apiKey).toBe('!do-not-execute')
  })
  it('isolates account namespaces and fails closed on corrupt settings', () => {
    saveConfig({ accountNamespaceId: 'account-a' }); savePersonalModel(custom)
    saveConfig({ accountNamespaceId: 'account-b' }); expect(readPersonalModel()).toEqual({ mode: 'official' })
    saveConfig({ accountNamespaceId: 'account-a' }); expect(readPersonalModel().apiKey).toBe(custom.apiKey)
    const file = fs.readdirSync(root).find(name => name.startsWith('personal-model-'))!
    fs.writeFileSync(path.join(root, file), 'bad')
    expect(() => readPersonalModel()).toThrow('personal_model_settings_invalid')
    expect(() => savePersonalModel({ mode: 'official' })).toThrow()
  })
})
describe('official long-lived Client key', () => {
  it('uses the paired key without network issuance, survives elapsed time and follows rotation/logout', async () => {
    const credential = new OfficialModelCredential()
    await expect(credential.get()).rejects.toThrow('personal_model_pairing_required')
    saveConfig({ machineId: 'test-machine', machineToken: 'synthetic-machine-key' })
    expect(await credential.get()).toBe('synthetic-machine-key')
    vi.useFakeTimers(); vi.advanceTimersByTime(365 * 24 * 3600 * 1000)
    expect(await credential.get()).toBe('synthetic-machine-key')
    saveConfig({ machineId: 'test-machine', machineToken: 'rotated-key' })
    expect(await credential.get()).toBe('rotated-key')
    saveConfig({})
    await expect(credential.get()).rejects.toThrow('personal_model_pairing_required')
  })
})

it('injects existing steward/Client rules with workspace discovery, without duplicating the whole manual', () => {
  const prompt = builtinPersonalSystemPrompt(STEWARD_SYSTEM_PROMPT)
  expect(prompt).toContain('AGENTS.md'); expect(prompt).toContain('index.md')
  expect(prompt).not.toContain('Atlas'); expect(prompt).toContain('shennian steward paths')
  expect(prompt).toContain('shennian steward say'); expect(prompt).toContain('shennian help')
  expect(prompt.split(FEATURE_GUIDE_INSTRUCTIONS)).toHaveLength(2)
  expect(prompt).toContain('不要读取或输出 .env')
})

// @covers src/personal-agent/automatic-model.ts
it('configures known providers without model IDs and requires a new key for a different host', async () => {
  const fetcher = vi.fn(); vi.stubGlobal('fetch', fetcher)
  try {
    const value = await saveAutomaticPersonalModel({ mode: 'custom', baseUrl: 'https://api.deepseek.com', apiKey: 'synthetic-key' })
    expect(value).toMatchObject({ model: 'deepseek-flash', contextWindow: 1000000, hasApiKey: true })
    expect(fetcher).not.toHaveBeenCalled()
    await expect(saveAutomaticPersonalModel({ mode: 'custom', baseUrl: 'https://other.example/v1' })).rejects.toThrow('personal_model_settings_invalid')
    expect(fetcher).not.toHaveBeenCalled()
  } finally { vi.unstubAllGlobals() }
})
it('discovers a custom provider model internally and never persists failed discovery', async () => {
  const fetcher = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({ data: [{ id: 'embedding-v1' }, { id: 'my-chat-model', is_default: true }] }))).mockResolvedValueOnce(new Response('secret diagnostic', { status: 401 }))
  vi.stubGlobal('fetch', fetcher)
  try {
    const value = await saveAutomaticPersonalModel({ mode: 'custom', baseUrl: 'https://custom.example/v1', apiKey: 'synthetic-key' })
    expect(value.model).toBe('my-chat-model')
    expect(fetcher).toHaveBeenCalledWith('https://custom.example/v1/models', expect.objectContaining({ redirect: 'error' }))
    await expect(saveAutomaticPersonalModel({ mode: 'custom', baseUrl: 'https://failed.example/v1', apiKey: 'synthetic-new-key' })).rejects.toThrow('personal_model_settings_invalid')
    expect(readPersonalModel().baseUrl).toBe('https://custom.example/v1')
  } finally { vi.unstubAllGlobals() }
})
