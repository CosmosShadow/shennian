// @covers open-source/packages/agent-protocol/sdk/node/src/agent.ts
// @covers open-source/packages/agent-protocol/sdk/python/shennian_agent/agent.py

import path from 'node:path'
import { spawn } from 'node:child_process'
import { describe, expect, it } from 'vitest'

const projectRoot = path.resolve(import.meta.dirname, '../../../..')
const nodeExample = path.join(projectRoot, 'packages/agent-protocol/sdk/node/examples/simple.mjs')
const pythonExample = path.join(projectRoot, 'packages/agent-protocol/sdk/python/examples/simple.py')
const pythonSdk = path.join(projectRoot, 'packages/agent-protocol/sdk/python')

function parseLines(stdout: string): Array<Record<string, unknown>> {
  return stdout.trim().split('\n').filter(Boolean).map((line) => JSON.parse(line))
}

function run(command: string, args: string[], env: NodeJS.ProcessEnv = process.env): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { env, stdio: ['pipe', 'pipe', 'pipe'] })
    let stdout = ''
    let stderr = ''
    child.stdout.setEncoding('utf8').on('data', (chunk) => { stdout += chunk })
    child.stderr.setEncoding('utf8').on('data', (chunk) => { stderr += chunk })
    child.once('error', reject)
    child.once('close', (code) => code === 0 ? resolve(stdout) : reject(new Error(`fixture exited ${code}: ${stderr}`)))
    child.stdin.end('Continue.\n')
  })
}

describe('Agent Protocol SDK upgrade recovery fixtures', () => {
  it('Node SDK restores the exact session then delivers one Continue turn', async () => {
    const stdout = await run(process.execPath, [
      nodeExample, '/run', '--session', 'shennian-session', '--resume', 'native-node-session',
    ])
    const events = parseLines(stdout)
    expect(events.map((event) => event.state)).toEqual(['delta', 'final'])
    expect(events[0]).toMatchObject({
      text: 'You said: Continue.', agentSessionId: 'native-node-session',
    })
    expect(events[1]).toMatchObject({ agentSessionId: 'native-node-session' })
  })

  it('Python SDK restores the exact session then delivers one Continue turn', async () => {
    const stdout = await run('python3', [
      pythonExample, '/run', '--session', 'shennian-session', '--resume', 'native-python-session',
    ], { ...process.env, PYTHONPATH: pythonSdk })
    const events = parseLines(stdout)
    expect(events.map((event) => event.state)).toEqual(['delta', 'final'])
    expect(events[0]).toMatchObject({
      text: 'You said: Continue.\n', agentSessionId: 'native-python-session',
    })
    expect(events[1]).toMatchObject({ agentSessionId: 'native-python-session' })
  })
})
