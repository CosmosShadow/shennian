// @covers open-source/packages/server/src/services/login-intent-qr.ts
import { beforeEach, describe, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({ get: vi.fn(), set: vi.fn(), findUnique: vi.fn(), publicIntent: vi.fn(), approve: vi.fn() }))
vi.mock('../lib/redis.js', () => ({ redis: { get: mocks.get, set: mocks.set } }))
vi.mock('../lib/prisma.js', () => ({ prisma: { loginIntent: { findUnique: mocks.findUnique } } }))
vi.mock('../services/login-intents.js', () => ({
  getPublicLoginIntent: mocks.publicIntent, approveLoginIntent: mocks.approve,
  LoginIntentError: class extends Error { constructor(public code: string, public statusCode: number, message: string) { super(message) } },
}))
import { createLoginIntentQr, approveLoginIntentQr, getLoginIntentQrStatus } from '../services/login-intent-qr.js'

describe('pairing QR compatibility', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    mocks.publicIntent.mockResolvedValue({ expired: false, expiresAt: new Date(Date.now() + 60000) })
    mocks.get.mockResolvedValue('intent-1')
    mocks.findUnique.mockResolvedValue({ status: 'waiting_user', expiresAt: new Date(Date.now() + 60000) })
  })
  it('creates an expiring random pair token, storing only its hash', async () => {
    const qr = await createLoginIntentQr('intent-1')
    expect(qr.token).toMatch(/^auth-[A-Za-z0-9_-]{43}$/)
    expect(mocks.set).toHaveBeenCalledWith(expect.stringMatching(/^pair-intent:[a-f0-9]{64}$/), 'intent-1', 'EX', expect.any(Number))
    expect(mocks.set.mock.calls[0][0]).not.toContain(qr.token)
  })
  it('uses the scanner identity and delegates the existing approval boundary', async () => {
    const token = 'auth-' + 'a'.repeat(43)
    expect(await approveLoginIntentQr(token, 'mobile-user')).toEqual({ ok: true })
    expect(mocks.approve).toHaveBeenCalledWith('intent-1', 'mobile-user')
  })
  it('rejects unknown QR codes and cross-intent polling', async () => {
    await expect(approveLoginIntentQr('bad', 'user')).rejects.toMatchObject({ statusCode: 400 })
    await expect(getLoginIntentQrStatus('another', 'auth-' + 'a'.repeat(43))).rejects.toMatchObject({ statusCode: 400 })
    mocks.get.mockResolvedValue(null)
    await expect(approveLoginIntentQr('auth-' + 'a'.repeat(43), 'user')).rejects.toMatchObject({ statusCode: 410 })
    expect(mocks.approve).not.toHaveBeenCalled()
  })
  it('returns only completion status, never mobile credentials or identity', async () => {
    mocks.findUnique.mockResolvedValue({ status: 'claimed', expiresAt: new Date(Date.now() + 60000), approvedUserId: 'private' })
    expect(await getLoginIntentQrStatus('intent-1', 'auth-' + 'a'.repeat(43))).toEqual({ status: 'approved' })
  })
  it('preserves a review-account rejection from approval', async () => {
    mocks.approve.mockRejectedValue(new Error('review_account_machine_access_forbidden'))
    await expect(approveLoginIntentQr('auth-' + 'a'.repeat(43), 'review')).rejects.toThrow('review_account_machine_access_forbidden')
  })
})
