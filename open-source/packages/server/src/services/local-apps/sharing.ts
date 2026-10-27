// @arch open-source/docs/server-runtime.md
// @test src/__tests__/local-app-sharing.test.ts
import { randomBytes } from 'node:crypto'
import { localServicePath, type LocalApp } from '@shennian/wire'
import { redis } from '../../lib/redis.js'
import { requirePlanAccess } from '../plan-access.js'
import { listApps, ownedMachine } from './gateway.js'

export const SHARE_SECONDS = 30 * 86400
export const VISITOR_SECONDS = 900
export type Share = { userId: string; machineId: string; app: LocalApp; assets: string[]; posts: string[] }
const token = () => randomBytes(24).toString('hex')
export const shareKey = (id: string) => {
  if (!/^[a-f0-9]{48}$/.test(id)) throw new Error('local_share_unavailable')
  return `local-app-share:${id}`
}
export function paths(raw: unknown): string[] {
  if (!Array.isArray(raw) || raw.length > 50) throw new Error('invalid_share_paths')
  return [...new Set(raw.map(value => {
    const path = localServicePath(value)
    // Exact canonical paths only: no queries, encoding aliases, directories or wildcards.
    if (!/^\/[A-Za-z0-9_./-]*$/.test(path) || path.includes('//')) throw new Error('invalid_share_paths')
    return path
  }))]
}
export async function createShare(userId: string, machineId: string, appId: string, assets: unknown, posts: unknown) {
  const app = (await listApps(userId, machineId)).find(a => a.id === appId)
  if (!app) throw new Error('local_app_unavailable')
  const share: Share = { userId, machineId, app, assets: paths(assets), posts: paths(posts) }
  share.assets = paths([app.entryPath, ...share.assets])
  const id = token()
  await redis.set(shareKey(id), JSON.stringify(share), 'EX', SHARE_SECONDS)
  return id
}
export async function readShare(id: string): Promise<Share> {
  const raw = await redis.get(shareKey(id))
  if (!raw) throw new Error('local_share_unavailable')
  const share = JSON.parse(raw) as Share
  await requirePlanAccess(share.userId)
  await ownedMachine(share.userId, share.machineId)
  // Removing/re-registering or changing the application invalidates its old publication.
  const app = (await listApps(share.userId, share.machineId)).find(a => a.id === share.app.id)
  if (!app || JSON.stringify(app) !== JSON.stringify(share.app)) throw new Error('local_share_unavailable')
  return share
}
export async function rateLimit(key: string, limit: number) {
  const count = Number(await redis.eval("local n=redis.call('INCR',KEYS[1]); if n==1 then redis.call('EXPIRE',KEYS[1],60) end; return n", 1, `local-app-limit:${key}`))
  if (count > limit) throw new Error('local_share_rate_limited')
}
export async function createVisitor(id: string) {
  const visitor = token()
  await redis.set(`local-app-visitor:${visitor}`, id, 'EX', VISITOR_SECONDS)
  return visitor
}
export async function checkVisitor(id: string, value: unknown) {
  if (typeof value !== 'string' || !/^[a-f0-9]{48}$/.test(value) || await redis.get(`local-app-visitor:${value}`) !== id) throw new Error('local_visitor_expired')
}
export async function revokeShare(id: string, userId: string, machineId?: string) {
  const raw = await redis.get(shareKey(id))
  if (!raw || (JSON.parse(raw) as Share).userId !== userId || (machineId && (JSON.parse(raw) as Share).machineId !== machineId)) throw new Error('machine_owner_required')
  await redis.del(shareKey(id))
}
