// @covers open-source/packages/cli/src/commands/reminder.ts
// @covers open-source/packages/cli/src/schedules/reminder-client.ts
// @covers open-source/packages/cli/src/schedules/personal-handlers.ts
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Command } from 'commander'
const ipc = vi.hoisted(() => vi.fn())
const steward = vi.hoisted(() => vi.fn(() => true))
vi.mock('../steward/session.js', () => ({ isStewardSessionId: steward }))
vi.mock('../config/index.js', () => ({
  loadConfig: () => ({ machineToken: 'unit-machine-token' }),
}))
vi.mock('../schedules/server-client.js', () => ({ executeServerSchedule: vi.fn() }))
vi.mock('../daemon-ipc/client.js', () => ({ callDaemonIpc: ipc }))
vi.mock('../daemon-ipc/paths.js', () => ({
  resolveManagedRoomIpcPaths: () => ({ endpoint: 'test' }),
}))
import { registerReminderCommand } from '../commands/reminder'
import { executeServerReminder, reminderRequestArgs, STEWARD_REMINDER_INSTRUCTIONS } from '../schedules/reminder-client'
import { personalScheduleHandlers } from '../schedules/personal-handlers'
import { issuePersonalScheduleContext } from '../schedules/personal-context'
import { DaemonIpcError } from '../daemon-ipc/protocol'
afterEach(() => {
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
  vi.useRealTimers()
  process.exitCode = 0
})
describe('personal calendar command', () => {
  it('saves the screenshot ISO interval as a start reminder while retaining the complete interval', async () => {
    const fetcher = vi.fn().mockImplementation(async () => new Response('{"key":"stable","state":"active"}'))
    vi.stubGlobal('fetch', fetcher)
    const args = { operation: 'create', id: 'stable', content: '腾讯会议', when: '2026-10-26T11:00:00+08:00 至 2026-10-26T12:00:00+08:00', timezone: 'Asia/Shanghai' }
    const input = { serverUrl: 'https://example.test', machineToken: 'test-token', sessionId: 'trusted', args }
    await executeServerReminder(input)
    // Same ID and body on retry; never create a second item or drop the end time.
    await executeServerReminder(input)
    const body = JSON.parse(fetcher.mock.calls[0]![1].body)
    expect(body).toEqual({ ...args, sessionId: 'trusted', when: '2026-10-26T11:00:00+08:00', content: '腾讯会议（2026-10-26T11:00:00+08:00 至 2026-10-26T12:00:00+08:00）' })
    expect(fetcher.mock.calls[1]![1].body).toBe(fetcher.mock.calls[0]![1].body)
    expect(args.content).toBe('腾讯会议')
  })
  it('forwards an unscheduled memo without inventing a time and teaches the Agent not to ask', async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response('{"key":"memo"}'))
    vi.stubGlobal('fetch', fetcher)
    await executeServerReminder({ serverUrl: 'https://example.test', machineToken: 'test', sessionId: 'trusted', args: { operation: 'create', id: 'memo', content: '充值阿里云', timezone: 'Asia/Shanghai' } })
    expect(JSON.parse(fetcher.mock.calls[0]![1].body)).toEqual({ sessionId: 'trusted', operation: 'create', id: 'memo', content: '充值阿里云', timezone: 'Asia/Shanghai' })
    expect(STEWARD_REMINDER_INSTRUCTIONS).toContain('不追问提醒时间')
  })
  it('preserves single and recurring times and rejects inverted intervals before HTTP', async () => {
    for (const when of ['每天09:00', '2026-10-26T11:00:00+08:00']) {
      const args = { operation: 'create', when, content: 'meeting' }
      expect(reminderRequestArgs(args)).toEqual(args)
    }
    expect(reminderRequestArgs({ operation: 'update', revision: 3, content: 'meeting', when: '2099-01-01T09:00Z/2099-01-01T10:00Z' })).toMatchObject({ revision: 3, when: '2099-01-01T09:00Z' })
    const fetcher = vi.fn(); vi.stubGlobal('fetch', fetcher)
    await expect(executeServerReminder({ serverUrl: 'https://example.test', machineToken: 'test', sessionId: 'trusted', args: { operation: 'create', content: 'meeting', when: '2099-01-01T10:00Z 至 2099-01-01T09:00Z' } })).rejects.toThrow('结束时间必须晚于')
    expect(fetcher).not.toHaveBeenCalled()
  })
  it('passes only fixed actionable failures through IPC, not private server or network details', async () => {
    const fetcher = vi.fn()
    vi.stubGlobal('fetch', fetcher)
    const input = { serverUrl: 'https://example.test', machineToken: 'test', sessionId: 'trusted', args: {} }
    for (const response of [
      new Response('{"error":"invalid_text"}', { status: 422 }),
      new Response('{"error":"private-server-secret"}', { status: 503 }),
      new Response('private-proxy-secret', { status: 502 }),
    ]) {
      fetcher.mockResolvedValueOnce(response)
      const error = await executeServerReminder(input).catch(error => error)
      expect(error).toBeInstanceOf(DaemonIpcError)
      expect(error.message).not.toContain('secret')
      expect(error.message).not.toContain('IPC method failed')
    }
    fetcher.mockRejectedValueOnce(new Error('private-network-secret'))
    await expect(executeServerReminder(input)).rejects.toThrow('尚未确认保存')
  })
  it('does not let an ordinary shell invent a personal Agent context', async () => {
    vi.stubEnv('SHENNIAN_SCHEDULE_CONTEXT', '')
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    const program = new Command()
    registerReminderCommand(program)
    await program.parseAsync(['node', 'shennian', 'reminder', '--operation', 'list'])
    expect(error).toHaveBeenCalledWith('reminder_context_required')
    expect(ipc).not.toHaveBeenCalled()
  })
  it('sends revision and grant through daemon IPC rather than exposing the machine token', async () => {
    vi.stubEnv('SHENNIAN_SCHEDULE_CONTEXT', 'opaque-grant')
    ipc.mockResolvedValue({ state: 'completed' })
    vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
    const program = new Command()
    registerReminderCommand(program)
    await program.parseAsync([
      'node',
      'shennian',
      'reminder',
      '--operation',
      'complete',
      '--id',
      'one',
      '--revision',
      '5',
    ])
    expect(ipc).toHaveBeenCalledWith(
      expect.objectContaining({
        method: 'reminder.personal',
        params: { operation: 'complete', id: 'one', revision: 5, context: 'opaque-grant' },
      }),
    )
  })
  it('overrides model-supplied session IDs and strips the local grant before HTTP', async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response('{"state":"active"}'))
    vi.stubGlobal('fetch', fetcher)
    await executeServerReminder({
      serverUrl: 'https://example.test/',
      machineToken: 'test-token',
      sessionId: 'trusted',
      args: {
        context: 'do-not-forward',
        sessionId: 'untrusted',
        operation: 'create',
        id: 'stable',
      },
    })
    expect(fetcher.mock.calls[0]![0]).toBe('https://example.test/api/personal-reminders/agent')
    expect(JSON.parse(fetcher.mock.calls[0]![1].body)).toEqual({
      sessionId: 'trusted',
      operation: 'create',
      id: 'stable',
    })
    fetcher.mockResolvedValueOnce(new Response('{"error":"revision_conflict"}', { status: 409 }))
    await expect(
      executeServerReminder({
        serverUrl: 'https://example.test',
        machineToken: 'test-token',
        sessionId: 'trusted',
        args: {},
      }),
    ).rejects.toThrow('revision_conflict')
  })
})

