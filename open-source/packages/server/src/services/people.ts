// @arch open-source/docs/server-runtime.md

import { prisma } from '../lib/prisma.js'
import { publicUserAvatar } from './user-avatar.js'

const USER_ID = /^[A-Za-z0-9_-]{8,64}$/

export class PeopleError extends Error {
  constructor(readonly code: 'invalid' | 'not_found') { super(code) }
}

function project(user: {
  id: string; name: string; description: string;
  avatarVersion: string | null; avatarUpdatedAt: Date | null;
}) {
  return {
    userId: user.id,
    displayName: user.name,
    description: user.description,
    avatar: publicUserAvatar(user),
  }
}

/** Public identity contains only deliberately shareable profile fields. */
export async function getPerson(userId: string, viewerUserId: string) {
  if (!USER_ID.test(userId)) throw new PeopleError('not_found')
  const [user, saved] = await Promise.all([
    prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, name: true, description: true,
        avatarVersion: true, avatarUpdatedAt: true },
    }),
    userId === viewerUserId ? Promise.resolve(null) : prisma.userContact.findUnique({
      where: { ownerUserId_targetUserId: { ownerUserId: viewerUserId, targetUserId: userId } },
      select: { id: true },
    }),
  ])
  if (!user) throw new PeopleError('not_found')
  return { ...project(user), savedContactId: saved?.id ?? null }
}

export async function updateOwnIntroduction(userId: string, description: unknown) {
  if (typeof description !== 'string' || description.trim().length > 1000) {
    throw new PeopleError('invalid')
  }
  const user = await prisma.user.update({
    where: { id: userId },
    data: { description: description.trim() },
    select: { id: true, name: true, description: true,
      avatarVersion: true, avatarUpdatedAt: true },
  })
  return project(user)
}
