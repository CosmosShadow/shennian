// @covers src/agents/manager.ts

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { EventEmitter } from 'node:events'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const { codexSend, claudeSend, codexInstances, claudeInstances, runtime } = vi.hoisted(() => ({
  codexSend: vi.fn(async (_text: string, _modelId?: string) => {}),
  claudeSend: vi.fn(async (_text: string, _modelId?: string) => {}),
  codexInstances: [] as Array<{ options?: unknown; start: ReturnType<typeof vi.fn> }>,
  claudeInstances: [] as Array<{ options?: unknown; start: ReturnType<typeof vi.fn> }>,
  runtime: {
    registerManager: vi.fn(),
    bindManagerAdapterEvents: vi.fn(),
    ready: vi.fn(async () => {}),
    getManagerExternalChannelSystemPrompt: vi.fn(() => ''),
    setManagedAgentPolicy: vi.fn(),
    getInjectedEnv: vi.fn(() => ({
      SHENNIAN_MANAGER_SESSION_ID: 'manager-session',
      SHENNIAN_MANAGER_AGENT_SESSION_ID: 'manager-thread',
      SHENNIAN_MANAGER_WORKDIR: '/project',
      SHENNIAN_MANAGER_MODEL: 'codex',
      SHENNIAN_MANAGER_IPC_URL: 'http://127.0.0.1:1234',
      SHENNIAN_MANAGER_IPC_TOKEN: 'manager-token',
    })),
  },
}))

vi.mock('../manager/runtime.js', () => ({
  getManagerRuntimeService: () => runtime,
}))

vi.mock('../agents/codex.js', () => ({
  CodexAdapter: class extends EventEmitter {
    readonly type = 'codex'
    start = vi.fn(async () => {})
    send = codexSend
    resume = vi.fn(async () => {})
    stop = vi.fn(async () => {})
    configure = vi.fn()
    constructor(public options?: unknown) {
      super()
      codexInstances.push(this)
    }
  },
}))

vi.mock('../agents/claude.js', () => ({
  ClaudeAdapter: class extends EventEmitter {
    readonly type = 'claude'
    start = vi.fn(async () => {})
    send = claudeSend
    resume = vi.fn(async () => {})
    stop = vi.fn(async () => {})
    configure = vi.fn()
    constructor(public options?: unknown) {
      super()
      claudeInstances.push(this)
    }
  },
}))

import { combineManagerInstructions, ManagerAdapter, ManagerModeAdapter } from '../agents/manager.js'
import { MANAGER_SYSTEM_PROMPT } from '../manager/prompt.js'

describe('ManagerAdapter', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    codexInstances.length = 0
    claudeInstances.length = 0
  })

  it('keeps managed Worker Agent and model fixed to the current Manager', () => {
    expect(MANAGER_SYSTEM_PROMPT).toContain('固定继承当前 Manager 的 Agent 和模型')
    expect(MANAGER_SYSTEM_PROMPT).toContain('sessions start --title <短标题> --message <完整任务>')
    expect(MANAGER_SYSTEM_PROMPT).not.toContain('sessions start --agent')
    expect(MANAGER_SYSTEM_PROMPT).not.toContain('sessions start --model')
  })

  it('uses stable substrate instructions without polluting the user message', async () => {
    const adapter = new ManagerAdapter()
    const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'shennian-manager-adapter-'))

    await adapter.start('manager-session', workDir)
    await adapter.send('列出 worker', 'codex')

    expect(codexSend).toHaveBeenCalledTimes(1)
    expect(codexSend.mock.calls[0][0]).toBe('列出 worker')
    expect(codexSend.mock.calls[0]).toHaveLength(1)
    expect(codexInstances[0]?.options).toMatchObject({
      hidden: true,
      modelInstructionsFile: path.join(workDir, '.shennian', 'runtime', 'manager', 'manager-session', 'instructions.md'),
    })
    expect(claudeSend).not.toHaveBeenCalled()
  })

  it('inserts Manager mode between managed policy and the private Agent/Room layers', () => {
    const roomPrompt = [
      '[神念受管会话规则]\nRoom policy',
      '[智能体私有系统提示词]\nPrivate Agent prompt',
      '[智能体身份]\n名称：研发助手',
      '[当前群聊]\n群聊：研发群',
      '[当前群聊命令]\nshennian room send [--file <本地文件路径> ...]',
    ].join('\n\n')
    const combined = combineManagerInstructions('Manager instructions', roomPrompt)

    expect(combined.indexOf('[神念受管会话规则]')).toBeLessThan(combined.indexOf('[会话模式]'))
    expect(combined.indexOf('[会话模式]')).toBeLessThan(combined.indexOf('[智能体私有系统提示词]'))
    expect(combined.indexOf('[智能体私有系统提示词]')).toBeLessThan(combined.indexOf('[当前群聊]'))
    expect(combined).toContain('Manager instructions')
    expect(combined).toContain('shennian room send [--file <本地文件路径> ...]')
  })

  it('injects the session-scoped Manager capability into an existing managed Agent', async () => {
    const inner = new (await import('../agents/codex.js')).CodexAdapter()
    const adapter = new ManagerModeAdapter(inner as never, 'codex')
    const managedAgentPolicy = { environmentPolicy: {} } as never

    adapter.configure({
      sessionId: 'manager-session',
      env: { SHENNIAN_MANAGED_ROOM_CONTEXT: 'room-context' },
      managedAgentPolicy,
    })
    await adapter.start('manager-session', '/project', 'manager-thread')

    expect(inner.configure).toHaveBeenLastCalledWith({
      sessionId: 'manager-session',
      env: {
        SHENNIAN_MANAGED_ROOM_CONTEXT: 'room-context',
        SHENNIAN_MANAGER_SESSION_ID: 'manager-session',
        SHENNIAN_MANAGER_AGENT_SESSION_ID: 'manager-thread',
        SHENNIAN_MANAGER_WORKDIR: '/project',
        SHENNIAN_MANAGER_MODEL: 'codex',
        SHENNIAN_MANAGER_IPC_URL: 'http://127.0.0.1:1234',
        SHENNIAN_MANAGER_IPC_TOKEN: 'manager-token',
      },
      managedAgentPolicy,
    })
  })

  it('uses Pi as a first-class Manager substrate instead of a separate Manager provider', async () => {
    const inner = Object.assign(new EventEmitter(), {
      type: 'pi-coding-agent' as const,
      configure: vi.fn(),
      start: vi.fn(async () => {}),
      send: vi.fn(async () => {}),
      resume: vi.fn(async () => {}),
      stop: vi.fn(async () => {}),
    })
    const adapter = new ManagerModeAdapter(inner as never, 'pi-coding-agent')
    await adapter.start('manager-session', '/project', 'pi-session')

    expect(runtime.getInjectedEnv).toHaveBeenCalledWith(
      'manager-session', 'pi-session', '/project', 'pi-coding-agent',
    )
    expect(inner.start).toHaveBeenCalledWith('manager-session', '/project', 'pi-session', undefined)

    const context = { source: 'room_activation' as const }
    await adapter.send('hello', 'user-provider/deepseek-flash', 'off', undefined, 'Private instructions', context)
    expect(inner.send).toHaveBeenCalledWith(
      'hello', 'user-provider/deepseek-flash', 'off', undefined,
      expect.stringContaining('Private instructions'), context,
    )
    expect(runtime.registerManager).toHaveBeenLastCalledWith(expect.objectContaining({
      agentType: 'pi-coding-agent', providerModelId: 'user-provider/deepseek-flash',
    }))
  })
})
