// @arch open-source/docs/cli-runtime.md
// @covers src/agents/codex-managed-room-tools.ts

import fs from 'node:fs'
import path from 'node:path'
import { CodexAdapter } from '../src/agents/codex.js'
import { managedAttachmentDirectory } from '../src/room/managed-attachment-directory.js'
import type { CompiledManagedAgentPolicy } from '../src/security/managed-agent-policy.js'
import type { ManagedRoomExecutor } from '../src/room/managed-room-ipc.js'
import { nativeTestWorkspaceRoot } from '../src/native-fusion/test-workspace.js'

fs.mkdirSync(nativeTestWorkspaceRoot(), { recursive: true, mode: 0o700 })
const fixtureRoot = fs.realpathSync(fs.mkdtempSync(path.join(nativeTestWorkspaceRoot(), 'codex-tools-')))
const workDir = path.join(fixtureRoot, 'workspace')
fs.mkdirSync(workDir)
const attachmentDirectory = managedAttachmentDirectory(
  'managed-codex-dynamic-tool-canary',
  path.join(fixtureRoot, 'attachments'),
)
const attachmentPath = path.join(attachmentDirectory, 'attachment-canary.txt')
const attachmentMarker = 'SHENNIAN_MANAGED_ATTACHMENT_READ_OK'
fs.writeFileSync(attachmentPath, `${attachmentMarker}\n`)
const actions: string[] = []
let responseText = ''

const externalCapabilities = {
  commandNetwork: false,
  webSearch: false,
  browser: false,
  computerUse: false,
  mcp: false,
}
const policy: CompiledManagedAgentPolicy = {
  executionMode: 'native-full',
  requestedPolicy: {
    version: 1,
    executionMode: 'native-full',
    fileAccess: 'host-full',
    externalCapabilities,
  },
  enforcement: {
    level: 'hard',
    runtimeVersion: '0.152.1',
    platform: process.platform,
    unsupportedCapabilities: [],
    effectivePolicy: {
      version: 1,
      executionMode: 'native-full',
      fileAccess: 'host-full',
      externalCapabilities,
    },
  },
  adapterPolicy: {
    version: 1,
    workDir,
    fileAccess: 'host-full',
    externalCapabilities,
    denySensitiveFiles: true,
    failClosed: true,
  },
  environmentPolicy: {
    inheritDaemonEnv: false,
    loadLoginShell: false,
    providerEnvKeys: [],
    sessionEnvKeys: [],
    shellSubprocess: {
      inherit: 'none',
      allowedEnvKeys: ['PATH', 'HOME', 'TMPDIR', 'TMP', 'TEMP'],
      deniedEnvKeys: [],
    },
  },
}

const execute: ManagedRoomExecutor = async (input) => {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('invalid_input')
  const action = input.action
  if (typeof action !== 'string') throw new Error('invalid_action')
  actions.push(action)
  if (action === 'status') {
    return { room: { name: 'Dynamic Tool Canary', status: 'active', memberCount: 1 } }
  }
  if (action === 'read') return { messages: [] }
  if (action === 'attachment.get') {
    return {
      codexContentItems: [{
        type: 'inputText',
        text: JSON.stringify({
          name: path.basename(attachmentPath),
          localPath: attachmentPath,
          notice: 'Read this local file with the current file permissions.',
          nextAction: 'This exact localPath is a daemon-verified read-only attachment path pre-authorized for the current managed Room Session, even when it is outside the workspace. Read the exact localPath with an available local file or terminal tool. In Codex Code Mode, call tools.exec_command from the exec wrapper. Do not inspect its parent directory, search for a substitute copy, or infer file contents from metadata.',
        }),
      }],
    }
  }
  throw Object.assign(new Error('canary_action_forbidden'), { code: 'canary_action_forbidden' })
}

const adapter = new CodexAdapter({ hidden: true })
const terminal = new Promise<void>((resolve, reject) => {
  const timeout = setTimeout(() => reject(new Error('dynamic_tool_canary_timeout')), 120_000)
  adapter.on('agentEvent', (event) => {
    if (event.state === 'delta' && event.text) responseText += event.text
    if (event.state === 'final') {
      clearTimeout(timeout)
      resolve()
    } else if (event.state === 'error') {
      clearTimeout(timeout)
      reject(new Error(event.message ?? 'dynamic_tool_canary_failed'))
    }
  })
  adapter.on('error', (error) => {
    clearTimeout(timeout)
    reject(error)
  })
})

try {
  adapter.configure({
    sessionId: 'managed-codex-dynamic-tool-canary',
    managedAgentPolicy: policy,
    managedRoomContextToken: `mrc_${'c'.repeat(43)}`,
    managedRoomExecutor: execute,
  })
  await adapter.start('managed-codex-dynamic-tool-canary', workDir)
  await adapter.send(
    '[群消息] <安全验收员>\n获取 attachment-canary 附件并只回复它的真实文件内容，不得根据文件名或元数据猜测。',
    'gpt-6-sol',
    undefined,
    undefined,
    '这是无敏感信息的协议验收。必须依次调用 shennian 命名空间下的 shennian_room_status、shennian_room_read 与 shennian_room_attachment_get，attachmentId 为 attachment-canary，并根据附件工具返回契约完成真实文件读取。',
    { source: 'room_activation' },
  )
  await terminal
  if (!actions.includes('status') || !actions.includes('read') || !actions.includes('attachment.get')) {
    throw new Error(`dynamic_tool_canary_missing_calls:${actions.join(',') || 'none'}`)
  }
  if (!responseText.includes(attachmentMarker)) {
    throw new Error(`dynamic_tool_canary_local_read_missing:${responseText.trim() || 'empty'}`)
  }
  process.stdout.write('managed Codex dynamic tool canary passed: status,read,attachment.get,local-read\n')
} finally {
  await adapter.stop().catch(() => {})
  fs.rmSync(fixtureRoot, { recursive: true, force: true })
}
