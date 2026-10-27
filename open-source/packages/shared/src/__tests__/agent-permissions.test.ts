// @covers open-source/packages/shared/src/lib/agent-permissions.ts

import { describe, expect, it } from 'vitest'
import type { AgentWorkspace } from '@shennian/wire'
import { normalizeAgentWorkspacePermissionPolicy } from '../lib/agent-permissions.js'

const baseAgent = {
  id: 'agent-1',
  displayName: 'Agent',
  description: '',
  systemPrompt: '',
  avatar: null,
  status: 'active',
  machineId: 'machine-1',
  machineName: 'Mac',
  runtimeAdapter: 'codex',
  workDir: '/code/project',
  modelId: null,
  sessionMode: 'standard',
  managerConfig: null,
  createdAt: '2026-09-05T00:00:00.000Z',
  updatedAt: '2026-09-05T00:00:00.000Z',
  sessions: [],
} satisfies AgentWorkspace

describe('Agent Local-first permission projection', () => {
  it('keeps an explicit server policy', () => {
    const projected = normalizeAgentWorkspacePermissionPolicy({
      ...baseAgent,
      permissionPolicy: {
        version: 7,
        fileAccess: 'workspace-read',
        externalCapabilities: {
          commandNetwork: false,
          webSearch: true,
          browser: false,
          computerUse: false,
          mcp: false,
        },
      },
    })
    expect(projected.permissionPolicy).toMatchObject({
      version: 7,
      executionMode: 'restricted',
      fileAccess: 'workspace-read',
    })
  })

  it('marks an old cached projection as legacy unrestricted', () => {
    const projected = normalizeAgentWorkspacePermissionPolicy(baseAgent)
    expect(projected.permissionPolicy).toEqual({
      version: 1,
      executionMode: 'restricted',
      fileAccess: 'host-full',
      externalCapabilities: {
        commandNetwork: true,
        webSearch: true,
        browser: true,
        computerUse: true,
        mcp: true,
      },
    })
  })
})
