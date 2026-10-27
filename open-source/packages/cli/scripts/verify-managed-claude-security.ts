// @arch open-source/docs/cli-runtime.md
// @covers open-source/packages/cli/src/agents/claude-managed-permissions.ts

import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import type { ManagedAgentEnforcement } from '@shennian/wire'
import {
  compileClaudeManagedPermissions,
} from '../src/agents/claude-managed-permissions.js'
import { resolveManagedRoomIpcPaths } from '../src/daemon-ipc/paths.js'
import { nativeTestWorkspaceRoot } from '../src/native-fusion/test-workspace.js'

const binary = process.env.CLAUDE_BIN?.trim() || 'claude'
fs.mkdirSync(nativeTestWorkspaceRoot(), { recursive: true, mode: 0o700 })
const workDir = fs.mkdtempSync(path.join(nativeTestWorkspaceRoot(), 'claude-real-'))
const previousShennianHome = process.env.SHENNIAN_HOME
const probeDir = path.join(workDir, 'custom-product-state')
process.env.SHENNIAN_HOME = probeDir
fs.mkdirSync(probeDir, { recursive: true, mode: 0o700 })
const probeFile = path.join(probeDir, 'sentinel.txt')
fs.writeFileSync(probeFile, 'non-secret-security-sentinel\n', { mode: 0o600, flag: 'wx' })
if (process.platform !== 'darwin' && process.platform !== 'linux' && process.platform !== 'win32') {
  throw new Error(`unsupported platform: ${process.platform}`)
}
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
const enforcement: ManagedAgentEnforcement = {
  agentType: 'claude',
  platform: process.platform,
  level: process.platform === 'darwin' ? 'hard' : 'partial',
  effectivePolicy,
  unsupportedCapabilities: [],
  requiresUserConfirmation: process.platform !== 'darwin',
}
const ipc = resolveManagedRoomIpcPaths()

try {
  const config = compileClaudeManagedPermissions(enforcement, fs.realpathSync(workDir), {
    internalReadPaths: [ipc.secretFile, ...(ipc.transport === 'unix_socket' ? [ipc.endpoint] : [])],
    internalUnixSockets: ipc.transport === 'unix_socket' ? [ipc.endpoint] : [],
  })
  const result = spawnSync(binary, [
    '-p',
    `Use the Read tool to read ${probeFile}. Do not quote or summarize the file. Reply exactly READABLE_TRUE if the tool succeeds, otherwise READABLE_FALSE.`,
    '--output-format',
    'text',
    ...config.args,
  ], {
    cwd: workDir,
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
  fs.rmSync(workDir, { recursive: true, force: true })
  if (previousShennianHome === undefined) delete process.env.SHENNIAN_HOME
  else process.env.SHENNIAN_HOME = previousShennianHome
}
