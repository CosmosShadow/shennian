// @covers src/agents/custom.ts
// @covers src/session/manager.ts

import fs from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

type ChatRequest = {
  model: string
  messages: Array<{ role: string; content: string }>
}

type RelayEnvelope = {
  type: string
  event?: string
  payload?: Record<string, any>
  ok?: boolean
}

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(__dirname, '../../../..')
const cliEntry = path.resolve(__dirname, '../index.ts')
const nodeDemoSource = path.resolve(repoRoot, 'packages/agent-protocol/examples/node/agent.mjs')
const pythonDemoSource = path.resolve(repoRoot, 'packages/agent-protocol/examples/python/agent.py')

class MockRelayClient {
  readonly events: RelayEnvelope[] = []
  readonly agentEvents: RelayEnvelope[] = []
  readonly responses: RelayEnvelope[] = []

  sendRes(payload: RelayEnvelope): void {
    this.responses.push(payload)
  }

  sendEvent(payload: RelayEnvelope): void {
    this.events.push(payload)
  }

  sendAgentEvent(payload: RelayEnvelope): void {
    this.agentEvents.push(payload)
  }

  waitForTerminal(sessionId: string, timeoutMs = 10_000): Promise<RelayEnvelope> {
    const start = Date.now()
    return new Promise((resolve, reject) => {
      const poll = () => {
        const found = this.agentEvents.find((event) => {
          const payload = event.payload
          return payload?.sessionId === sessionId && (payload.state === 'final' || payload.state === 'error')
        })
        if (found) {
          resolve(found)
          return
        }
        if (Date.now() - start > timeoutMs) {
          reject(new Error(`Timed out waiting for terminal event of ${sessionId}`))
          return
        }
        setTimeout(poll, 20)
      }
      poll()
    })
  }

  waitForText(sessionId: string, text: string, timeoutMs = 10_000): Promise<RelayEnvelope> {
    const start = Date.now()
    return new Promise((resolve, reject) => {
      const poll = () => {
        const found = this.agentEvents.find((event) => {
          const payload = event.payload
          return payload?.sessionId === sessionId && typeof payload.text === 'string' && payload.text.includes(text)
        })
        if (found) {
          resolve(found)
          return
        }
        const error = this.agentEvents.find((event) => {
          const payload = event.payload
          return payload?.sessionId === sessionId && payload.state === 'error'
        })
        if (error) {
          reject(new Error(`Agent error while waiting for ${sessionId}: ${JSON.stringify(error.payload)}`))
          return
        }
        if (Date.now() - start > timeoutMs) {
          reject(new Error(`Timed out waiting for text event of ${sessionId}`))
          return
        }
        setTimeout(poll, 20)
      }
      poll()
    })
  }
}

function runCli(args: string[], env: NodeJS.ProcessEnv): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const proc = spawn(process.execPath, ['--import', 'tsx', cliEntry, ...args], {
      cwd: repoRoot,
      env: { ...process.env, ...env },
      stdio: ['ignore', 'pipe', 'pipe'],
    })

    let stdout = ''
    let stderr = ''

    proc.stdout.on('data', (chunk: Buffer) => { stdout += chunk.toString() })
    proc.stderr.on('data', (chunk: Buffer) => { stderr += chunk.toString() })
    proc.on('error', reject)
    proc.on('close', (code) => {
      if (code === 0) {
        resolve({ stdout, stderr })
        return
      }
      reject(new Error(`CLI exited with ${code}\nstdout:\n${stdout}\nstderr:\n${stderr}`))
    })
  })
}

async function startMockDeepSeek() {
  const requests: ChatRequest[] = []
  const server = http.createServer((req, res) => {
    if (req.method !== 'POST' || req.url !== '/chat/completions') {
      res.writeHead(404).end()
      return
    }

    const chunks: Buffer[] = []
    req.on('data', (chunk) => chunks.push(Buffer.from(chunk)))
    req.on('end', () => {
      const payload = JSON.parse(Buffer.concat(chunks).toString('utf8')) as ChatRequest
      requests.push(payload)
      const userMessages = payload.messages.filter((message) => message.role === 'user')
      const lastUser = userMessages[userMessages.length - 1]?.content ?? ''
      const content = `model=${payload.model};turn=${userMessages.length};last=${lastUser}`

      const body = JSON.stringify({
        choices: [{ message: { content } }],
        usage: {
          prompt_tokens: 100 + userMessages.length,
          completion_tokens: 10 + userMessages.length,
        },
      })
      res.writeHead(200, {
        'content-type': 'application/json',
        'content-length': Buffer.byteLength(body),
        connection: 'close',
      })
      res.end(body)
    })
  })

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Failed to bind mock DeepSeek server')

  return {
    requests,
    url: `http://127.0.0.1:${address.port}`,
    async close() {
      await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))
    },
  }
}

