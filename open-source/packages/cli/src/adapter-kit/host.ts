// @arch open-source/docs/cli-runtime.md
// @test src/__tests__/adapter-kit-host.test.ts

import { createInterface } from 'node:readline'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import {
  ADAPTER_PROTOCOL_VERSION,
  NODE_ADAPTER_REQUIRED_METHODS,
  type AdapterError,
  type AdapterErrorCode,
  type AdapterOutput,
  type AdapterRequest,
  type AdapterWireEvent,
  type AdapterWireMessage,
  type ModelList,
  type NodeAdapterDefinition,
  type SessionResult,
} from './types.js'

type HostWriter = (message: AdapterWireMessage) => void

type ActiveTurn = {
  requestId: string
  controller: AbortController
  terminal: boolean
}

export class AdapterContractError extends Error {}

/**
 * Loads `adapter.mjs` and validates the full V1 contract: a non-empty name
 * and version, plus all five required lifecycle functions. Missing or
 * mistyped members throw `AdapterContractError` so the caller can surface
 * `adapter_contract_invalid` without partially trusting the module.
 */
export async function loadNodeAdapter(entryPath: string): Promise<NodeAdapterDefinition> {
  const absolutePath = path.resolve(entryPath)
  let loaded: Record<string, unknown>
  try {
    loaded = (await import(pathToFileURL(absolutePath).href)) as Record<string, unknown>
  } catch (error) {
    throw new AdapterContractError(
      `Failed to load adapter module: ${error instanceof Error ? error.message : String(error)}`,
    )
  }
  const candidate = loaded.default
  if (!candidate || typeof candidate !== 'object') {
    throw new AdapterContractError('adapter.mjs must have a default export object.')
  }
  const definition = candidate as Partial<NodeAdapterDefinition>
  if (!definition.name?.trim()) throw new AdapterContractError('Adapter is missing a non-empty "name".')
  if (!definition.version?.trim()) throw new AdapterContractError('Adapter is missing a non-empty "version".')
  for (const method of NODE_ADAPTER_REQUIRED_METHODS) {
    if (typeof definition[method] !== 'function') {
      throw new AdapterContractError(`Adapter is missing the required "${method}" function.`)
    }
  }
  return definition as NodeAdapterDefinition
}

/**
 * Runs the Adapter Runtime host loop over stdio. This is the "Client 内置
 * Adapter Runtime" independent child process described in the protocol: it
 * loads the user's adapter.mjs, speaks JSON Lines with the daemon, and owns
 * turn concurrency, abort handling, terminal-state enforcement and error
 * normalization. The daemon never imports adapter.mjs directly.
 */
