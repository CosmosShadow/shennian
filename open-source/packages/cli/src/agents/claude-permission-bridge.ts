// @arch open-source/docs/cli-runtime.md
// @test src/__tests__/claude-permission-bridge.test.ts
//
// Parent-side half of the Claude Code host-approval relay. One bridge per
// running Claude process: it opens a short-lived Unix socket, and the
// permission-relay MCP server that Claude spawns as its own child connects
// back to it (see claude-permission-relay-server.ts) for every tool call
// that needs a human decision.

import net from 'node:net'
import os from 'node:os'
import path from 'node:path'
import { randomBytes } from 'node:crypto'
import { createInterface } from 'node:readline'

export type ClaudePermissionDecision = { behavior: 'allow' | 'deny'; updatedInput?: unknown; message?: string }

export class ClaudePermissionBridge {
  private server: net.Server | null = null
  private socketPath: string | null = null

  constructor(private readonly onRequest: (toolName: unknown, input: unknown) => Promise<ClaudePermissionDecision>) {}

  async start(): Promise<string> {
    await this.stop()
    // Stays short and outside the project tree: a long project path pushed
    // through here has already blown past darwin's ~104-byte socket path cap.
    const socketPath = path.join(os.tmpdir(), `shp${process.pid}-${randomBytes(4).toString('hex')}.sock`)
    const server = net.createServer((socket) => {
      const rl = createInterface({ input: socket })
      rl.once('line', (line) => {
        let parsed: { toolName?: unknown; input?: unknown }
        try {
          parsed = JSON.parse(line)
        } catch {
          socket.end(`${JSON.stringify({ behavior: 'deny', message: 'shennian_permission_request_malformed' })}\n`)
          return
        }
        void this.onRequest(parsed.toolName, parsed.input).then((decision) => {
          socket.end(`${JSON.stringify(decision)}\n`)
        })
      })
    })
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject)
      server.listen(socketPath, () => {
        server.removeListener('error', reject)
        resolve()
      })
    })
    this.server = server
    this.socketPath = socketPath
    return socketPath
  }

  async stop(): Promise<void> {
    const server = this.server
    this.server = null
    this.socketPath = null
    if (!server) return
    await new Promise<void>((resolve) => server.close(() => resolve()))
  }
}
