// @arch open-source/docs/cli-runtime.md
// @test src/__tests__/acp-adapter.test.ts

import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { Readable, Transform, Writable } from 'node:stream'
import * as acp from '@agentclientprotocol/sdk'
import type {
  InitializeResponse,
  RequestPermissionRequest,
  RequestPermissionResponse,
  SessionNotification,
} from '@agentclientprotocol/sdk'
import type { AcpLaunchSpec } from './types.js'
import { AcpClientServices, type AcpTerminalPolicy } from './client-services.js'
import { terminateProcessTree } from '../process-tree.js'

export type AcpProcessClientHandlers = {
  onSessionUpdate(params: SessionNotification): void | Promise<void>
  onPermission(params: RequestPermissionRequest): Promise<RequestPermissionResponse>
}

export class AcpProcessClient {
  private process: ChildProcessWithoutNullStreams | null = null
  private connection: acp.ClientConnection | null = null
  private initialization: InitializeResponse | null = null
  private stderr = ''
  private clientServices: AcpClientServices | null = null

  constructor(
    private readonly launch: AcpLaunchSpec,
    private readonly handlers: AcpProcessClientHandlers,
    private readonly environment: NodeJS.ProcessEnv = process.env,
    private readonly clientCapabilities: {
      readTextFile?: boolean
      writeTextFile?: boolean
      terminal?: boolean
      terminalAuth?: boolean
      terminalPolicy?: AcpTerminalPolicy
    } = {},
    private readonly timeouts: { initializeMs?: number; sessionMs?: number; authMs?: number } = {},
  ) {}

  get capabilities(): NonNullable<InitializeResponse['agentCapabilities']> {
    return this.initialization?.agentCapabilities ?? {}
  }

  get initializeResponse(): InitializeResponse | null {
    return this.initialization
  }

  async listSessions(cwd?: string, cursor?: string | null) {
    return withTimeout(this.agent.request(acp.methods.agent.session.list, { cwd, cursor }), this.timeouts.sessionMs ?? 8_000, 'ACP session list timed out')
  }

  async authenticate(methodId: string): Promise<void> {
    await withTimeout(this.agent.request(acp.methods.agent.authenticate, { methodId }), this.timeouts.authMs ?? 120_000, 'ACP authentication timed out')
  }

  async logout(): Promise<void> {
    await withTimeout(this.agent.request(acp.methods.agent.logout, {}), 8_000, 'ACP logout timed out')
  }

  async closeSession(sessionId: string): Promise<void> {
    await withTimeout(this.agent.request(acp.methods.agent.session.close, { sessionId }), 8_000, 'ACP session close timed out')
  }

  async deleteSession(sessionId: string): Promise<void> {
    await withTimeout(this.agent.request(acp.methods.agent.session.delete, { sessionId }), 8_000, 'ACP session delete timed out')
  }

  get agent() {
    if (!this.connection) throw new Error('ACP process is not connected')
    return this.connection.agent
  }

