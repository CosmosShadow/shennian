// @arch open-source/docs/cli-runtime.md
// @test src/__tests__/model-discovery.test.ts

import { randomBytes } from 'node:crypto'
import { createServer } from 'node:net'
import type { ModelInfo } from '@shennian/wire'
import { resolveBuiltinCommand, spawnResolvedCommand } from '../command-spec.js'
import { DETACH_PROCESS_GROUP, stopProcessTree } from '../process-tree.js'
import { buildAgentProcessEnv } from '../../agent-env.js'
import { DISCOVERY_WORKDIR } from './types.js'
import { parseOpenCodeProviderModels } from './parsers.js'

async function availablePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer()
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      const port = address && typeof address !== 'string' ? address.port : 0
      server.close(() => port ? resolve(port) : reject(new Error('OpenCode discovery port unavailable')))
    })
  })
}

export async function discoverOpenCodeModelsViaApi(): Promise<ModelInfo[]> {
  const spec = resolveBuiltinCommand('opencode')
  if (!spec) return []
  const port = await availablePort()
  const password = randomBytes(24).toString('hex')
  const proc = spawnResolvedCommand(spec, ['serve', '--hostname', '127.0.0.1', '--port', String(port)], {
    cwd: DISCOVERY_WORKDIR,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: buildAgentProcessEnv({ NO_COLOR: '1', OPENCODE_SERVER_PASSWORD: password }),
    detached: DETACH_PROCESS_GROUP,
  })
  // Drain both pipes: OpenCode may log startup diagnostics before it is ready.
  proc.stdout?.resume()
  proc.stderr?.resume()
  const auth = `Basic ${Buffer.from(`opencode:${password}`).toString('base64')}`
  const endpoint = `http://127.0.0.1:${port}`
  let closed = false
  proc.once('close', () => { closed = true })
  proc.once('error', () => { closed = true })
  try {
    const deadline = Date.now() + 10_000
    while (Date.now() < deadline && !closed) {
      try {
        const controller = new AbortController()
        const timer = setTimeout(() => controller.abort(), 2_000)
        try {
          const [providers, config] = await Promise.all([
            fetch(`${endpoint}/provider`, { headers: { Authorization: auth }, signal: controller.signal }),
            fetch(`${endpoint}/config`, { headers: { Authorization: auth }, signal: controller.signal }),
          ])
          if (providers.ok && config.ok) {
            return parseOpenCodeProviderModels(await providers.json(), await config.json())
          }
        } finally {
          clearTimeout(timer)
        }
      } catch {
        // The local server may still be starting.
      }
      await new Promise((resolve) => setTimeout(resolve, 200))
    }
    return []
  } finally {
    // `serve` starts helper processes of its own; stop the whole group so a slow
    // host is not left with a running server after discovery has given up.
    await stopProcessTree(proc, 1_000)
  }
}
