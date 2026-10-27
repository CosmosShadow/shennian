// @arch open-source/docs/cli-runtime.md
// @test src/__tests__/session-manager-core.test.ts

import fs from 'node:fs'
import path from 'node:path'
import type { SessionListProjection } from '@shennian/wire'
import { resolveShennianPath } from '../config/index.js'

const PROJECTION_FILE = resolveShennianPath('session-list-projection.json')

type ProjectionFile = {
  updatedAt: string
  sessions: Record<string, SessionListProjection>
}

function emptyProjection(): ProjectionFile {
  return { updatedAt: new Date(0).toISOString(), sessions: {} }
}

function readProjectionFile(): ProjectionFile {
  try {
    const parsed = JSON.parse(fs.readFileSync(PROJECTION_FILE, 'utf-8')) as ProjectionFile
    return {
      updatedAt: parsed.updatedAt ?? new Date(0).toISOString(),
      sessions: parsed.sessions ?? {},
    }
  } catch {
    return emptyProjection()
  }
}

function writeProjectionFile(file: ProjectionFile): void {
  fs.mkdirSync(path.dirname(PROJECTION_FILE), { recursive: true })
  fs.writeFileSync(PROJECTION_FILE, JSON.stringify(file, null, 2))
}

export function listProjectedSessions(): SessionListProjection[] {
  return Object.values(readProjectionFile().sessions)
}

export function mergeProjectedSessions(sessions: SessionListProjection[] | undefined): void {
  if (!sessions?.length) return
  try {
    const file = readProjectionFile()
    for (const session of sessions) {
      if (!session?.id) continue
      if (session.deletedAt) {
        delete file.sessions[session.id]
        continue
      }
      const existing = file.sessions[session.id]
      const existingMs = Date.parse(existing?.updatedAt ?? existing?.lastActivityAt ?? '')
      const incomingMs = Date.parse(session.updatedAt ?? session.lastActivityAt ?? '')
      if (!existing || !Number.isFinite(existingMs) || !Number.isFinite(incomingMs) || incomingMs >= existingMs) {
        file.sessions[session.id] = session
      }
    }
    file.updatedAt = new Date().toISOString()
    writeProjectionFile(file)
  } catch {
    // Projection is a local cache. Losing it should not break chat delivery.
  }
}
