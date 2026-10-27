// @covers src/personal-agent/sdk-session.ts
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
const fake = vi.hoisted(() => ({ root: '', managers: new Map<string, any>(), append: vi.fn(), create: vi.fn(), legacy: vi.fn(() => 'old private history') }))
vi.mock('../config/index.js', () => ({ getShennianDir: () => fake.root }))
vi.mock('../personal-agent/legacy-context.js', () => ({ legacyPersonalContext: fake.legacy }))
vi.mock('../personal-agent/model-settings.js', () => ({ readPersonalModel: () => ({ mode: 'custom', model: 'unit', apiKey: 'synthetic', baseUrl: 'https://provider.example' }), personalCompactionSettings: () => ({}), OFFICIAL_MODEL: 'unit' }))
vi.mock('../personal-agent/official-credential.js', () => ({ OfficialModelCredential: class {}, personalModelServerUrl: () => 'https://shennian.net' }))
vi.mock('@earendil-works/pi-coding-agent', () => ({
  SessionManager: {
    create: (_cwd: string, dir: string) => {
      const id = `native-${fake.managers.size}`
      const file = path.join(dir, `${id}.jsonl`)
      const manager = { getSessionFile: () => file, getSessionId: () => id, getHeader: () => ({ id }), appendCustomEntry: vi.fn(), appendMessage: fake.append }
      fake.managers.set(file, manager)
      return manager
    },
    open: (file: string) => fake.managers.get(file),
  },
  ModelRuntime: { create: async () => ({ registerProvider: vi.fn(), getModel: () => ({ id: 'unit' }) }) },
  SettingsManager: { inMemory: () => ({ applyOverrides: vi.fn() }) },
  DefaultResourceLoader: class { async reload() {} },
  createBashToolDefinition: () => ({ name: 'bash' }),
  createPowerShellToolDefinition: () => ({ name: 'powershell' }),
  createAgentSession: fake.create,
}))
import { openPersonalAgent } from '../personal-agent/sdk-session'
beforeEach(() => {
  fake.root = fs.mkdtempSync(path.join(os.tmpdir(), 'fresh-context-'))
  fake.managers.clear(); vi.clearAllMocks()
  fake.create.mockResolvedValue({ session: { setAutoCompactionEnabled: vi.fn() } })
})
afterEach(() => fs.rmSync(fake.root, { recursive: true, force: true }))
it('opens an isolated fresh context without re-importing legacy messages and preserves the prior session', async () => {
  await openPersonalAgent('old-main', fake.root, null, () => ({}), 'main')
  const old = path.join(fake.root, 'runtime/personal-agent/old-main/session.json')
  const before = fs.readFileSync(old, 'utf8')
  await openPersonalAgent('new-main', fake.root, null, () => ({}), 'main')
  expect(fake.legacy).not.toHaveBeenCalled()
  expect(fake.append).not.toHaveBeenCalled()
  expect(fake.create.mock.calls[0]![0].sessionManager).not.toBe(fake.create.mock.calls[1]![0].sessionManager)
  expect(fs.readFileSync(old, 'utf8')).toBe(before)
  const pointer = JSON.parse(fs.readFileSync(path.join(fake.root, 'runtime/personal-agent/new-main/session.json'), 'utf8'))
  await openPersonalAgent('new-main', fake.root, pointer.id, () => ({}), 'main')
  expect(fake.create.mock.calls[2]![0].sessionManager).toBe(fake.create.mock.calls[1]![0].sessionManager)
})