export async function runAdapterRuntimeHost(options: {
  entryPath: string
  workDir?: string
  input?: NodeJS.ReadableStream
  write?: HostWriter
  exit?: (code: number) => void
}): Promise<void> {
  const write = options.write ?? ((message) => process.stdout.write(`${JSON.stringify(message)}\n`))
  const exit = options.exit ?? ((code) => { process.exitCode = code })
  const workDir = path.resolve(options.workDir ?? process.cwd())

  let definition: NodeAdapterDefinition | null = null
  let loadError: AdapterError | null = null
  try {
    definition = await loadNodeAdapter(options.entryPath)
  } catch (error) {
    loadError = {
      code: 'adapter_contract_invalid',
      message: error instanceof Error ? error.message : String(error),
    }
  }

  const input = options.input ?? process.stdin
  const reader = createInterface({ input })

  let sessionId = ''
  let session: unknown
  let nativeSessionId = ''
  let activeTurn: ActiveTurn | null = null
  let stopping = false

  const respond = (id: string | null, ok: boolean, result?: Record<string, unknown>, error?: AdapterError) =>
    write({ protocolVersion: ADAPTER_PROTOCOL_VERSION, type: 'response', id, ok, result, error })

  const event = (requestId: string, value: AdapterWireEvent['event']) =>
    write({ protocolVersion: ADAPTER_PROTOCOL_VERSION, type: 'event', requestId, event: value })

  const terminateTurn = (turn: ActiveTurn, value: AdapterWireEvent['event']): void => {
    if (turn.terminal) return
    turn.terminal = true
    event(turn.requestId, value)
    if (activeTurn === turn) activeTurn = null
  }

  const createOutput = (turn: ActiveTurn): AdapterOutput => ({
    delta(text, outputOptions) {
      if (turn.terminal) return
      event(turn.requestId, {
        state: 'delta',
        text: String(text),
        ...(outputOptions?.thinking ? { thinking: true } : {}),
      })
    },
    toolCall(name, args) {
      if (turn.terminal) return
      event(turn.requestId, { state: 'tool-call', name, ...(args ? { args } : {}) })
    },
    toolResult(name, result) {
      if (turn.terminal) return
      event(turn.requestId, { state: 'tool-result', name, result })
    },
    setNativeSessionId(value) {
      const normalized = value.trim()
      if (normalized) nativeSessionId = normalized
    },
    final(usage) {
      terminateTurn(turn, {
        state: 'final',
        ...(usage ? { usage } : {}),
        ...(nativeSessionId ? { nativeSessionId } : {}),
      })
    },
    error(message, code) {
      terminateTurn(turn, { state: 'error', message, ...(code ? { code } : {}) })
    },
  })

  const handle = async (request: AdapterRequest): Promise<void> => {
    if (
      request.protocolVersion !== ADAPTER_PROTOCOL_VERSION ||
      typeof request.id !== 'string' ||
      !request.id ||
      typeof request.method !== 'string'
    ) {
      respond(typeof request?.id === 'string' ? request.id : null, false, undefined, {
        code: 'invalid_request',
        message: `Each request needs protocolVersion ${ADAPTER_PROTOCOL_VERSION}, a non-empty id and a method.`,
      })
      return
    }

    if (loadError) {
      respond(request.id, false, undefined, loadError)
      return
    }
    // definition is guaranteed non-null once loadError is null.
    const adapter = definition as NodeAdapterDefinition
    const params = (request.params ?? {}) as Record<string, unknown>

    if (request.method === 'listModels') {
      const requestedWorkDir = optionalString(params.workDir) ?? workDir
      try {
        const list = normalizeModelList(await adapter.listModels({ workDir: requestedWorkDir }))
        respond(request.id, true, {
          name: adapter.name,
          version: adapter.version,
          models: list.models,
          defaultModel: list.defaultModel,
        })
      } catch (error) {
        respond(request.id, false, undefined, wrapError('models_invalid', error))
      }
      return
    }

    if (request.method === 'start') {
      if (sessionId) {
        respond(request.id, false, undefined, {
          code: 'session_already_started',
          message: 'The adapter session is already started.',
        })
        return
      }
      const requestedSessionId = requiredString(params.sessionId)
      const requestedWorkDir = requiredString(params.workDir)
      const modelId = requiredString(params.modelId)
      const systemPrompt = requiredString(params.systemPrompt)
      if (!requestedSessionId || !requestedWorkDir || !modelId || !systemPrompt) {
        respond(request.id, false, undefined, {
          code: 'invalid_request',
          message: 'start requires sessionId, workDir, modelId and systemPrompt.',
        })
        return
      }
      try {
        const result = normalizeSessionResult(
          await adapter.start({ sessionId: requestedSessionId, workDir: requestedWorkDir, modelId, systemPrompt }),
        )
        sessionId = requestedSessionId
        session = result.session
        nativeSessionId = result.nativeSessionId
        respond(request.id, true, { nativeSessionId })
      } catch (error) {
        respond(request.id, false, undefined, wrapError('start_failed', error))
      }
      return
    }

    if (request.method === 'resume') {
      if (sessionId) {
        respond(request.id, false, undefined, {
          code: 'session_already_started',
          message: 'The adapter session is already started.',
        })
        return
      }
      if (activeTurn) {
        respond(request.id, false, undefined, { code: 'turn_active', message: 'Cannot resume while a turn is active.' })
        return
      }
      const requestedSessionId = requiredString(params.sessionId)
      const requestedNativeSessionId = requiredString(params.nativeSessionId)
      const requestedWorkDir = requiredString(params.workDir)
      const modelId = requiredString(params.modelId)
      const systemPrompt = requiredString(params.systemPrompt)
      if (!requestedSessionId || !requestedNativeSessionId || !requestedWorkDir || !modelId || !systemPrompt) {
        respond(request.id, false, undefined, {
          code: 'invalid_request',
          message: 'resume requires sessionId, nativeSessionId, workDir, modelId and systemPrompt.',
        })
        return
      }
      try {
        const result = normalizeSessionResult(
          await adapter.resume({
            sessionId: requestedSessionId,
            nativeSessionId: requestedNativeSessionId,
            workDir: requestedWorkDir,
            modelId,
            systemPrompt,
          }),
        )
        sessionId = requestedSessionId
        session = result.session
        nativeSessionId = result.nativeSessionId
        respond(request.id, true, { nativeSessionId })
      } catch (error) {
        respond(request.id, false, undefined, wrapError('resume_failed', error))
      }
      return
    }

    if (request.method === 'send') {
      if (!sessionId) {
        respond(request.id, false, undefined, { code: 'session_not_started', message: 'Call start before send.' })
        return
      }
      if (activeTurn) {
        respond(request.id, false, undefined, { code: 'turn_active', message: 'Only one turn may run at a time.' })
        return
      }
      const modelId = requiredString(params.modelId)
      if (!modelId) {
        respond(request.id, false, undefined, { code: 'invalid_request', message: 'send requires modelId.' })
        return
      }
      const turn: ActiveTurn = { requestId: request.id, controller: new AbortController(), terminal: false }
      activeTurn = turn
      respond(request.id, true, { accepted: true })
      const output = createOutput(turn)
      void Promise.resolve(
        adapter.send({
          sessionId,
          session,
          text: typeof params.text === 'string' ? params.text : '',
          modelId,
          reasoningEffort: optionalString(params.reasoningEffort),
          attachments: Array.isArray(params.attachments) ? params.attachments.filter(isAttachment) : [],
          signal: turn.controller.signal,
          output,
        }),
      )
        .then(() => {
          if (!turn.terminal) output.final()
        })
        .catch((error: unknown) => {
          if (!turn.terminal) output.error(errorMessage(error), 'send_failed')
        })
      return
    }

    if (request.method === 'stop') {
      if (!sessionId) {
        respond(request.id, false, undefined, { code: 'session_not_started', message: 'Nothing to stop.' })
        return
      }
      if (stopping) {
        respond(request.id, true, { stopped: true })
        return
      }
      stopping = true
      const reason = params.reason === 'process_shutdown' ? 'process_shutdown' : 'client_stop'
      const turn = activeTurn
      if (turn) {
        turn.controller.abort()
        terminateTurn(turn, { state: 'error', message: 'Turn stopped by client.', code: 'stopped' })
      }
      try {
        await adapter.stop({ sessionId, session, reason })
        respond(request.id, true, { stopped: true })
        reader.close()
        exit(0)
      } catch (error) {
        stopping = false
        respond(request.id, false, undefined, wrapError('stop_failed', error))
      }
      return
    }

    respond(request.id, false, undefined, {
      code: 'method_not_found',
      message: `Unsupported method: ${String(request.method)}`,
    })
  }

  reader.on('line', (line) => {
    if (!line.trim()) return
    let request: AdapterRequest
    try {
      request = JSON.parse(line) as AdapterRequest
    } catch {
      respond(null, false, undefined, { code: 'invalid_json', message: 'Each stdin line must be one JSON object.' })
      return
    }
    void handle(request)
  })

  reader.on('close', () => {
    if (!stopping && sessionId && definition) {
      activeTurn?.controller.abort()
      void Promise.resolve(definition.stop({ sessionId, session, reason: 'process_shutdown' })).catch(() => {})
    }
  })
}

