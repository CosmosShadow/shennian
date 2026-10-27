// @arch open-source/docs/cli-runtime.md
// @covers open-source/packages/cli/src/agents/opencode-managed-permissions.ts

import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import type { ManagedAgentEnforcement } from '@shennian/wire'
import {
  compileOpenCodeManagedPermissions,
  createOpenCodeManagedConfigDirectory,
  disposeOpenCodeManagedConfigDirectory,
} from '../src/agents/opencode-managed-permissions.js'
import { nativeTestWorkspaceRoot } from '../src/native-fusion/test-workspace.js'

fs.mkdirSync(nativeTestWorkspaceRoot(), { recursive: true, mode: 0o700 })
const workDir = fs.mkdtempSync(path.join(nativeTestWorkspaceRoot(), 'opencode-real-'))
const previousShennianHome = process.env.SHENNIAN_HOME
const customShennianHome = path.join(workDir, 'custom-product-state')
process.env.SHENNIAN_HOME = customShennianHome
fs.mkdirSync(customShennianHome, { recursive: true, mode: 0o700 })
if (process.platform !== 'darwin' && process.platform !== 'linux' && process.platform !== 'win32') {
  throw new Error(`unsupported platform: ${process.platform}`)
}
const effectivePolicy = {
  fileAccess: 'workspace-write',
  externalCapabilities: {
    commandNetwork: false,
    webSearch: false,
    browser: false,
    computerUse: false,
    mcp: false,
  },
} as const
const enforcement: ManagedAgentEnforcement = {
  agentType: 'opencode',
  platform: process.platform,
  level: 'partial',
  effectivePolicy,
  unsupportedCapabilities: [],
  requiresUserConfirmation: true,
}

let isolated: Awaited<ReturnType<typeof createOpenCodeManagedConfigDirectory>> | undefined
try {
  const config = compileOpenCodeManagedPermissions(enforcement, fs.realpathSync(workDir))
  isolated = await createOpenCodeManagedConfigDirectory(config)
  const result = spawnSync('opencode', ['debug', 'config', '--pure'], {
    cwd: workDir,
    env: {
      ...process.env,
      OPENCODE_CONFIG: isolated.configPath,
      OPENCODE_CONFIG_DIR: isolated.directory,
      OPENCODE_CONFIG_CONTENT: JSON.stringify(config.config),
      OPENCODE_DISABLE_PROJECT_CONFIG: 'true',
      OPENCODE_DISABLE_CLAUDE_CODE: '1',
      OPENCODE_DISABLE_CLAUDE_CODE_PROMPT: '1',
      OPENCODE_DISABLE_CLAUDE_CODE_SKILLS: '1',
    },
    encoding: 'utf8',
    timeout: 30_000,
    maxBuffer: 1024 * 1024,
  })
  const resolved = result.status === 0 ? JSON.parse(result.stdout) as Record<string, unknown> : {}
  const permission = resolved.permission as Record<string, unknown> | undefined
  const read = permission?.read as Record<string, unknown> | undefined
  const edit = permission?.edit as Record<string, unknown> | undefined
  const absoluteRule = `${customShennianHome.replaceAll('\\', '/')}/**`
  console.log(JSON.stringify({
    exitCode: result.status,
    shellDenied: permission?.bash === 'deny',
    customShennianReadDenied: read?.[absoluteRule] === 'deny',
    customShennianWriteDenied: edit?.[absoluteRule] === 'deny',
    mcpEmpty: resolved.mcp != null && Object.keys(resolved.mcp as object).length === 0,
  }))
} finally {
  if (isolated) await disposeOpenCodeManagedConfigDirectory(isolated.directory)
  fs.rmSync(workDir, { recursive: true, force: true })
  if (previousShennianHome === undefined) delete process.env.SHENNIAN_HOME
  else process.env.SHENNIAN_HOME = previousShennianHome
}
