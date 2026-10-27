// @covers src/__tests__/agents-e2e.ts

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const testDir = path.dirname(fileURLToPath(import.meta.url))
const agentE2ESource = fs.readFileSync(path.join(testDir, 'agents-e2e.ts'), 'utf8')

describe('agent E2E native history safety', () => {
  it('never cleans native Agent history automatically', () => {
    expect(agentE2ESource).not.toMatch(/cleanupAgentE2E|cleanupStaleAgentE2E/)
    expect(agentE2ESource).not.toMatch(/\.codex['"`], ['"`]sessions/)
    expect(agentE2ESource).not.toMatch(/\b(?:unlink|rm)Sync\s*\(/)
    expect(agentE2ESource).not.toMatch(/['"`]delete['"`],\s*['"`]--force['"`]/)
  })
})
