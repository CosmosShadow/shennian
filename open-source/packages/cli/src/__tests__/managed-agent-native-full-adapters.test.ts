// @arch open-source/docs/cli-runtime.md
// @covers src/agents/codex.ts
// @covers src/agents/claude.ts
// @covers src/agents/cursor.ts
// @covers src/agents/workbuddy.ts
// @covers src/agents/opencode.ts
// @covers src/agents/pi-coding-agent.ts
// @covers src/agents/custom.ts

import { codexThreadPermissionParams } from '../agents/codex-conversation-settings.js'
import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const agentsRoot = path.resolve(__dirname, '../agents')
const source = (name: string) => fs.readFileSync(path.join(agentsRoot, name), 'utf8')

describe('managed Agent native-full adapter contracts', () => {
  it('keeps the ordinary Codex default full-access without personal overrides', () => {
    expect(codexThreadPermissionParams()).toMatchObject({ sandbox: 'danger-full-access', approvalPolicy: 'never' })
  })

  it.each([
    ['claude.ts', "args.push('--dangerously-skip-permissions')"],
    ['cursor.ts', "args: ['--trust']"],
    ['workbuddy.ts', "'bypassPermissions'"],
    ['opencode.ts', "args: ['--auto']"],
    ['pi-coding-agent.ts', 'buildManagedNativeFullProcessEnv'],
    ['custom.ts', 'buildManagedNativeFullProcessEnv'],
  ])('%s retains its ordinary full-access launch primitive', (file, primitive) => {
    expect(source(file)).toContain(primitive)
  })

  it.each([
    'codex.ts',
    'claude.ts',
    'cursor.ts',
    'workbuddy.ts',
    'opencode.ts',
    'pi-coding-agent.ts',
    'custom.ts',
  ])('%s explicitly branches managed native-full away from restricted compilation', (file) => {
    const contents = source(file)
    expect(contents).toContain('isManagedAgentNativeFull')
    expect(contents).toContain('buildManagedNativeFullProcessEnv')
  })

  it('keeps Codex Room dynamic tools independent from the restricted permission profile', () => {
    const contents = source('codex.ts')
    expect(contents).toContain('this.managedAgentPolicy && managedRoomToolSurface')
    expect(contents).toContain('? CODEX_MANAGED_MANAGER_DYNAMIC_TOOLS')
    expect(contents).toContain(': CODEX_MANAGED_ROOM_DYNAMIC_TOOLS')
  })
})
