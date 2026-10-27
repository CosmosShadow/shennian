// @arch open-source/docs/cli-runtime.md
// @test src/__tests__/acp-client-services.test.ts

import fs from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import type * as acp from '@agentclientprotocol/sdk'
import { terminateProcessTree } from '../process-tree.js'
import { resolveBuiltinCommand } from '../command-spec.js'

export type AcpTerminalPolicy = 'unrestricted' | 'managed-room-only'

type Terminal = {
  child: ChildProcessWithoutNullStreams
  output: Buffer
  limit: number
  truncated: boolean
  exitStatus: { exitCode: number | null; signal: string | null } | null
  exited: Promise<{ exitCode: number | null; signal: string | null }>
}

export class AcpClientServices {
  private readonly root: string
  private readonly environment: NodeJS.ProcessEnv
  private readonly terminals = new Map<string, Terminal>()

  constructor(
    workDir: string,
    readonly enabled: {
      readTextFile?: boolean
      writeTextFile?: boolean
      terminal?: boolean
      terminalPolicy?: AcpTerminalPolicy
    },
    environment: NodeJS.ProcessEnv = process.env,
  ) {
    this.root = fs.realpathSync(workDir)
    this.environment = { ...environment }
  }

  get capabilities() {
    return {
      fs: {
        readTextFile: Boolean(this.enabled.readTextFile),
        writeTextFile: Boolean(this.enabled.writeTextFile),
      },
      terminal: Boolean(this.enabled.terminal),
    }
  }

  async readTextFile(params: acp.ReadTextFileRequest): Promise<acp.ReadTextFileResponse> {
    if (!this.enabled.readTextFile) throw new Error('ACP file reads are disabled')
    const content = await fs.promises.readFile(await this.resolve(params.path, false), 'utf8')
    const lines = content.split('\n')
    const start = Math.max(0, (params.line ?? 1) - 1)
    const limit = Math.min(Math.max(0, params.limit ?? lines.length), 100_000)
    return { content: lines.slice(start, start + limit).join('\n') }
  }

  async writeTextFile(params: acp.WriteTextFileRequest): Promise<void> {
    if (!this.enabled.writeTextFile) throw new Error('ACP file writes are disabled')
    const target = await this.resolve(params.path, true)
    await fs.promises.writeFile(target, params.content, 'utf8')
  }

  async createTerminal(params: acp.CreateTerminalRequest): Promise<acp.CreateTerminalResponse> {
    if (!this.enabled.terminal) throw new Error('ACP terminals are disabled')
    const cwd = await this.resolve(params.cwd ?? this.root, false)
    const invocation = this.resolveTerminalInvocation(params.command, params.args ?? [])
    const child = spawn(invocation.command, invocation.args, {
      cwd,
      env: this.enabled.terminalPolicy === 'managed-room-only'
        ? { ...this.environment }
        : { ...this.environment, ...Object.fromEntries((params.env ?? []).map((item) => [item.name, item.value])) },
      stdio: ['pipe', 'pipe', 'pipe'],
      detached: process.platform !== 'win32',
      windowsHide: true,
    })
    const limit = Math.min(Number(params.outputByteLimit ?? 1024 * 1024), 4 * 1024 * 1024)
    const terminal: Terminal = {
      child,
      output: Buffer.alloc(0),
      limit,
      truncated: false,
      exitStatus: null,
      exited: new Promise((resolve) => child.once('exit', (code, signal) => {
        const status = { exitCode: code, signal }
        terminal.exitStatus = status
        resolve(status)
      })),
    }
    const append = (chunk: Buffer) => {
      terminal.output = Buffer.concat([terminal.output, chunk])
      if (terminal.output.byteLength > terminal.limit) {
        let start = terminal.output.byteLength - terminal.limit
        while (start < terminal.output.byteLength && (terminal.output[start]! & 0xc0) === 0x80) start += 1
        terminal.output = terminal.output.subarray(start)
        terminal.truncated = true
      }
    }
    child.stdout.on('data', append)
    child.stderr.on('data', append)
    const terminalId = randomUUID()
    this.terminals.set(terminalId, terminal)
    return { terminalId }
  }

  terminalOutput(params: acp.TerminalOutputRequest): acp.TerminalOutputResponse {
    const terminal = this.requireTerminal(params.terminalId)
    return {
      output: terminal.output.toString('utf8'),
      truncated: terminal.truncated,
      exitStatus: terminal.exitStatus,
    }
  }

  async waitForTerminalExit(params: acp.WaitForTerminalExitRequest): Promise<acp.WaitForTerminalExitResponse> {
    return this.requireTerminal(params.terminalId).exited
  }

  killTerminal(params: acp.KillTerminalRequest): void {
    terminateProcessTree(this.requireTerminal(params.terminalId).child)
  }

  releaseTerminal(params: acp.ReleaseTerminalRequest): void {
    const terminal = this.requireTerminal(params.terminalId)
    if (!terminal.exitStatus) terminateProcessTree(terminal.child)
    this.terminals.delete(params.terminalId)
  }

  close(): void {
    for (const terminal of this.terminals.values()) {
      if (!terminal.exitStatus) terminateProcessTree(terminal.child)
    }
    this.terminals.clear()
  }

  private requireTerminal(id: string): Terminal {
    const terminal = this.terminals.get(id)
    if (!terminal) throw new Error('Unknown ACP terminal')
    return terminal
  }

  private resolveTerminalInvocation(command: string, args: string[]): { command: string; args: string[] } {
    if (this.enabled.terminalPolicy !== 'managed-room-only') return { command, args }
    const operation = args[1]
    const attachmentOperationValid = operation !== 'attachment' || args[2] === 'get'
    if (
      path.basename(command).replace(/\.(?:cmd|exe)$/i, '') !== 'shennian' ||
      args[0] !== 'room' ||
      !['status', 'read', 'send', 'attachment', 'pause', 'schedule'].includes(operation ?? '') ||
      !attachmentOperationValid
    ) {
      throw new Error('ACP managed terminal only permits Shennian Room commands')
    }
    const trusted = resolveBuiltinCommand('pi')
    if (!trusted) throw new Error('Shennian CLI is unavailable for ACP managed Room tools')
    return { command: trusted.command, args: [...trusted.args, ...args] }
  }

  private async resolve(requested: string, writing: boolean): Promise<string> {
    if (!path.isAbsolute(requested)) throw new Error('ACP path must be absolute')
    const target = path.resolve(requested)
    const parent = writing ? path.dirname(target) : target
    const realParent = await fs.promises.realpath(parent)
    const resolved = writing ? path.join(realParent, path.basename(target)) : realParent
    const relative = path.relative(this.root, resolved)
    if (relative.startsWith('..') || path.isAbsolute(relative)) throw new Error('ACP path is outside the session workspace')
    return resolved
  }
}
