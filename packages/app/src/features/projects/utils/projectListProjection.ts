// @arch docs/architecture/session-organization.md
// @test packages/app/src/__tests__/project-list-performance.test.ts
import { buildProjectKey, filterProjectSessions, groupSessionsIntoProjects, type SessionProject } from '@shennian/shared'
import type { NianProject, NianSession } from '@shennian/wire'

type Bucket = { sessions: NianSession[]; records: NianProject[]; project?: SessionProject }
const sameItems = <T,>(left: T[], right: T[]) =>
  left.length === right.length && left.every((item, index) => item === right[index])

/** Name decoration must not clone every unchanged session on each live event. */
export function createSessionMachineNameProjection() {
  const cache = new WeakMap<NianSession, NianSession>()
  return (session: NianSession, machineName?: string): NianSession => {
    if (!machineName || machineName === session.machineName) return session
    const previous = cache.get(session)
    if (previous?.machineName === machineName) return previous
    const next = { ...session, machineName }
    cache.set(session, next)
    return next
  }
}

/** A live update only re-aggregates its project, not every cached conversation. */
export function createProjectListProjection() {
  let previous = new Map<string, Bucket>()
  return (sessions: NianSession[], records: NianProject[]): SessionProject[] => {
    const buckets = new Map<string, Bucket>()
    const bucketFor = (machineId: string, workDir: string) => {
      const key = buildProjectKey(machineId, workDir)
      let bucket = buckets.get(key)
      if (!bucket) { bucket = { sessions: [], records: [] }; buckets.set(key, bucket) }
      return bucket
    }
    // Preserve authoritative record order and normalize Windows aliases exactly
    // as groupSessionsIntoProjects does. Filter globally BEFORE partitioning so
    // manager substrate aliases in a different directory remain hidden.
    for (const record of records) bucketFor(record.machineId, record.workDir).records.push(record)
    for (const session of filterProjectSessions(sessions)) {
      if (!session.deletedAt) bucketFor(session.machineId, session.workDir).sessions.push(session)
    }
    const result: SessionProject[] = []
    for (const [key, bucket] of buckets) {
      const old = previous.get(key)
      bucket.project = old && sameItems(old.sessions, bucket.sessions) && sameItems(old.records, bucket.records)
        ? old.project
        : groupSessionsIntoProjects(bucket.sessions, bucket.records)[0]
      if (bucket.project) result.push(bucket.project)
    }
    previous = buckets // Never retain removed projects or another account's rows.
    return result
  }
}