function normalizeModelList(value: ModelList): ModelList {
  if (!value || !Array.isArray(value.models)) throw new Error('listModels must return a "models" array.')
  const seen = new Set<string>()
  const models = value.models.filter((model) => {
    const id = (typeof model === 'string' ? model : model?.id)?.trim()
    if (!id || seen.has(id)) return false
    seen.add(id)
    return true
  })
  if (models.length === 0) throw new Error('listModels must return at least one model.')
  if (!value.defaultModel || !seen.has(value.defaultModel)) {
    throw new Error('listModels must set "defaultModel" to one of the returned model ids.')
  }
  return { models, defaultModel: value.defaultModel }
}

function normalizeSessionResult(value: SessionResult): SessionResult {
  if (!value || typeof value !== 'object') throw new Error('start/resume must return { session, nativeSessionId }.')
  const nativeSessionId = value.nativeSessionId?.trim()
  if (!nativeSessionId) throw new Error('start/resume must return a non-empty "nativeSessionId".')
  return { session: value.session, nativeSessionId }
}

function requiredString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function optionalString(value: unknown): string | undefined {
  const normalized = requiredString(value)
  return normalized || undefined
}

function isAttachment(value: unknown): value is { path: string; name?: string; mime?: string } {
  return Boolean(value && typeof value === 'object' && typeof (value as { path?: unknown }).path === 'string')
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function wrapError(code: AdapterErrorCode, error: unknown): AdapterError {
  if (error instanceof Error) {
    const declaredCode = (error as Error & { code?: unknown }).code
    if (isAdapterErrorCode(declaredCode)) return { code: declaredCode, message: error.message }
  }
  return { code, message: errorMessage(error) }
}

const KNOWN_ERROR_CODES = new Set<AdapterErrorCode>([
  'invalid_json',
  'invalid_request',
  'method_not_found',
  'adapter_contract_invalid',
  'models_invalid',
  'session_not_started',
  'session_already_started',
  'turn_active',
  'system_prompt_unsupported',
  'start_failed',
  'send_failed',
  'stop_failed',
  'resume_failed',
  'stopped',
])

function isAdapterErrorCode(value: unknown): value is AdapterErrorCode {
  return typeof value === 'string' && KNOWN_ERROR_CODES.has(value as AdapterErrorCode)
}