function writeDemoFixture(
  sourcePath: string,
  demoRoot: string,
  envLines: string[],
): string {
  fs.mkdirSync(demoRoot, { recursive: true })
  const targetPath = path.join(demoRoot, path.basename(sourcePath))
  fs.copyFileSync(sourcePath, targetPath)
  fs.writeFileSync(path.join(demoRoot, '.env'), envLines.join('\n') + '\n')
  return targetPath
}

async function importFreshCliModules() {
  vi.resetModules()
  const [{ SessionManager }, adapterModule, epochModule] = await Promise.all([
    import('../session/manager.js'),
    import('../agents/adapter.js'),
    import('../personal-sync/epoch.js'),
  ])
  return {
    SessionManager,
    getRegisteredAgents: adapterModule.getRegisteredAgents,
    getPersonalSyncIdentity: epochModule.getPersonalSyncIdentity,
  }
}

describe('custom agent flow', () => {
  let tempHome: string
  let tempRoot: string
  let originalProxyEnv: Partial<NodeJS.ProcessEnv>

  beforeEach(() => {
    const unitRoot = path.join(os.tmpdir(), 'shennian-tests', 'unit')
    fs.mkdirSync(unitRoot, { recursive: true })
    tempHome = fs.mkdtempSync(path.join(unitRoot, 'custom-home-'))
    tempRoot = fs.mkdtempSync(path.join(unitRoot, 'custom-demo-'))
    process.env.SHENNIAN_HOME = tempHome
    originalProxyEnv = {
      HTTP_PROXY: process.env.HTTP_PROXY,
      HTTPS_PROXY: process.env.HTTPS_PROXY,
      ALL_PROXY: process.env.ALL_PROXY,
      http_proxy: process.env.http_proxy,
      https_proxy: process.env.https_proxy,
      all_proxy: process.env.all_proxy,
      NO_PROXY: process.env.NO_PROXY,
      no_proxy: process.env.no_proxy,
    }
    for (const key of ['HTTP_PROXY', 'HTTPS_PROXY', 'ALL_PROXY', 'http_proxy', 'https_proxy', 'all_proxy']) {
      delete process.env[key]
    }
    process.env.NO_PROXY = '127.0.0.1,localhost'
    process.env.no_proxy = '127.0.0.1,localhost'
  })

  afterEach(() => {
    delete process.env.SHENNIAN_HOME
    for (const key of ['HTTP_PROXY', 'HTTPS_PROXY', 'ALL_PROXY', 'http_proxy', 'https_proxy', 'all_proxy', 'NO_PROXY', 'no_proxy']) {
      const value = originalProxyEnv[key]
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
  })

  it('registers node and python demos, runs chat + resume, and removes them', async () => {
    const mockDeepSeek = await startMockDeepSeek()
    try {
      const nodeAgentPath = writeDemoFixture(nodeDemoSource, path.join(tempRoot, 'node-demo'), [
        'DEEPSEEK_API_KEY=test-key',
        `DEEPSEEK_BASE_URL=${mockDeepSeek.url}`,
        'DEEPSEEK_DEFAULT_MODEL=deepseek-chat',
        'DEEPSEEK_REASONER_MODEL=deepseek-reasoner',
        'NO_PROXY=127.0.0.1,localhost',
        'no_proxy=127.0.0.1,localhost',
        'HTTP_PROXY=',
        'HTTPS_PROXY=',
        'ALL_PROXY=',
        'http_proxy=',
        'https_proxy=',
        'all_proxy=',
      ])
      const pythonAgentPath = writeDemoFixture(pythonDemoSource, path.join(tempRoot, 'python-demo'), [
        'DEEPSEEK_API_KEY=test-key',
        `DEEPSEEK_BASE_URL=${mockDeepSeek.url}`,
        'DEEPSEEK_DEFAULT_MODEL=deepseek-chat',
        'DEEPSEEK_REASONER_MODEL=deepseek-reasoner',
        'NO_PROXY=127.0.0.1,localhost',
        'no_proxy=127.0.0.1,localhost',
        'HTTP_PROXY=',
        'HTTPS_PROXY=',
        'ALL_PROXY=',
        'http_proxy=',
        'https_proxy=',
        'all_proxy=',
      ])

      await runCli(['runtime', 'add', 'demo-node', '--command', `node ${nodeAgentPath}`], { SHENNIAN_HOME: tempHome })
      await runCli(['runtime', 'add', 'demo-python', '--command', `python3 ${pythonAgentPath}`], { SHENNIAN_HOME: tempHome })

      const listed = await runCli(['runtime', 'list'], { SHENNIAN_HOME: tempHome })
      expect(listed.stdout).toContain('demo-node')
      expect(listed.stdout).toContain('demo-python')
      expect(JSON.parse(listed.stdout)).toMatchObject({
        ok: true,
        result: {
          runtimes: [
            { runtimeRef: 'custom:demo-node', models: ['deepseek-chat', 'deepseek-reasoner'] },
            { runtimeRef: 'custom:demo-python', models: ['deepseek-chat', 'deepseek-reasoner'] },
          ],
        },
      })

      const config = JSON.parse(fs.readFileSync(path.join(tempHome, 'config.json'), 'utf8')) as {
        customAgents: Record<string, { caps: { models: string[]; resume: boolean } }>
      }
      expect(config.customAgents['demo-node'].caps.models).toEqual(['deepseek-chat', 'deepseek-reasoner'])
      expect(config.customAgents['demo-node'].caps.resume).toBe(true)
      expect(config.customAgents['demo-python'].caps.resume).toBe(true)

      const { SessionManager, getRegisteredAgents, getPersonalSyncIdentity } = await importFreshCliModules()
      const personalIdentity = getPersonalSyncIdentity()
      const client = new MockRelayClient()
      const manager = new SessionManager(client as never)

      expect(getRegisteredAgents()).toContain('custom:demo-node')
      expect(getRegisteredAgents()).toContain('custom:demo-python')

      for (const entry of [
        { name: 'demo-node', agentType: 'custom:demo-node' },
        { name: 'demo-python', agentType: 'custom:demo-python' },
      ]) {
        const firstSessionId = `${entry.name}-session`
        const firstPrompt = `${entry.name} first turn`
        const secondPrompt = `${entry.name} second turn`

        const firstTerminal = client.waitForTerminal(firstSessionId)
        await manager.handleReq({
          type: 'req',
          id: `${entry.name}-req-1`,
          method: 'chat.send',
          params: {
            ...personalIdentity,
            sessionId: firstSessionId,
            text: firstPrompt,
            agentType: entry.agentType,
            workDir: tempRoot,
            modelId: 'deepseek-reasoner',
          },
        })
        await firstTerminal

        const firstDelta = await client.waitForText(firstSessionId, 'model=deepseek-reasoner;turn=1')
        expect(firstDelta?.payload?.text).toContain('model=deepseek-reasoner;turn=1')

        const sessionUpdate = client.events.find((event) => {
          const session = event.payload?.session
          return event.event === 'session.update' && session?.id === firstSessionId && !!session.agentSessionId
        })
        const agentSessionId = sessionUpdate?.payload?.session?.agentSessionId
        expect(agentSessionId).toBeTruthy()

        await manager.cleanup()

        const resumedClient = new MockRelayClient()
        const resumedManager = new SessionManager(resumedClient as never)
        const secondTerminal = resumedClient.waitForTerminal(firstSessionId)
        await resumedManager.handleReq({
          type: 'req',
          id: `${entry.name}-req-2`,
          method: 'chat.send',
          params: {
            ...personalIdentity,
            sessionId: firstSessionId,
            text: secondPrompt,
            agentType: entry.agentType,
            workDir: tempRoot,
            agentSessionId,
            modelId: 'deepseek-chat',
          },
        })
        await secondTerminal

        const secondDelta = await resumedClient.waitForText(firstSessionId, 'model=deepseek-chat;turn=2')
        expect(secondDelta?.payload?.text).toContain('model=deepseek-chat;turn=2')

        const matchingRequests = mockDeepSeek.requests.filter((request) =>
          request.messages.some((message) => message.role === 'user' && typeof message.content === 'string' && message.content.includes(entry.name)),
        )
        expect(matchingRequests).toHaveLength(2)
        expect(matchingRequests[1]?.messages.map((message) => message.content)).toContain(firstPrompt)
        expect(matchingRequests[1]?.messages.some((message) =>
          message.role === 'assistant' && message.content.includes('turn=1'),
        )).toBe(true)

        await resumedManager.cleanup()
      }

      await runCli(['runtime', 'remove', 'demo-node'], { SHENNIAN_HOME: tempHome })
      await runCli(['runtime', 'remove', 'demo-python'], { SHENNIAN_HOME: tempHome })

      const listedAfterRemove = await runCli(['runtime', 'list'], { SHENNIAN_HOME: tempHome })
      expect(JSON.parse(listedAfterRemove.stdout)).toMatchObject({
        ok: true,
        result: { runtimes: [] },
      })

      const { SessionManager: EmptySessionManager, getRegisteredAgents: getAgentsAfterRemove } = await importFreshCliModules()
      const emptyManager = new EmptySessionManager(new MockRelayClient() as never)
      expect(getAgentsAfterRemove()).not.toContain('custom:demo-node')
      expect(getAgentsAfterRemove()).not.toContain('custom:demo-python')
      await emptyManager.cleanup()
    } finally {
      await mockDeepSeek.close()
    }
  // This exercises several CLI startups plus both example processes. A full
  // release run can exceed 30s while compiling independent test modules.
  }, 60_000)
})
