// @arch open-source/docs/server-runtime.md
// @test src/__tests__/interactive-web-context.test.ts
import { randomBytes } from 'node:crypto'
import { redis } from '../../lib/redis.js'
import { ContentError, readableVersion } from './repository.js'
export type ContentContext = { actorId: string; mountId: string; viewEpoch: number;
  workId: string | null; versionId: string | null; followCurrent: boolean }
export async function issueContentContext(input: ContentContext) {
  if (!process.env.REDIS_URL) throw new ContentError('context_store_unavailable', 503)
  if (input.workId) await readableVersion(input.actorId, input.workId, input.versionId ?? undefined)
  const ref = randomBytes(32).toString('base64url')
  // One atomic script: an out-of-order request must not invalidate a newer mounted page.
  const accepted = await redis.eval(`
local v=redis.call('get',KEYS[1])
if v then local p=cjson.decode(v); if tonumber(p.epoch)>tonumber(ARGV[1]) then return 'STALE' end; if tonumber(p.epoch)==tonumber(ARGV[1]) then return p.ref end end
redis.call('set',KEYS[1],cjson.encode({epoch=tonumber(ARGV[1]),ref=ARGV[2]}),'EX',600)
redis.call('set',KEYS[2],ARGV[3],'EX',600)
return ARGV[2]`, 2, `content:mount:${input.actorId}:${input.mountId}`, `content:context:${ref}`,
  String(input.viewEpoch), ref, JSON.stringify(input))
  if (accepted === 'STALE') throw new ContentError('context_changed', 409)
  return String(accepted)
}
export async function resolveContentContext(actorId: string, ref: string) {
  const raw = await redis.get(`content:context:${ref}`)
  if (!raw) throw new ContentError('context_expired', 409)
  const context = JSON.parse(raw) as ContentContext
  if (context.actorId !== actorId) throw new ContentError('context_forbidden', 403)
  const current = await redis.get(`content:mount:${actorId}:${context.mountId}`)
  if (!current || (JSON.parse(current) as { ref: string }).ref !== ref) throw new ContentError('context_changed', 409)
  if (context.workId) await readableVersion(actorId, context.workId, context.versionId ?? undefined)
  return context
}
