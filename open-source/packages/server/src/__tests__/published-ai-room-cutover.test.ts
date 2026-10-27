// @covers open-source/packages/server/src/services/published-ai-room-cutover.ts

import { beforeEach, describe, expect, it, vi } from 'vitest'

const db = vi.hoisted(() => ({ $transaction: vi.fn() }))
vi.mock('../lib/prisma.js', () => ({ prisma: db }))
import { setPublishedAiWriteMode } from '../services/published-ai-room-cutover.js'

describe('published AI write fence', () => {
  const tx = {
    $queryRaw: vi.fn(),
    agentDirectMessage: { count: vi.fn() },
    agentDirectConversation: { updateMany: vi.fn() },
    conversationWriteControl: { update: vi.fn() },
  }
  beforeEach(() => {
    vi.clearAllMocks()
    db.$transaction.mockImplementation((fn) => fn(tx))
    tx.$queryRaw.mockResolvedValue([{ mode: 'legacy', everCanonical: false }])
    tx.agentDirectMessage.count.mockResolvedValue(0)
  })

  it('pauses legacy sends using one DB control row', async () => {
    await expect(setPublishedAiWriteMode('paused')).resolves.toEqual({
      mode: 'paused', idempotent: false,
    })
    expect(tx.conversationWriteControl.update).toHaveBeenCalledWith({
      where: { name: 'published_ai' },
      data: { mode: 'paused', everCanonical: false },
    })
  })

  it('rejects direct legacy to canonical transition', async () => {
    await expect(setPublishedAiWriteMode('canonical'))
      .rejects.toMatchObject({ code: 'invalid_transition' })
    expect(tx.conversationWriteControl.update).not.toHaveBeenCalled()
  })

  it('requires copy, ID parity and drained leases before first canonical cutover', async () => {
    tx.$queryRaw.mockResolvedValueOnce([{ mode: 'paused', everCanonical: false }])
      .mockResolvedValueOnce([{ count: 1n }])
      .mockResolvedValueOnce([{ count: 0n }])
      .mockResolvedValueOnce([{ count: 0n }])
    await expect(setPublishedAiWriteMode('canonical'))
      .rejects.toMatchObject({ code: 'migration_incomplete' })
    expect(tx.conversationWriteControl.update).not.toHaveBeenCalled()
    tx.$queryRaw.mockReset().mockResolvedValueOnce([{ mode: 'paused', everCanonical: false }])
      .mockResolvedValue([{ count: 0n }])
    await expect(setPublishedAiWriteMode('canonical')).resolves.toEqual({
      mode: 'canonical', idempotent: false,
    })
    expect(tx.conversationWriteControl.update).toHaveBeenCalledWith({
      where: { name: 'published_ai' },
      data: { mode: 'canonical', everCanonical: true },
    })
  })

  it('never returns to legacy authority after canonical writes have begun', async () => {
    tx.$queryRaw.mockResolvedValue([{ mode: 'paused', everCanonical: 1 }])
    await expect(setPublishedAiWriteMode('legacy'))
      .rejects.toMatchObject({ code: 'invalid_transition' })
  })

  it('makes a preactivation legacy resume eligible for another copy pass', async () => {
    tx.$queryRaw.mockResolvedValue([{ mode: 'paused', everCanonical: false }])
    await expect(setPublishedAiWriteMode('legacy')).resolves.toEqual({
      mode: 'legacy', idempotent: false,
    })
    expect(tx.agentDirectConversation.updateMany).toHaveBeenCalledWith({
      where: { canonicalState: 'ready' }, data: { canonicalState: 'backfilling' },
    })
  })
})
