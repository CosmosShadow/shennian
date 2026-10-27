// @covers open-source/packages/server/src/services/interactive-web/agent-loop.ts
import { describe, expect, it, vi } from 'vitest'
import { INTERACTIVE_AGENT_ENTRY_TOOLS, runInteractiveAgent,
  type LoopMessage, type ModelStep, type ToolRegistration } from '../services/interactive-web/agent-loop.js'

const context = { actorId: 'alice', contextRef: 'ctx', turnRef: 'turn1', viewEpoch: 1 }
const call = (name: string, args = {}, id = name): ModelStep => ({ calls: [{ id, name, args }] })
function setup(steps: ModelStep[]) {
  const execute = vi.fn(async () => ({ requestId: 'job1', status: 'accepted' }))
  const authorize = vi.fn(async () => {})
  const registration: ToolRegistration = { definition: { id: 'works.requestCreate', version: '1',
    description: 'Create HTML asynchronously', effect: 'enqueue', parameters: { type: 'object',
      properties: { instruction: { type: 'string', minLength: 1 } }, required: ['instruction'], additionalProperties: false } },
  authorize, execute }
  const seen: LoopMessage[][] = []
  const model = vi.fn(async (messages: readonly LoopMessage[]) => {
    seen.push(structuredClone([...messages]))
    return steps.shift() ?? { text: '已受理。' }
  })
  const verifyContext = vi.fn(async () => {})
  const inspect = vi.fn(async () => ({ workRef: 'w', viewerMode: 'history' as const, readableVersionCount: 10, currentVersionRef: 'v4', viewedVersionRef: 'v7', newestSavedVersionRef: 'v10', headRevision: 12, writeEpoch: 1, canViewHistory: true, canActivateSharedVersion: false, canRequestSharedChangeFromThisView: false }))
  const input = { text: '做一个类似的', context, model, verifyContext, inspect,
    find: vi.fn(async () => ['works.requestCreate']), registry: new Map([[registration.definition.id, registration]]) }
  return { input, seen, execute, authorize, registration }
}
const describeCreate = () => call('tools.describe', { toolId: 'works.requestCreate' })
const invokeCreate = (args: Record<string, unknown> = { instruction: '做一个类似的' }) => call('tools.invoke', {
  toolId: 'works.requestCreate', definitionVersion: '1', args,
})