  async start(cwd: string): Promise<InitializeResponse> {
    if (this.connection) return this.initialization!
    const child = spawn(this.launch.command, this.launch.args ?? [], {
      cwd,
      env: { ...this.environment, ...this.launch.env },
      stdio: ['pipe', 'pipe', 'pipe'],
      detached: process.platform !== 'win32',
      windowsHide: true,
    })
    this.process = child
    child.stderr.on('data', (chunk: Buffer) => {
      if (this.stderr.length < 16_384) this.stderr += chunk.toString()
    })

    this.clientServices = Object.values(this.clientCapabilities).some(Boolean)
      ? new AcpClientServices(cwd, this.clientCapabilities, {
          ...this.environment,
          ...this.launch.env,
        })
      : null
    let app = acp.client({ name: 'Shennian' })
      .onRequest(acp.methods.client.session.requestPermission, ({ params }) => (
        this.handlers.onPermission(params)
      ))
      .onNotification(acp.methods.client.session.update, ({ params }) => (
        this.handlers.onSessionUpdate(params)
      ))
    if (this.clientServices?.enabled.readTextFile) {
      app = app.onRequest(acp.methods.client.fs.readTextFile, ({ params }) => this.clientServices!.readTextFile(params))
    }
    if (this.clientServices?.enabled.writeTextFile) {
      app = app.onRequest(acp.methods.client.fs.writeTextFile, ({ params }) => this.clientServices!.writeTextFile(params))
    }
    if (this.clientServices?.enabled.terminal) {
      app = app
        .onRequest(acp.methods.client.terminal.create, ({ params }) => this.clientServices!.createTerminal(params))
        .onRequest(acp.methods.client.terminal.output, ({ params }) => this.clientServices!.terminalOutput(params))
        .onRequest(acp.methods.client.terminal.waitForExit, ({ params }) => this.clientServices!.waitForTerminalExit(params))
        .onRequest(acp.methods.client.terminal.kill, ({ params }) => this.clientServices!.killTerminal(params))
        .onRequest(acp.methods.client.terminal.release, ({ params }) => this.clientServices!.releaseTerminal(params))
    }

    const boundedStdout = new Transform({
      transform: createBoundedStdoutTransform(() => terminateProcessTree(child, true)),
    })
    child.stdout.pipe(boundedStdout)
    const stream = acp.ndJsonStream(
      Writable.toWeb(child.stdin) as WritableStream<Uint8Array>,
      Readable.toWeb(boundedStdout) as ReadableStream<Uint8Array>,
    )
    const connection = app.connect(stream)
    this.connection = connection
    child.once('error', (error) => connection.close(error))
    child.once('exit', (code, signal) => {
      connection.close(new Error(`ACP agent exited (${code ?? signal ?? 'unknown'})`))
    })

    try {
      const result = await withTimeout(connection.agent.request(acp.methods.agent.initialize, {
          protocolVersion: acp.PROTOCOL_VERSION,
          clientCapabilities: {
            ...(this.clientServices?.capabilities ?? {}),
            ...(this.clientCapabilities.terminalAuth ? { auth: { terminal: true } } : {}),
          },
          clientInfo: { name: 'Shennian', version: '0.4.13' },
        }), this.timeouts.initializeMs ?? 8_000, 'ACP initialize timed out') as InitializeResponse
      if (result.protocolVersion !== acp.PROTOCOL_VERSION) {
        throw new Error(`Unsupported ACP protocol version ${result.protocolVersion}`)
      }
      this.initialization = result
      return result
    } catch (error) {
      await this.close()
      throw error
    }
  }

  async close(): Promise<void> {
    const connection = this.connection
    const child = this.process
    this.connection = null
    this.process = null
    this.initialization = null
    this.clientServices?.close()
    this.clientServices = null
    connection?.close()
    if (child && child.exitCode === null && child.signalCode === null) {
      terminateProcessTree(child)
      setTimeout(() => terminateProcessTree(child, true), 2_000).unref?.()
    }
  }
}

const MAX_ACP_LINE_BYTES = 4 * 1024 * 1024
const MAX_ACP_PROCESS_BYTES = 64 * 1024 * 1024

function createBoundedStdoutTransform(onLimit: () => void) {
  let total = 0
  let currentLine = 0
  return function (this: Transform, chunk: Buffer, _encoding: BufferEncoding, callback: (error?: Error | null, data?: Buffer) => void) {
    total += chunk.length
    for (const byte of chunk) currentLine = byte === 10 ? 0 : currentLine + 1
    if (total > MAX_ACP_PROCESS_BYTES || currentLine > MAX_ACP_LINE_BYTES) {
      onLimit()
      callback(new Error('ACP output exceeded safety limit'))
      return
    }
    callback(null, chunk)
  }
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(message)), timeoutMs)
      }),
    ])
  } finally {
    if (timer) clearTimeout(timer)
  }
}
