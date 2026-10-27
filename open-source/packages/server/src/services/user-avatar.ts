// @arch open-source/docs/server-runtime.md
// @test src/__tests__/user-avatar.test.ts

import crypto from 'node:crypto'
import sharp, { type Metadata } from 'sharp'
import { prisma } from '../lib/prisma.js'
import {
  deleteObjectIfExists,
  deleteObjects,
  getObjectBuffer,
  listObjectsByPrefix,
  putObjectBuffer,
} from '../lib/oss.js'

const MAX_AVATAR_BYTES = 5 * 1024 * 1024
const MAX_AVATAR_EDGE = 8192
const MAX_AVATAR_PIXELS = 25_000_000
const MIN_AVATAR_EDGE = 64
const AVATAR_VERSION = /^[A-Za-z0-9_-]{20,43}$/
const USER_ID = /^[A-Za-z0-9_-]{8,64}$/

export type PublicUserAvatar = {
  version: string
  smallUrl: string
  mediumUrl: string
  updatedAt: string
}

export class UserAvatarError extends Error {
  constructor(
    public readonly code: string,
    public readonly statusCode: number,
    message: string,
  ) {
    super(message)
    this.name = 'UserAvatarError'
  }
}

type AvatarUser = {
  id: string
  avatarVersion?: string | null
  avatarUpdatedAt?: Date | null
}

export type PreparedAvatarImages = {
  version: string
  original: Buffer
  small: Buffer
  medium: Buffer
}

export function publicUserAvatar(user: AvatarUser | null | undefined): PublicUserAvatar | null {
  if (!user?.avatarVersion || !user.avatarUpdatedAt) return null
  const base = `/public/profile-avatars/${encodeURIComponent(user.id)}/${user.avatarVersion}`
  return {
    version: user.avatarVersion,
    smallUrl: `${base}/96`,
    mediumUrl: `${base}/256`,
    updatedAt: user.avatarUpdatedAt.toISOString(),
  }
}

export function detectAvatarMime(buffer: Buffer): 'image/jpeg' | 'image/png' | 'image/webp' | null {
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return 'image/jpeg'
  }
  if (
    buffer.length >= 8 &&
    buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
  ) {
    return 'image/png'
  }
  if (
    buffer.length >= 12 &&
    buffer.subarray(0, 4).toString('ascii') === 'RIFF' &&
    buffer.subarray(8, 12).toString('ascii') === 'WEBP'
  ) {
    return 'image/webp'
  }
  return null
}

export async function prepareAvatarImages(input: {
  contentType: unknown
  buffer: Buffer
}): Promise<PreparedAvatarImages> {
  if (
    !Buffer.isBuffer(input.buffer) ||
    input.buffer.length === 0 ||
    input.buffer.length > MAX_AVATAR_BYTES
  ) {
    throw new UserAvatarError('avatar_size_invalid', 413, 'Avatar must be between 1 byte and 5 MB.')
  }
  const detectedMime = detectAvatarMime(input.buffer)
  const claimedMime =
    typeof input.contentType === 'string'
      ? input.contentType.split(';', 1)[0]!.trim().toLowerCase()
      : ''
  if (!detectedMime || claimedMime !== detectedMime) {
    throw new UserAvatarError(
      'avatar_type_invalid',
      415,
      'Avatar must be a valid JPEG, PNG, or WebP image.',
    )
  }

  let metadata: Metadata
  try {
    metadata = await sharp(input.buffer, {
      failOn: 'error',
      limitInputPixels: MAX_AVATAR_PIXELS,
    }).metadata()
  } catch {
    throw new UserAvatarError('avatar_decode_failed', 400, 'Avatar image could not be decoded.')
  }
  const width = metadata.width ?? 0
  const height = metadata.height ?? 0
  if (
    width < MIN_AVATAR_EDGE ||
    height < MIN_AVATAR_EDGE ||
    width > MAX_AVATAR_EDGE ||
    height > MAX_AVATAR_EDGE ||
    width * height > MAX_AVATAR_PIXELS
  ) {
    throw new UserAvatarError(
      'avatar_dimensions_invalid',
      400,
      'Avatar dimensions must be between 64 and 8192 pixels with at most 25 megapixels.',
    )
  }

  const version = crypto.randomBytes(18).toString('base64url')
  const source = sharp(input.buffer, {
    failOn: 'error',
    limitInputPixels: MAX_AVATAR_PIXELS,
  }).rotate()
  const [original, small, medium] = await Promise.all([
    source
      .clone()
      .resize({ width: 2048, height: 2048, fit: 'inside', withoutEnlargement: true })
      .webp({ quality: 88 })
      .toBuffer(),
    source
      .clone()
      .resize({ width: 96, height: 96, fit: 'cover', position: 'centre' })
      .webp({ quality: 82 })
      .toBuffer(),
    source
      .clone()
      .resize({ width: 256, height: 256, fit: 'cover', position: 'centre' })
      .webp({ quality: 86 })
      .toBuffer(),
  ])

  return { version, original, small, medium }
}

