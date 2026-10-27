// @arch open-source/docs/server-runtime.md
// @test src/__tests__/agent-avatar.test.ts

import { prisma } from '../lib/prisma.js'
import {
  deleteObjectIfExists,
  deleteObjects,
  getObjectBuffer,
  listObjectsByPrefix,
  putObjectBuffer,
} from '../lib/oss.js'
import {
  prepareAvatarImages,
  UserAvatarError,
  type PublicUserAvatar,
} from './user-avatar.js'

const AVATAR_VERSION = /^[A-Za-z0-9_-]{20,43}$/
const AGENT_ID = /^[A-Za-z0-9_-]{8,191}$/

type AvatarAgent = {
  id: string
  avatarVersion?: string | null
  avatarUpdatedAt?: Date | null
}

export type PublicAgentAvatar = PublicUserAvatar

export function publicAgentAvatar(agent: AvatarAgent | null | undefined): PublicAgentAvatar | null {
  if (!agent?.avatarVersion || !agent.avatarUpdatedAt) return null
  const base = `/public/agent-avatars/${encodeURIComponent(agent.id)}/${agent.avatarVersion}`
  return {
    version: agent.avatarVersion,
    smallUrl: `${base}/96`,
    mediumUrl: `${base}/256`,
    updatedAt: agent.avatarUpdatedAt.toISOString(),
  }
}

async function requireOwnedAgent(userId: string, agentId: string) {
  const agent = await prisma.agentIdentity.findFirst({
    where: { id: agentId, ownerType: 'user', ownerUserId: userId, status: { not: 'deleted' } },
  })
  if (!agent) throw new UserAvatarError('avatar_agent_not_found', 404, 'Agent does not exist.')
  return agent
}

export async function updateAgentAvatar(input: {
  userId: string
  agentId: string
  contentType: unknown
  buffer: Buffer
  now?: Date
}) {
  await requireOwnedAgent(input.userId, input.agentId)
  const rendered = await prepareAvatarImages(input)
  const keys = buildAgentAvatarObjectKeys(input.agentId, rendered.version)
  const uploaded: string[] = []
  try {
    for (const [key, content] of [
      [keys.original, rendered.original],
      [keys.small, rendered.small],
      [keys.medium, rendered.medium],
    ] as const) {
      await putObjectBuffer(key, content, 'image/webp')
      uploaded.push(key)
    }
    const agent = await prisma.agentIdentity.update({
      where: { id: input.agentId },
      data: {
        avatarVersion: rendered.version,
        avatarOriginalObjectKey: keys.original,
        avatarSmallObjectKey: keys.small,
        avatarMediumObjectKey: keys.medium,
        avatarUpdatedAt: input.now ?? new Date(),
      },
    })
    return { agent, avatar: publicAgentAvatar(agent) }
  } catch (error) {
    await Promise.all(uploaded.map((key) => deleteObjectIfExists(key).catch(() => {})))
    throw error
  }
}

export async function removeAgentAvatar(userId: string, agentId: string) {
  await requireOwnedAgent(userId, agentId)
  const agent = await prisma.agentIdentity.update({
    where: { id: agentId },
    data: {
      avatarVersion: null,
      avatarOriginalObjectKey: null,
      avatarSmallObjectKey: null,
      avatarMediumObjectKey: null,
      avatarUpdatedAt: null,
    },
  })
  // Versioned objects remain available to historical Room message snapshots.
  return { agent, avatar: null }
}

export async function readPublicAgentAvatar(input: {
  agentId: string
  version: string
  size: string
}) {
  if (!AGENT_ID.test(input.agentId) || !AVATAR_VERSION.test(input.version)) {
    throw new UserAvatarError('avatar_not_found', 404, 'Avatar does not exist.')
  }
  const keys = buildAgentAvatarObjectKeys(input.agentId, input.version)
  const key = input.size === '96' ? keys.small : input.size === '256' ? keys.medium : null
  if (!key) throw new UserAvatarError('avatar_not_found', 404, 'Avatar does not exist.')
  const object = await getObjectBuffer(key)
  if (!object) throw new UserAvatarError('avatar_not_found', 404, 'Avatar does not exist.')
  return object.buffer
}

export async function cleanupAgentAvatarObjects(agentIds: string[]): Promise<number> {
  let deleted = 0
  for (const agentId of agentIds) {
    const prefix = `profile-avatars/agents/${agentId}/`
    let marker: string | null = null
    do {
      const page = await listObjectsByPrefix(prefix, marker)
      const keys = page.objects.map((object) => object.name).filter((key) => key.startsWith(prefix))
      deleted += await deleteObjects(keys)
      marker = page.isTruncated ? page.nextMarker : null
    } while (marker)
  }
  return deleted
}

export function buildAgentAvatarObjectKeys(agentId: string, version: string) {
  const base = `profile-avatars/agents/${agentId}/${version}`
  return {
    original: `${base}/source.webp`,
    small: `${base}/96.webp`,
    medium: `${base}/256.webp`,
  }
}
