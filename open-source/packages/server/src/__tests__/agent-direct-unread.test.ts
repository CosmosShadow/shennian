// @covers open-source/packages/server/src/services/agent-direct-unread.ts
import { beforeEach, describe, expect, it, vi } from 'vitest'
const query = vi.hoisted(() => vi.fn())
vi.mock('../lib/prisma.js', () => ({ prisma: { $queryRaw: query } }))
import { readOwnerDirectUnread } from '../services/agent-direct-unread'
describe('publisher visitor unread projection', () => {
  beforeEach(() => { query.mockReset() })
  it('counts conversations per agent, fences both ownerships, and ignores AI-only activity', async () => {
    query.mockResolvedValue([{ key: 'agent-1', count: 3n }])
    expect(await readOwnerDirectUnread('owner-1')).toEqual({ 'agent-1': 3 })
    const sql = query.mock.calls[0][0]
    expect(sql.sql).toContain('c.agentIdentityId AS `key`')
    expect(sql.sql).toContain("a.ownerType = 'user'")
    expect(sql.values).toEqual(['owner-1', 'owner-1'])
    expect(sql.sql).toContain("m.authorRole = 'visitor'")
    expect(sql.sql).toContain('m.createdAt > c.ownerLastViewedAt')
    expect(sql.sql).toContain('c.ownerLastViewedAt IS NULL')
    expect(sql.sql).toContain('COUNT(DISTINCT c.id)')
    expect(sql.sql).not.toContain('m.text')
  })
  it('bounds row badges to the requested page using parameters, including hostile input', async () => {
    query.mockResolvedValue([{ key: 'chat-1', count: 1n }])
    const hostile = "chat' OR 1=1"
    expect(await readOwnerDirectUnread('owner', ['chat-1', hostile])).toEqual({ 'chat-1': 1 })
    const sql = query.mock.calls[0][0]
    expect(sql.sql).toContain('c.id AS `key`')
    expect(sql.sql).toContain('c.id IN (?,?)')
    expect(sql.values).toEqual(['owner', 'owner', 'chat-1', hostile])
    expect(sql.sql).not.toContain(hostile)
  })
  it('does not scan all conversations for an empty list page', async () => {
    expect(await readOwnerDirectUnread('owner', [])).toEqual({})
    expect(query).not.toHaveBeenCalled()
  })
})