describe('daemon calendar context checks', () => {
  it('returns an actionable typed expiry error before HTTP without renewing an expired caller grant', async () => {
    vi.useFakeTimers()
    const context = issuePersonalScheduleContext('unit-expired-calendar')
    vi.advanceTimersByTime(31 * 60000)
    const fetcher = vi.fn(); vi.stubGlobal('fetch', fetcher)
    const registry = { getByNianSessionId: () => undefined } as unknown as Parameters<typeof personalScheduleHandlers>[1]
    const handlers = personalScheduleHandlers('https://example.test', registry)
    const result = await Promise.resolve().then(() => handlers['reminder.personal']!({ context, operation: 'create' }, { requestId: 'expired' })).catch((error: unknown) => error)
    expect(result).toBeInstanceOf(DaemonIpcError)
    expect(result).toMatchObject({ code: 'schedule_context_expired' })
    expect((result as Error).message).toContain('重新发送请求')
    await expect(handlers['reminder.personal']!({ context, operation: 'list' }, { requestId: 'same-stale-grant' })).rejects.toMatchObject({ code: 'schedule_context_expired' })
    expect(fetcher).not.toHaveBeenCalled()
  })
  it('rejects expired grants, managed rooms and sessions that are no longer the steward', async () => {
    const fetcher = vi.fn()
    vi.stubGlobal('fetch', fetcher)
    const context = issuePersonalScheduleContext('unit-steward')
    const registry = { getByNianSessionId: () => undefined } as unknown as Parameters<
      typeof personalScheduleHandlers
    >[1]
    const handlers = personalScheduleHandlers('https://example.test', registry)
    await expect(
      handlers['reminder.personal']!(
        { context: 'forged', operation: 'list' },
        { requestId: 'test' },
      ),
    ).rejects.toThrow('schedule_context_expired')
    steward.mockReturnValueOnce(false)
    await expect(
      handlers['reminder.personal']!({ context, operation: 'list' }, { requestId: 'test' }),
    ).rejects.toThrow('schedule_personal_context_required')
    const managed = { getByNianSessionId: () => ({ binding: {} }) } as unknown as Parameters<
      typeof personalScheduleHandlers
    >[1]
    await expect(
      personalScheduleHandlers('https://example.test', managed)['reminder.personal']!(
        { context, operation: 'list' },
        { requestId: 'test' },
      ),
    ).rejects.toThrow('schedule_personal_context_required')
    expect(fetcher).not.toHaveBeenCalled()
  })
})
