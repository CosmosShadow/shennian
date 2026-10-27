// @covers ../features/account-runtime/accountRuntime.web.ts
// @covers ../features/account-runtime/accountRuntime.native.ts
// @covers ../features/account-runtime/accountRuntime.types.ts
import { beforeEach, expect, it, vi } from 'vitest'
const h = vi.hoisted(() => ({ request: vi.fn(), sendWhenReady: vi.fn() }))
vi.mock('../features/desktop-control/useDesktopAccountSync', () => ({
  desktopAccountActions: { requestMachineOperation: h.request },
  getDesktopAccountRuntimeState: () => ({ status: null }), subscribeDesktopAccountRuntimeState: vi.fn(),
}))
vi.mock('../config/sync', () => ({ getRelayManager: () => ({ sendWhenReady: h.sendWhenReady }), getSyncEngine: vi.fn() }))
vi.mock('@shennian/shared', () => ({ subscribeRelayConnectivity: vi.fn(), useSessionsStore: vi.fn() }))
import { accountRuntime as desktop } from '../features/account-runtime/accountRuntime.web'
import { accountRuntime as native } from '../features/account-runtime/accountRuntime.native'
import { ACCOUNT_MACHINE_OPERATION_BY_METHOD, DESKTOP_ACCOUNT_MACHINE_REQUEST_METHODS } from '../features/account-runtime/accountRuntime.types'
beforeEach(() => vi.clearAllMocks())
it('removes the Desktop managed bind mapping and rejects bypass callers before bridge dispatch', async () => {
  expect(ACCOUNT_MACHINE_OPERATION_BY_METHOD).not.toHaveProperty('room.agent.bind-managed')
  expect(DESKTOP_ACCOUNT_MACHINE_REQUEST_METHODS).not.toContain('room.agent.bind-managed')
  await expect(desktop.requestMachine('machine', 'room.agent.bind-managed' as never, {})).rejects.toThrow('not allowed')
  expect(h.request).not.toHaveBeenCalled()
})
it('retains Native managed binding with the exact selected Session and assignment intent', async () => {
  h.sendWhenReady.mockResolvedValueOnce({ ok: true })
  const params = { roomId: 'room', agentIdentityId: 'agent', nianSessionId: 'session', assignmentIntentId: 'intent', agentType: 'codex', activationMode: 'paused' }
  await expect(native.requestMachine('machine', 'room.agent.bind-managed', params)).resolves.toEqual({ ok: true })
  expect(h.sendWhenReady).toHaveBeenCalledExactlyOnceWith('machine', { type: 'req', method: 'room.agent.bind-managed', params }, undefined, undefined)
  expect(h.request).not.toHaveBeenCalled()
})
