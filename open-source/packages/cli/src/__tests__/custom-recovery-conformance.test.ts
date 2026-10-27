// @covers open-source/packages/cli/src/agents/custom-recovery-conformance.ts
// @covers open-source/packages/cli/src/agents/custom.ts

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { CustomAgentAdapter } from '../agents/custom.js'
import { resolveCustomRuntimeExecutableFingerprint } from '../agents/custom-managed-runtime.js'
import {
  hasCustomResumeConformance,
  recordCustomResumeConformance,
} from '../agents/custom-recovery-conformance.js'

const roots: string[] = []
afterEach(() => {
  delete process.env.SHENNIAN_HOME
  roots.splice(0).forEach((root) => fs.rmSync(root, { recursive: true, force: true }))
})

describe('Custom Agent resume conformance', () => {
  it('does not trust resume self-report and invalidates evidence when executable changes', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'custom-recovery-conformance-'))
    roots.push(root)
    process.env.SHENNIAN_HOME = path.join(root, 'home')
    const executable = path.join(root, 'agent.mjs')
    fs.writeFileSync(executable, 'console.log("v1")')
    const entry = {
      command: `${process.execPath} ${executable}`,
      caps: { name: 'fixture', mode: 'spawn' as const, resume: true, version: '1.0.0' },
    }
    const fingerprint = resolveCustomRuntimeExecutableFingerprint(entry)!
    const before = new CustomAgentAdapter('fixture', entry)
    expect(before.recoveryCapabilities.resumeSession).toBe(false)

    recordCustomResumeConformance('custom:fixture', fingerprint, '1.0.0')
    expect(hasCustomResumeConformance('custom:fixture', fingerprint, '1.0.0')).toBe(true)
    const verified = new CustomAgentAdapter('fixture', entry)
    expect(verified.recoveryCapabilities.resumeSession).toBe(true)

    fs.writeFileSync(executable, 'console.log("v2")')
    const changed = new CustomAgentAdapter('fixture', entry)
    expect(changed.recoveryCapabilities.resumeSession).toBe(false)
  })
})