export async function updateUserAvatar(input: {
  userId: string
  contentType: unknown
  buffer: Buffer
  now?: Date
}) {
  const rendered = await prepareAvatarImages(input)
  const keys = buildAvatarObjectKeys(input.userId, rendered.version)
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
    const user = await prisma.user.update({
      where: { id: input.userId },
      data: {
        avatarVersion: rendered.version,
        avatarOriginalObjectKey: keys.original,
        avatarSmallObjectKey: keys.small,
        avatarMediumObjectKey: keys.medium,
        avatarUpdatedAt: input.now ?? new Date(),
      },
    })
    return { user, avatar: publicUserAvatar(user) }
  } catch (error) {
    await Promise.all(uploaded.map((key) => deleteObjectIfExists(key).catch(() => {})))
    throw error
  }
}

export async function removeUserAvatar(userId: string) {
  const user = await prisma.user.update({
    where: { id: userId },
    data: {
      avatarVersion: null,
      avatarOriginalObjectKey: null,
      avatarSmallObjectKey: null,
      avatarMediumObjectKey: null,
      avatarUpdatedAt: null,
    },
  })
  // Versioned objects remain available to historical Room message snapshots.
  return { user, avatar: null }
}

export async function cleanupUserAvatarObjects(userId: string): Promise<number> {
  const prefix = `profile-avatars/users/${userId}/`
  let marker: string | null = null
  let deleted = 0
  do {
    const page = await listObjectsByPrefix(prefix, marker)
    const keys = page.objects.map((object) => object.name).filter((key) => key.startsWith(prefix))
    deleted += await deleteObjects(keys)
    marker = page.isTruncated ? page.nextMarker : null
  } while (marker)
  return deleted
}

export async function readPublicUserAvatar(input: {
  userId: string
  version: string
  size: string
}) {
  if (!USER_ID.test(input.userId) || !AVATAR_VERSION.test(input.version)) {
    throw new UserAvatarError('avatar_not_found', 404, 'Avatar does not exist.')
  }
  const keys = buildAvatarObjectKeys(input.userId, input.version)
  const key = input.size === '96' ? keys.small : input.size === '256' ? keys.medium : null
  if (!key) throw new UserAvatarError('avatar_not_found', 404, 'Avatar does not exist.')
  const object = await getObjectBuffer(key)
  if (!object) throw new UserAvatarError('avatar_not_found', 404, 'Avatar does not exist.')
  return object.buffer
}

export function buildAvatarObjectKeys(userId: string, version: string) {
  const base = `profile-avatars/users/${userId}/${version}`
  return {
    original: `${base}/source.webp`,
    small: `${base}/96.webp`,
    medium: `${base}/256.webp`,
  }
}