describe('one generic bounded Agent loop', () => {
  it('supplies only four entry definitions and no document metadata or HTML', async () => {
    const { input, seen } = setup([{ text: '你好。' }])
    await runInteractiveAgent(input)
    expect(seen[0]?.map((m) => m.role)).toEqual(['system', 'user'])
    expect(JSON.stringify(seen[0])).not.toContain('<html')
    expect(INTERACTIVE_AGENT_ENTRY_TOOLS.map((t) => t.id)).toEqual(['context.inspect', 'tools.find', 'tools.describe', 'tools.invoke'])
    expect(input.inspect).not.toHaveBeenCalled()
  })
  it('distinguishes foreground page actions from worker artifact generation without preloading content', async () => {
    const foreground = setup([{ text: 'accepted' }])
    await runInteractiveAgent({ ...foreground.input, intentSource: 'page' })
    expect(foreground.seen[0]?.[0]?.content).toContain('user clicked a control inside the current HTML')
    expect(foreground.seen[0]?.[0]?.content).toContain('document.requestChange')
    const worker = setup([{ text: 'done' }])
    await runInteractiveAgent({ ...worker.input, executionMode: 'worker' })
    expect(worker.seen[0]?.[0]?.content).not.toContain('foreground action interpreter')
    expect(foreground.input.inspect).not.toHaveBeenCalled()
  })
  it('answers a version count without loading HTML or full schemas', async () => {
    const { input } = setup([call('context.inspect'), { text: '共有 10 版。' }])
    expect(await runInteractiveAgent({ ...input, text: '共有多少版' })).toMatchObject({ text: '共有 10 版。', calls: 1 })
    expect(input.inspect).toHaveBeenCalledOnce()
    expect(input.find).not.toHaveBeenCalled()
  })
  it('discovers compact definitions, describes then enqueues without polling', async () => {
    const { input, seen, execute } = setup([call('tools.find', { query: '创建' }), describeCreate(), invokeCreate()])
    expect(await runInteractiveAgent(input)).toMatchObject({ calls: 3 })
    const discovery = seen[1]?.find((m) => m.role === 'tool')?.content ?? ''
    expect(discovery).not.toContain('parameters')
    expect(execute).toHaveBeenCalledWith({ instruction: '做一个类似的' }, expect.objectContaining({ context, requestKey: 'turn1:3' }))
    expect(seen[1]?.some((m) => m.role === 'assistant' && m.calls?.[0]?.name === 'tools.find')).toBe(true)
  })
  it('corrects malformed entry calls without dispatching the untrusted direct tool', async () => {
    const { input, execute, seen } = setup([call('works.requestCreate', { instruction: 'unit' }),
      describeCreate(), invokeCreate()])
    await runInteractiveAgent(input)
    expect(execute).toHaveBeenCalledOnce()
    expect(seen[1]?.filter((message) => message.role === 'tool').at(-1)?.content).toContain('no operation ran')
    const malformed = setup([call('tools.describe', {}, 'malformed'), describeCreate(), invokeCreate()])
    await runInteractiveAgent(malformed.input)
    expect(malformed.execute).toHaveBeenCalledOnce()
  })
  it('bounds entry repair and never retries an already performed mutation', async () => {
    const { input, execute } = setup([call('unknown_a'), call('unknown_b'), call('unknown_c')])
    await expect(runInteractiveAgent(input)).rejects.toThrow('invalid_tool_call')
    expect(execute).not.toHaveBeenCalled()
  })
  it('allows bounded foreground and worker schema correction before execution, without weakening authority checks', async () => {
    for (const executionMode of ['foreground', 'worker'] as const) {
    const corrected = setup([describeCreate(), { calls: [{ id: 'bad', name: 'tools.invoke', args: {
      toolId: 'works.requestCreate', definitionVersion: '1', args: {},
    } }] }, { ...invokeCreate(), calls: [{ ...invokeCreate().calls![0]!, id: 'fixed' }] }])
    await runInteractiveAgent({ ...corrected.input, executionMode })
    expect(corrected.execute).toHaveBeenCalledOnce()
    expect(JSON.parse(corrected.seen[2]!.at(-1)!.content)).toMatchObject({ error: 'invalid_tool_arguments' })
    const denied = setup([describeCreate(), invokeCreate({ instruction: 'x', actorId: 'owner' })])
    await expect(runInteractiveAgent({ ...denied.input, executionMode })).rejects.toThrow('invalid_tool_arguments')
    expect(denied.execute).not.toHaveBeenCalled()
    }
  })
  it('does not invoke undeclared or unloaded tools', async () => {
    const { input, execute } = setup([invokeCreate()])
    await expect(runInteractiveAgent(input)).rejects.toThrow('tool_not_loaded')
    expect(execute).not.toHaveBeenCalled()
  })
  it('revalidates authorization at invocation, not just discovery', async () => {
    const { input, authorize, execute } = setup([describeCreate(), invokeCreate()])
    authorize.mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error('forbidden'))
    await expect(runInteractiveAgent(input)).rejects.toThrow('forbidden')
    expect(execute).not.toHaveBeenCalled()
  })
  it('rejects model-supplied authority and stale definition versions', async () => {
    const { input, execute } = setup([describeCreate(), invokeCreate({ instruction: 'x', actorId: 'owner' })])
    await expect(runInteractiveAgent(input)).rejects.toThrow('invalid_tool_arguments')
    expect(execute).not.toHaveBeenCalled()
    const next = setup([describeCreate(), call('tools.invoke', { toolId: 'works.requestCreate', definitionVersion: '2', args: { instruction: 'x' } })])
    await expect(runInteractiveAgent(next.input)).rejects.toThrow('definition_changed')
  })
  it('stops repetition, invalid entry arguments and duplicate call IDs', async () => {
    const repeated = setup([call('context.inspect', {}, 'a'), call('context.inspect', {}, 'b')])
    await expect(runInteractiveAgent(repeated.input)).rejects.toThrow('repeated_call')
    const forged = setup([call('context.inspect', { actorId: 'owner' })])
    await expect(runInteractiveAgent(forged.input)).rejects.toThrow('invalid_tool_call')
    const duplicate = setup([{ calls: [{ id: 'a', name: 'context.inspect', args: {} },
      { id: 'a', name: 'tools.find', args: { query: 'x' } }] }])
    await expect(runInteractiveAgent(duplicate.input)).rejects.toThrow('duplicate_call_id')
  })
  it('checks mounted context again after loading and before writing', async () => {
    const { input, execute } = setup([describeCreate(), invokeCreate()])
    input.verifyContext.mockImplementation(async () => { if (input.verifyContext.mock.calls.length >= 5) throw new Error('context_changed') })
    await expect(runInteractiveAgent(input)).rejects.toThrow('context_changed')
    expect(execute).not.toHaveBeenCalled()
  })
  it('bounds rounds, results and total context without silently truncating HTML', async () => {
    const round = setup([call('context.inspect')])
    await expect(runInteractiveAgent({ ...round.input, limits: { maxSteps: 1 } })).rejects.toThrow('step_limit')
    const large = setup([call('context.inspect')])
    large.input.inspect.mockImplementation(async () => ({ ...(await setup([]).input.inspect()), currentVersionRef: 'x'.repeat(1000) }))
    await expect(runInteractiveAgent({ ...large.input, limits: { maxResultChars: 256 } })).rejects.toThrow('result_limit')
    const many = setup([{ calls: [call('context.inspect').calls![0]!, call('tools.find', { query: 'x' }).calls![0]!] }])
    await expect(runInteractiveAgent({ ...many.input, limits: { maxCalls: 1 } })).rejects.toThrow('call_limit')
  })
  it('stops a non-cooperative model on timeout and never executes a late tool call', async () => {
    const { input, execute } = setup([])
    let finish!: (step: ModelStep) => void
    const model = vi.fn(() => new Promise<ModelStep>((resolve) => { finish = resolve }))
    await expect(runInteractiveAgent({ ...input, model, limits: { timeoutMs: 10 } })).rejects.toThrow('interrupted')
    finish(invokeCreate())
    await Promise.resolve()
    expect(execute).not.toHaveBeenCalled()
  })
  it('accepts final speech as ordinary text; aborted input dispatches nothing', async () => {
    const { input } = setup([{ text: '收到。' }])
    const controller = new AbortController()
    controller.abort()
    await expect(runInteractiveAgent({ ...input, signal: controller.signal })).rejects.toThrow('interrupted')
    expect(input.model).not.toHaveBeenCalled()
  })
})
