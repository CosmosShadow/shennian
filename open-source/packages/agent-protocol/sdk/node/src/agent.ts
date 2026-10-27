import { createInterface } from 'node:readline'
import { randomUUID } from 'node:crypto'
import type {
  AgentEvent,
  BaseFields,
  Caps,
  SendParams,
  ResumeParams,
  StdinMessage,
} from './events.js'

export type AgentOptions = {
  name: string
  model?: string
  models?: string[]
  defaultModel?: string
  mode?: 'spawn' | 'stdio'
  proactive?: boolean
  resume?: boolean
  version?: string
}

export class Agent {
  private caps: Caps
  private runId: string = ''
  private seq: number = 0
  private agentSessionId: string = ''
  private sendHandler?: (params: SendParams) => void | Promise<void>
  private resumeHandler?: (params: ResumeParams) => void | Promise<void>

  constructor(opts: AgentOptions) {
    const models = opts.models?.length
      ? opts.models
      : opts.model
        ? [opts.model]
        : []
    const defaultModel = opts.defaultModel ?? opts.model ?? models[0] ?? 'unknown'
    this.caps = {
      name: opts.name,
      model: defaultModel,
      models: models.length > 0 ? models : undefined,
      defaultModel: models.length > 0 ? defaultModel : undefined,
      mode: opts.mode ?? 'spawn',
      proactive: opts.proactive,
      resume: opts.resume,
      version: opts.version,
    }
  }

  onSend(handler: (params: SendParams) => void | Promise<void>): void {
    this.sendHandler = handler
  }

  onResume(handler: (params: ResumeParams) => void | Promise<void>): void {
    this.resumeHandler = handler
  }

  delta(text: string, thinking?: boolean): void {
    const event: AgentEvent = thinking
      ? { state: 'delta', text, thinking }
      : { state: 'delta', text }
    this.emit(event)
  }

  toolCall(name: string, args?: Record<string, unknown>): void {
    const event: AgentEvent = args
      ? { state: 'tool-call', name, args }
      : { state: 'tool-call', name }
    this.emit(event)
  }

  toolResult(name: string, result: string): void {
    this.emit({ state: 'tool-result', name, result })
  }

  final(usage?: { inputTokens: number; outputTokens: number }): void {
    const event: AgentEvent = usage
      ? { state: 'final', usage }
      : { state: 'final' }
    this.emit(event)
    this.resetRun()
  }

  error(message: string): void {
    this.emit({ state: 'error', message })
    this.resetRun()
  }

  notify(text: string, title?: string, source?: string): void {
    const event: Record<string, unknown> = { state: 'notify', text }
    if (title !== undefined) event.title = title
    if (source !== undefined) event.source = source
    this.emit(event as AgentEvent)
  }

  run(): void {
    const command = process.argv[2]

    if (command === '/caps') {
      this.writeLine(JSON.stringify(this.caps))
      process.exit(0)
    }

    if (command === '/run') {
      this.handleSpawnRun()
      return
    }

    if (command === '/start') {
      this.handleStdioMode()
      return
    }

    process.stderr.write(`Unknown command: ${command}\nUsage: <agent> /caps | /run | /start\n`)
    process.exit(1)
  }

  private emit(event: AgentEvent): void {
    if (!this.runId) this.newRun()
    const line: AgentEvent & BaseFields = {
      ...event,
      runId: this.runId,
      seq: this.seq++,
      ...(this.agentSessionId ? { agentSessionId: this.agentSessionId } : {}),
    }
    this.writeLine(JSON.stringify(line))
  }

  private writeLine(data: string): void {
    process.stdout.write(data + '\n')
  }

  private newRun(): void {
    this.runId = randomUUID()
    this.seq = 0
  }

  private resetRun(): void {
    this.runId = ''
    this.seq = 0
  }

  private handleSpawnRun(): void {
    const args = process.argv.slice(3)
    let sessionId = ''
    let resumeSessionId = ''
    let modelId = ''
    const attachments: { path: string; name: string; mime: string }[] = []

    for (let i = 0; i < args.length; i++) {
      switch (args[i]) {
        case '--session':
          sessionId = args[++i] ?? ''
          break
        case '--resume':
          resumeSessionId = args[++i] ?? ''
          break
        case '--workdir':
          process.chdir(args[++i] ?? '.')
          break
        case '--model':
          modelId = args[++i] ?? ''
          break
        case '--attachment': {
          const raw = args[++i] ?? ''
          const [path = '', name = '', mime = ''] = raw.split(':')
          attachments.push({ path, name, mime })
          break
        }
      }
    }

    const chunks: Buffer[] = []
    this.agentSessionId = resumeSessionId || randomUUID()
    process.stdin.on('data', (chunk: Buffer) => chunks.push(chunk))
    process.stdin.on('end', () => {
      const text = Buffer.concat(chunks).toString('utf-8').trim()
      if (!this.sendHandler) return
      this.newRun()
      void (async () => {
        if (resumeSessionId) {
          if (!this.resumeHandler) throw new Error('resume not supported')
          await this.resumeHandler({ sessionId, agentSessionId: resumeSessionId })
        }
        await this.sendHandler?.({ text, sessionId, attachments, modelId: modelId || undefined })
      })().catch((err: Error) => this.error(err.message))
    })
  }

  private handleStdioMode(): void {
    const rl = createInterface({ input: process.stdin })

    rl.on('line', (line) => {
      if (!line.trim()) return
      let msg: StdinMessage
      try {
        msg = JSON.parse(line) as StdinMessage
      } catch {
        return
      }

      switch (msg.method) {
        case 'send':
          if (this.sendHandler) {
            if (!this.agentSessionId) this.agentSessionId = randomUUID()
            this.newRun()
            void Promise.resolve(
              this.sendHandler(msg.params)
            ).catch((err: Error) => this.error(err.message))
          }
          break
        case 'resume':
          if (this.resumeHandler) {
            this.agentSessionId = msg.params.agentSessionId
            this.newRun()
            void Promise.resolve(
              this.resumeHandler(msg.params)
            ).catch((err: Error) => this.error(err.message))
          }
          break
        case 'stop':
          rl.close()
          process.exit(0)
          break
      }
    })

    rl.on('close', () => process.exit(0))
  }
}
