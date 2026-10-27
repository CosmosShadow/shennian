// @covers open-source/packages/server/src/relay/handler-authorization.ts

import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ setMachineAgents: vi.fn() }))
vi.mock('../services/machine-status.js', () => ({ setMachineAgents: mocks.setMachineAgents }))

import { handleMachineServerReq } from '../relay/handler-authorization.js'

const frame = { type: 'req' as const, id: 'report-1', method: 'machine.agents.report' as const,
  params: { agents: [{ type: 'codex' }] } }

describe('paired machine capability report', () => {
  beforeEach(() => vi.clearAllMocks())
  it('acknowledges only after the new snapshot commits', async () => {
    let commit!: () => void
    mocks.setMachineAgents.mockImplementationOnce(() => new Promise<void>((resolve) => { commit = resolve }))
    const socket = { readyState: 1, send: vi.fn(), close: vi.fn() }
    const pending = handleMachineServerReq(socket as never, 'machine-1', 'owner-1', frame)
    expect(mocks.setMachineAgents).toHaveBeenCalledWith('machine-1', frame.params.agents)
    expect(socket.send).not.toHaveBeenCalled()
    commit()
    await expect(pending).resolves.toBe(true)
    expect(JSON.parse(socket.send.mock.calls[0]![0])).toMatchObject({
      type: 'res', id: frame.id, ok: true,
    })
  })

  it('closes the paired socket if the runtime proof cannot be stored', async () => {
    mocks.setMachineAgents.mockRejectedValueOnce(new Error('storage unavailable'))
    const socket = { readyState: 1, send: vi.fn(), close: vi.fn() }
    await expect(handleMachineServerReq(socket as never, 'machine-1', 'owner-1', frame))
      .rejects.toThrow('storage unavailable')
    expect(socket.close).toHaveBeenCalledWith(1011, 'machine capability update failed')
    expect(socket.send).not.toHaveBeenCalled()
  })

  it('rejects an ownerless or malformed report before changing capabilities', async () => {
    const socket = { readyState: 1, send: vi.fn(), close: vi.fn() }
    await expect(handleMachineServerReq(socket as never, 'machine-1', undefined, frame))
      .rejects.toThrow('machine_owner_required')
    await expect(handleMachineServerReq(socket as never, 'machine-1', 'owner-1',
      { ...frame, params: {} } as never)).rejects.toThrow('machine_agents_invalid')
    expect(mocks.setMachineAgents).not.toHaveBeenCalled()
  })
})
