// @arch open-source/docs/server-runtime.md
// @test src/__tests__/agent-direct-unread.test.ts
import { Prisma } from '../generated/prisma/client.js'
import { prisma } from '../lib/prisma.js'

/** The publisher's explicit view watermark, not task status or AI activity. */
export async function readOwnerDirectUnread(ownerUserId: string, conversationIds?: string[]) {
  if (conversationIds?.length === 0) return {}
  const rows = await prisma.$queryRaw<Array<{ key: string; count: bigint }>>(Prisma.sql`
    SELECT ${conversationIds ? Prisma.sql`c.id` : Prisma.sql`c.agentIdentityId`} AS \`key\`,
      COUNT(DISTINCT c.id) AS count
    FROM AgentDirectConversation c
    JOIN AgentIdentity a ON a.id = c.agentIdentityId
    WHERE c.ownerUserId = ${ownerUserId} AND a.ownerType = 'user' AND a.status = 'active'
      AND a.ownerUserId = ${ownerUserId}
      ${conversationIds ? Prisma.sql`AND c.id IN (${Prisma.join(conversationIds)})` : Prisma.empty}
      AND EXISTS (SELECT 1 FROM AgentDirectMessage m WHERE m.conversationId = c.id
        AND m.authorRole = 'visitor'
        AND (c.ownerLastViewedAt IS NULL OR m.createdAt > c.ownerLastViewedAt))
    GROUP BY ${conversationIds ? Prisma.sql`c.id` : Prisma.sql`c.agentIdentityId`}
  `)
  return Object.fromEntries(rows.map((row) => [row.key, Number(row.count)]))
}
