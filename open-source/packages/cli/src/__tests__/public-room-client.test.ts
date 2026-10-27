// @covers src/room/public-room-client.ts

import { afterEach, describe, expect, it, vi } from 'vitest'
import { PublicRoomClient } from '../room/public-room-client.js'

vi.mock('../config/index.js', () => ({
  loadConfig: () => ({ machineToken: 'machine-secret', serverUrl: 'https://shennian.net' }),
}))

describe('public Room HTTP client', () => {
  afterEach(() => vi.restoreAllMocks())

  it('uses paired machine auth to read saved contacts', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ contacts: [], truncated: false }), { status: 200 }))
    const client = new PublicRoomClient(fetchMock as unknown as typeof fetch)
    await client.listContacts('小龙')
    expect(fetchMock).toHaveBeenCalledWith(
      'https://shennian.net/api/room-cli/contacts?q=%E5%B0%8F%E9%BE%99',
      expect.objectContaining({ method: 'GET', headers: expect.objectContaining({ authorization: 'Bearer machine-secret' }) }),
    )
  })

  it('uses machine auth and preserves the server join navigation result', async () => {
    const fetchMock = vi.fn(async (..._args: unknown[]) => new Response(JSON.stringify({
      outcome: 'joined',
      room: {
        canonicalUrl: 'https://app.shennian.net/spaces/room_1',
        launchUrl: `https://app.shennian.net/spaces/room_1?access=${'h'.repeat(43)}`,
      },
    }), { status: 200, headers: { 'content-type': 'application/json' } }))
    const client = new PublicRoomClient(fetchMock as unknown as typeof fetch)

    const result = await client.join('room_1', 'i'.repeat(43))

    expect(result).toMatchObject({ outcome: 'joined' })
    expect(fetchMock).toHaveBeenCalledWith(
      'https://shennian.net/api/room-cli/join',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ authorization: 'Bearer machine-secret' }),
      }),
    )
    const requestInit = fetchMock.mock.calls[0]?.[1] as RequestInit
    expect(JSON.parse(String(requestInit.body))).toEqual({
      roomId: 'room_1',
      inviteToken: 'i'.repeat(43),
    })
  })

  it('includes a non-secret approval message in the join request', async () => {
    const fetchMock = vi.fn(async (..._args: unknown[]) => new Response(JSON.stringify({ outcome: 'pending_approval' }), {
      status: 202,
      headers: { 'content-type': 'application/json' },
    }))
    const client = new PublicRoomClient(fetchMock as unknown as typeof fetch)

    await client.join('room_1', 'i'.repeat(43), '我是设计师，申请加入')

    const requestInit = fetchMock.mock.calls[0]?.[1] as RequestInit
    expect(JSON.parse(String(requestInit.body))).toEqual({
      roomId: 'room_1',
      inviteToken: 'i'.repeat(43),
      message: '我是设计师，申请加入',
    })
  })

  it('uses explicit versioned endpoints for Room, invitation, and member mutations', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }))
    const client = new PublicRoomClient(fetchMock as unknown as typeof fetch)
    const version = '2026-09-22T00:00:00.000Z'
    const memberRef = `member_${'m'.repeat(43)}`

    await client.update('room_1', { version, name: '新名称' })
    await client.deleteRecord('room_1', version)
    await client.resetInvite('room_1', 3)
    await client.removeMember('room_1', memberRef, 2)

    const calls = fetchMock.mock.calls as unknown as Array<[string, RequestInit]>
    expect(calls.map(([url]) => url)).toEqual([
      'https://shennian.net/api/room-cli/room_1/update',
      'https://shennian.net/api/room-cli/room_1/delete',
      'https://shennian.net/api/room-cli/room_1/invite/reset',
      'https://shennian.net/api/room-cli/room_1/members/remove',
    ])
    expect(calls.map((call) => JSON.parse(String(call[1].body)))).toEqual([
      { version, name: '新名称' },
      { version },
      { version: 3 },
      { memberRef, version: 2 },
    ])
  })

  it('retries a send network failure once with the same idempotency key', async () => {
    const fetchMock = vi.fn()
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce(new Response(JSON.stringify({ message: { sequence: '2' }, idempotent: false }), {
        status: 201,
        headers: { 'content-type': 'application/json' },
      }))
    const client = new PublicRoomClient(fetchMock as unknown as typeof fetch)

    await client.send('room_1', { clientMessageId: 'cli:stable', text: 'hello' })

    expect(fetchMock).toHaveBeenCalledTimes(2)
    const bodies = fetchMock.mock.calls.map((call) => JSON.parse(String(call[1]?.body)))
    expect(bodies).toEqual([
      { clientMessageId: 'cli:stable', text: 'hello' },
      { clientMessageId: 'cli:stable', text: 'hello' },
    ])
  })

  it('preserves a recoverable nextAction without exposing credentials', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      error: 'authorization_required',
      message: 'Pair this machine.',
      nextAction: { type: 'run_command', command: 'shennian pair --browser' },
    }), { status: 401, headers: { 'content-type': 'application/json' } }))
    const client = new PublicRoomClient(fetchMock as unknown as typeof fetch)

    let failure: unknown
    try { await client.status('room_1') } catch (error) { failure = error }
    expect(failure).toMatchObject({
      code: 'authorization_required',
      nextAction: { type: 'run_command', command: 'shennian pair --browser' },
    })
    expect(JSON.stringify(failure)).not.toMatch(/machine-secret/i)
  })
})
