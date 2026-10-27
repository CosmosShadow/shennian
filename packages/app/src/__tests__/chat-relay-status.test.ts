// @arch docs/features/app-relay-connectivity.md#六、界面与交互方案
// @covers app/(main)/spaces/agent-add.tsx

import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

const root = path.resolve(import.meta.dirname, '..', '..')
const read = (relative: string) => fs.readFileSync(path.join(root, relative), 'utf8')

describe('chat relay status integration', () => {
  it('keeps Agent selection in place and exposes a specific connectivity error', () => {
    const addAgent = read('src/features/rooms/screens/RoomAgentAddScreen.tsx')
    expect(addAgent).toContain("{ kind: 'connectivity'; agentId: string }")
    expect(addAgent).toContain("'relay_agent_init_unavailable'")
    expect(addAgent).toContain("accountRuntime.reconnect('manual')")
  })
})
