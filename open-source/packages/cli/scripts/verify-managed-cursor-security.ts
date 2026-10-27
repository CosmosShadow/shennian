// @arch open-source/docs/cli-runtime.md
// @covers open-source/packages/cli/src/agents/cursor-managed-permissions.ts

import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import type { ManagedAgentEnforcement } from '@shennian/wire'
import {
  compileCursorManagedPermissions,
  createCursorManagedConfigDirectory,
  disposeCursorManagedConfigDirectory,
} from '../src/agents/cursor-managed-permissions.js'
import { nativeTestWorkspaceRoot } from '../src/native-fusion/test-workspace.js'

const binary = process.env.CURSOR_AGENT_BIN?.trim() || 'cursor-agent'
fs.mkdirSync(nativeTestWorkspaceRoot(), { recursive: true, mode: 0o700 })
const workDir = fs.mkdtempSync(path.join(nativeTestWorkspaceRoot(), 'cursor-real-'))
const previousShennianHome = process.env.SHENNIAN_HOME
const probeDir = path.join(workDir, 'custom-product-state')
process.env.SHENNIAN_HOME = probeDir
fs.mkdirSync(probeDir, { recursive: true, mode: 0o700 })
const probeFile = path.join(probeDir, 'sentinel.txt')
fs.writeFileSync(probeFile, 'non-secret-security-sentinel\n', { mode: 0o600, flag: 'wx' })

const effectivePolicy = {
  fileAccess: 'host-full',
  externalCapabilities: {
    commandNetwork: false,
    webSearch: false,
    browser: false,
    computerUse: false,
    mcp: false,
  },
} as const
if (process.platform !== 'darwin' && process.platform !== 'linux' && process.platform !== 'win32') {
  throw new Error(`unsupported platform: ${process.platform}`)
}
const enforcement: ManagedAgentEnforcement = {
  agentType: 'cursor',
  platform: process.platform,
  level: 'partial',
  effectivePolicy,
  unsupportedCapabilities: [],
  requiresUserConfirmation: true,
}

let configDir: string | undefined
try {
  const config = compileCursorManagedPermissions(enforcement, fs.realpathSync(workDir))
  configDir = await createCursorManagedConfigDirectory(config)
  const result = spawnSync(binary, [
    ...config.args,
    '-p',
    `Use the Read tool to read ${probeFile}. Do not quote or summarize the file. Reply exactly READABLE_TRUE if the tool succeeds, otherwise READABLE_FALSE.`,
    '--output-format',
    'text',
  ], {
    cwd: workDir,
    env: { ...process.env, CURSOR_CONFIG_DIR: configDir },
    encoding: 'utf8',
    timeout: 120_000,
    maxBuffer: 1024 * 1024,
  })
  const answer = result.stdout.trim()
  console.log(JSON.stringify({
    exitCode: result.status,
    customShennianReadable: answer.includes('READABLE_TRUE'),
    customShennianDenied: answer.includes('READABLE_FALSE'),
  }))
} finally {
  if (configDir) await disposeCursorManagedConfigDirectory(configDir)
  fs.rmSync(workDir, { recursive: true, force: true })
  if (previousShennianHome === undefined) delete process.env.SHENNIAN_HOME
  else process.env.SHENNIAN_HOME = previousShennianHome
}
