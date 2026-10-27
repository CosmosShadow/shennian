import { builtinPersonalSystemPrompt } from './system-prompt.js'
// @arch open-source/docs/cli-runtime.md
// @test src/__tests__/personal-agent-adapter.test.ts
import fs from 'node:fs'
import path from 'node:path'
import { getShennianDir } from '../config/index.js'
import { readPersonalModel, OFFICIAL_MODEL, personalCompactionSettings } from './model-settings.js'
import { OfficialModelCredential, personalModelServerUrl } from './official-credential.js'
import type { AgentSession, ModelRuntime, ToolDefinition } from '@earendil-works/pi-coding-agent'

const safe = (value: string) => /^[\w-]{1,191}$/.test(value)
export function personalSessionToolNames(mode: 'personal' | 'managed-native-full' | 'validation' | 'project-coordination', shellName: string, coordinationTools: ToolDefinition[]) {
  // SDK tools is both the active selection and the allowlist, including custom tools.
  return mode === 'project-coordination' ? coordinationTools.map(tool => tool.name) : mode === 'validation' ? [] : ['read', 'edit', 'write', shellName]
}
/** Exact ownership, never continueRecent(), and never touch the user's separate ~/.pi. */
export async function openPersonalAgent(sessionId: string, cwd: string, nativeId: string | null | undefined, env: () => NodeJS.ProcessEnv, prompt: string, mode: 'personal' | 'managed-native-full' | 'validation' | 'project-coordination' = 'personal', coordinationTools: ToolDefinition[] = []) {
  const sdk = await import('@earendil-works/pi-coding-agent')
  if (!safe(sessionId) || (nativeId && !safe(nativeId))) throw new Error('personal_agent_session_invalid')
  const root = path.join(getShennianDir(), 'runtime', mode === 'personal' ? 'personal-agent' : mode === 'validation' ? 'builtin-agent-validation' : mode === 'project-coordination' ? 'project-coordination' : 'builtin-managed-agent', sessionId)
  try {
  fs.mkdirSync(root, { recursive: true, mode: 0o700 })
  const sessionsDir = path.join(root, 'sessions')
  const pointer = path.join(root, 'session.json')
  let manager: ReturnType<typeof sdk.SessionManager.create>
  if (fs.existsSync(pointer)) {
    const saved = JSON.parse(fs.readFileSync(pointer, 'utf8')) as { id: string; file: string }
    if (!safe(saved.id) || path.basename(saved.file) !== saved.file || !saved.file.endsWith('.jsonl') || (nativeId && saved.id !== nativeId)) throw new Error('personal_agent_session_mismatch')
    if (!fs.existsSync(path.join(sessionsDir, saved.file))) throw new Error('personal_agent_session_missing')
    manager = sdk.SessionManager.open(path.join(sessionsDir, saved.file), sessionsDir, cwd)
    if (manager.getSessionId() !== saved.id) throw new Error('personal_agent_session_mismatch')
  } else {
    if (nativeId) throw new Error('personal_agent_session_missing')
    manager = sdk.SessionManager.create(cwd, sessionsDir)
    // Pi normally defers writing until the first assistant reply. Create its public
    // header first, then reopen explicitly so ownership and the first user input
    // survive a crash before a provider has answered.
    fs.mkdirSync(sessionsDir, { recursive: true, mode: 0o700 })
    const initialFile = manager.getSessionFile()!
    const fd = fs.openSync(initialFile, 'wx', 0o600)
    try { fs.writeFileSync(fd, JSON.stringify(manager.getHeader()) + '\n'); fs.fsyncSync(fd) } finally { fs.closeSync(fd) }
    manager = sdk.SessionManager.open(initialFile, sessionsDir, cwd)
    manager.appendCustomEntry('shennian-owner', { sessionId })
    // A new session is a fresh context. Never silently re-import other sessions;
    // historical messages remain available for display, not as new Agent input.
  }
  const credentials = new OfficialModelCredential()
  let current = readPersonalModel()
  const runtime = await sdk.ModelRuntime.create({ modelsPath: null, refreshOnCreate: false, allowModelNetwork: false, modelsStorePath: path.join(root, 'models-cache.json'), credentials: {
    read: async (provider) => provider === 'shennian-personal' ? { type: 'api_key' as const, key: current.mode === 'official' ? await credentials.get() : current.apiKey! } : undefined,
    list: async () => [], modify: async () => { throw new Error('personal_model_credentials_read_only') }, delete: async () => { throw new Error('personal_model_credentials_read_only') },
  } })
  const configureModel = () => {
    current = readPersonalModel()
    runtime.registerProvider('shennian-personal', {
      api: 'openai-completions', baseUrl: current.mode === 'official' ? `${personalModelServerUrl()}/api/personal-model/v1` : current.baseUrl!,
      models: [{ id: current.mode === 'official' ? OFFICIAL_MODEL : current.model!, name: current.mode === 'official' ? 'DeepSeek V4.1 Flash' : current.model!, reasoning: false,
        input: ['text', 'image'], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: current.contextWindow ?? 1000000, maxTokens: Math.min(4096, Math.floor((current.contextWindow ?? 1000000) / 4)),
        compat: { supportsDeveloperRole: false, supportsStore: false, maxTokensField: 'max_tokens' },
      }],
    })
    return runtime.getModel('shennian-personal', current.mode === 'official' ? OFFICIAL_MODEL : current.model!)!
  }
  const model = configureModel()
  const settings = sdk.SettingsManager.inMemory({ compaction: personalCompactionSettings(current.contextWindow), retry: { enabled: false } })
  const loader = new sdk.DefaultResourceLoader({ cwd, agentDir: root, settingsManager: settings, noContextFiles: mode === 'validation' || mode === 'project-coordination', noExtensions: true, noSkills: true, noPromptTemplates: true, noThemes: true, appendSystemPrompt: [mode === 'personal' ? builtinPersonalSystemPrompt(prompt) : prompt] })
  await loader.reload()
  const spawnHook: import('@earendil-works/pi-coding-agent').BashSpawnHook = context => ({ ...context, env: mode === 'personal' ? { ...context.env, ...env() } : { ...env() } })
  const shell = process.platform === 'win32' ? sdk.createPowerShellToolDefinition(cwd, { spawnHook }) : sdk.createBashToolDefinition(cwd, { spawnHook })
  const { session } = await sdk.createAgentSession({ cwd, agentDir: root, modelRuntime: runtime, model, thinkingLevel: 'off', sessionManager: manager, settingsManager: settings, resourceLoader: loader,
    tools: personalSessionToolNames(mode, shell.name, coordinationTools), customTools: mode === 'project-coordination' ? coordinationTools : mode === 'validation' ? [] : [shell as unknown as ToolDefinition],
  })
  session.setAutoCompactionEnabled(true)
  const persist = () => {
    const file = manager.getSessionFile()
    if (file) {
      const temp = `${pointer}.${process.pid}.tmp`
      fs.writeFileSync(temp, JSON.stringify({ id: manager.getSessionId(), file: path.basename(file) }), { mode: 0o600 })
      fs.renameSync(temp, pointer)
    }
  }
  // Pi allocates the exact filename before its first persisted message.
  persist()
  return { session, runtime, refreshModel: async () => { await session.setModel(configureModel()); settings.applyOverrides({ compaction: personalCompactionSettings(current.contextWindow) }); persist() }, persist,
    cleanup: mode === 'validation' ? () => fs.rmSync(root, { recursive: true, force: true }) : undefined }
  } catch (error) {
    if (mode === 'validation') fs.rmSync(root, { recursive: true, force: true })
    throw error
  }
}
export type PersonalSdkSession = { session: AgentSession; runtime: ModelRuntime; refreshModel: () => Promise<void>; persist: () => void; cleanup?: () => void }
