// @arch open-source/docs/cli-runtime.md
// @covers src/agent-env.ts

import { afterEach, describe, expect, it, vi } from 'vitest'
import path from 'node:path'
import {
  buildAgentProcessEnv,
  buildManagedAgentProcessEnv,
  buildManagedNativeFullProcessEnv,
  mergeAgentProcessEnv,
} from '../agent-env'
afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks() })

describe('agent process env', () => {
  it('strips obsolete Desktop launcher flags without changing Client ownership', () => {
    const bin = path.join(path.sep, 'daemon', 'bin')
    const extra = {
      ELECTRON_RUN_AS_NODE: '1', ELECTRON_NO_ASAR: '1',
      SHENNIAN_DESKTOP_CLI_SCRIPT: '/internal/cli.js',
      SHENNIAN_DESKTOP_CLI_BRIDGE: '/internal/bridge.js',
      PATH: bin,
      SHENNIAN_MANAGED_ROOM_CONTEXT: 'short-session-capability',
    }
    const restricted = buildManagedAgentProcessEnv({ agentType: 'claude', daemonEnv: extra, sessionEnv: extra })
    for (const env of [buildAgentProcessEnv(extra), buildManagedNativeFullProcessEnv(extra), restricted]) {
      expect(env.PATH).toContain(bin)
      expect(env.ELECTRON_RUN_AS_NODE).toBeUndefined()
      expect(env.ELECTRON_NO_ASAR).toBeUndefined()
      expect(env.SHENNIAN_DESKTOP_CLI_SCRIPT).toBeUndefined()
      expect(env.SHENNIAN_DESKTOP_CLI_BRIDGE).toBeUndefined()
      expect(env.SHENNIAN_MANAGED_ROOM_CONTEXT).toBe('short-session-capability')
    }
    expect(restricted.SHENNIAN_HOME).toBeUndefined()
  })
  it('merges daemon, user, and node bin paths when spawning agents', () => {
    const env = mergeAgentProcessEnv({
      daemonEnv: {
        PATH: path.delimiter === ';' ? 'C:\\DaemonBin' : '/daemon/bin',
        ANTHROPIC_API_KEY: 'old-key',
        OPENAI_BASE_URL: 'https://old.example',
      },
      userEnv: {
        PATH: path.delimiter === ';' ? 'C:\\UserBin' : '/user/bin',
        ANTHROPIC_API_KEY: 'new-key',
        OPENAI_BASE_URL: 'https://new.example',
        NEW_PROVIDER_TOKEN: 'new-provider',
      },
    })

    expect(env.PATH).toContain(path.dirname(process.execPath))
    expect(env.PATH).toContain(path.delimiter === ';' ? 'C:\\DaemonBin' : '/daemon/bin')
    expect(env.PATH).toContain(path.delimiter === ';' ? 'C:\\UserBin' : '/user/bin')
    expect(env.ANTHROPIC_API_KEY).toBe('new-key')
    expect(env.OPENAI_BASE_URL).toBe('https://new.example')
    expect(env.NEW_PROVIDER_TOKEN).toBe('new-provider')
  })

  it('applies explicit spawn extras last', () => {
    const env = mergeAgentProcessEnv({
      daemonEnv: { NO_COLOR: undefined },
      userEnv: { NO_COLOR: '0' },
      extra: { NO_COLOR: '1' },
    })

    expect(env.NO_COLOR).toBe('1')
  })

  it('strips a stale inherited schedule context when the session did not request one', () => {
    vi.stubEnv('SHENNIAN_SCHEDULE_CONTEXT', 'stale-personal-context')
    const env = buildAgentProcessEnv({})
    expect(env.SHENNIAN_SCHEDULE_CONTEXT).toBeUndefined()
  })

  it('passes through an explicit per-session schedule grant (steward only; see stewardSessionEnv)', () => {
    vi.stubEnv('SHENNIAN_SCHEDULE_CONTEXT', 'stale-personal-context')
    const env = buildAgentProcessEnv({ SHENNIAN_SCHEDULE_CONTEXT: 'steward-grant' })
    expect(env.SHENNIAN_SCHEDULE_CONTEXT).toBe('steward-grant')
  })

  it('does not inherit daemon secrets or arbitrary variables for managed agents', () => {
    const env = buildManagedAgentProcessEnv({
      agentType: 'codex',
      daemonEnv: {
        PATH: path.delimiter === ';' ? 'C:\\DaemonBin' : '/daemon/bin',
        HOME: '/Users/tester',
        LANG: 'zh_CN.UTF-8',
        OPENAI_API_KEY: 'daemon-secret',
        DATABASE_URL: 'database-secret',
        AWS_SECRET_ACCESS_KEY: 'cloud-secret',
      },
    })

    expect(env.PATH).toContain(path.dirname(process.execPath))
    expect(env.PATH).toContain(path.delimiter === ';' ? 'C:\\DaemonBin' : '/daemon/bin')
    expect(env.HOME).toBe('/Users/tester')
    expect(env.LANG).toBe('zh_CN.UTF-8')
    expect(env.OPENAI_API_KEY).toBeUndefined()
    expect(env.DATABASE_URL).toBeUndefined()
    expect(env.AWS_SECRET_ACCESS_KEY).toBeUndefined()
  })

  it('only accepts provider variables for a managed Agent with verified shell scrubbing', () => {
    const env = buildManagedAgentProcessEnv({
      agentType: 'codex',
      daemonEnv: { PATH: process.env.PATH },
      providerEnv: {
        OPENAI_BASE_URL: 'https://api.example.test',
        OPENAI_API_KEY: 'selected-provider-key',
        ANTHROPIC_API_KEY: 'wrong-provider-key',
        UNDECLARED_PROVIDER_TOKEN: 'undeclared-key',
      },
    })

    expect(env.OPENAI_BASE_URL).toBe('https://api.example.test')
    expect(env.OPENAI_API_KEY).toBe('selected-provider-key')
    expect(env.ANTHROPIC_API_KEY).toBeUndefined()
    expect(env.UNDECLARED_PROVIDER_TOKEN).toBeUndefined()

    const cursorEnv = buildManagedAgentProcessEnv({
      agentType: 'cursor',
      daemonEnv: { PATH: process.env.PATH },
      providerEnv: {
        CURSOR_API_KEY: 'selected-cursor-key',
        CURSOR_BASE_URL: 'must-not-pass',
        OPENAI_API_KEY: 'wrong-provider-key',
      },
    })

    // Cursor has no verified shell subprocess env filter. Authentication must
    // come from its native login store rather than an inherited API key.
    expect(cursorEnv.CURSOR_API_KEY).toBeUndefined()
    expect(cursorEnv.CURSOR_BASE_URL).toBeUndefined()
    expect(cursorEnv.OPENAI_API_KEY).toBeUndefined()
  })

  it('passes only managed Room and Manager capabilities while dropping host credentials', () => {
    const env = buildManagedAgentProcessEnv({
      agentType: 'claude',
      daemonEnv: {
        PATH: process.env.PATH,
        SHENNIAN_HOME: '/private/product-state',
        SHENNIAN_MACHINE_TOKEN: 'daemon-machine-token-must-not-pass',
      },
      sessionEnv: {
        SHENNIAN_MANAGED_ROOM_CONTEXT: 'short-lived-room-context',
        SHENNIAN_MANAGED_ROOM_IPC_ROOT: '/tmp/shennian-managed-room-test',
        SHENNIAN_MANAGER_SESSION_ID: 'manager-session',
        SHENNIAN_MANAGER_AGENT_SESSION_ID: 'manager-thread',
        SHENNIAN_MANAGER_WORKDIR: '/project',
        SHENNIAN_MANAGER_MODEL: 'codex',
        SHENNIAN_MANAGER_IPC_URL: 'http://127.0.0.1:1234',
        SHENNIAN_MANAGER_IPC_TOKEN: 'short-lived-manager-token',
        SHENNIAN_MACHINE_TOKEN: 'must-not-pass',
        SHENNIAN_AUTH_TOKEN: 'must-not-pass',
      },
      runtimeEnv: {
        NO_COLOR: '1',
        NODE_OPTIONS: '--require unexpected.js',
      },
    })

    expect(env.SHENNIAN_MANAGED_ROOM_CONTEXT).toBe('short-lived-room-context')
    expect(env.SHENNIAN_MANAGED_ROOM_IPC_ROOT).toBe('/tmp/shennian-managed-room-test')
    expect(env.SHENNIAN_MANAGER_SESSION_ID).toBe('manager-session')
    expect(env.SHENNIAN_MANAGER_AGENT_SESSION_ID).toBe('manager-thread')
    expect(env.SHENNIAN_MANAGER_WORKDIR).toBe('/project')
    expect(env.SHENNIAN_MANAGER_MODEL).toBe('codex')
    expect(env.SHENNIAN_MANAGER_IPC_URL).toBe('http://127.0.0.1:1234')
    expect(env.SHENNIAN_MANAGER_IPC_TOKEN).toBe('short-lived-manager-token')
    expect(env.NO_COLOR).toBe('1')
    expect(env.SHENNIAN_MACHINE_TOKEN).toBeUndefined()
    expect(env.SHENNIAN_AUTH_TOKEN).toBeUndefined()
    expect(env.SHENNIAN_HOME).toBeUndefined()
    expect(env.NODE_OPTIONS).toBeUndefined()
  })

  it('keeps ordinary native environment semantics but removes long-lived Shennian credentials', () => {
    const previousMachineToken = process.env.SHENNIAN_MACHINE_TOKEN
    const previousProviderKey = process.env.OPENAI_API_KEY
    process.env.SHENNIAN_MACHINE_TOKEN = 'long-lived-machine-token'
    process.env.OPENAI_API_KEY = 'ordinary-provider-key'
    try {
      const env = buildManagedNativeFullProcessEnv({
        SHENNIAN_MANAGED_ROOM_CONTEXT: 'short-lived-room-context',
        SHENNIAN_AUTH_TOKEN: 'must-not-pass',
      })
      expect(env.OPENAI_API_KEY).toBe('ordinary-provider-key')
      expect(env.SHENNIAN_MANAGED_ROOM_CONTEXT).toBe('short-lived-room-context')
      expect(env.SHENNIAN_MACHINE_TOKEN).toBeUndefined()
      expect(env.SHENNIAN_AUTH_TOKEN).toBeUndefined()
    } finally {
      if (previousMachineToken === undefined) delete process.env.SHENNIAN_MACHINE_TOKEN
      else process.env.SHENNIAN_MACHINE_TOKEN = previousMachineToken
      if (previousProviderKey === undefined) delete process.env.OPENAI_API_KEY
      else process.env.OPENAI_API_KEY = previousProviderKey
    }
  })

  it('keeps Pi native-full agent-dir and user provider environment without adding Shennian auth', () => {
    const previousAgentDir = process.env.PI_CODING_AGENT_DIR
    const previousCustomKey = process.env.CUSTOM_PI_PROVIDER_KEY
    process.env.PI_CODING_AGENT_DIR = path.join(path.sep, 'user', 'pi-agent')
    process.env.CUSTOM_PI_PROVIDER_KEY = 'provider-key-present'
    try {
      const env = buildManagedNativeFullProcessEnv({
        SHENNIAN_MANAGED_ROOM_CONTEXT: 'short-lived-room-context',
      })
      expect(env.PI_CODING_AGENT_DIR).toBe(path.join(path.sep, 'user', 'pi-agent'))
      expect(env.CUSTOM_PI_PROVIDER_KEY).toBe('provider-key-present')
      expect(env.SHENNIAN_MANAGED_ROOM_CONTEXT).toBe('short-lived-room-context')
      expect(env.SHENNIAN_MACHINE_TOKEN).toBeUndefined()
      expect(env.SHENNIAN_AUTH_TOKEN).toBeUndefined()
    } finally {
      if (previousAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR
      else process.env.PI_CODING_AGENT_DIR = previousAgentDir
      if (previousCustomKey === undefined) delete process.env.CUSTOM_PI_PROVIDER_KEY
      else process.env.CUSTOM_PI_PROVIDER_KEY = previousCustomKey
    }
  })

  it('normalizes case-insensitive Windows system keys without passing other values', () => {
    const env = buildManagedAgentProcessEnv({
      agentType: 'workbuddy',
      platform: 'win32',
      daemonEnv: {
        Path: 'C:\\DaemonBin',
        windir: 'C:\\Windows',
        userprofile: 'C:\\Users\\tester',
        APP_SECRET: 'must-not-pass',
      },
    })

    expect(env.PATH).toContain('C:\\DaemonBin')
    expect(env.WINDIR).toBe('C:\\Windows')
    expect(env.USERPROFILE).toBe('C:\\Users\\tester')
    expect(env.APP_SECRET).toBeUndefined()
    expect(env.Path).toBeUndefined()
    expect(env.path).toBeUndefined()
  })
})
