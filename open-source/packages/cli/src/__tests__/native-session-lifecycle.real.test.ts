// @covers src/session/native-session-lifecycle.ts
// Real, self-provisioning provider lifecycle E2E. This file is excluded from
// test:fast and must run serially through test:e2e:native-lifecycle:*.

import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { NativeSessionLifecycleRegistry } from '../session/native-session-lifecycle.js'
import { CanonicalSessionStore } from '../session/canonical-store.js'
import {
  NativeFusionLocalRepository,
  NativeSourceDeletedError,
} from '../native-fusion/local-repository.js'
import { NativeSourceDeletionStore } from '../native-fusion/native-source-deletions.js'
import { nativeTestWorkspaceRoot } from '../native-fusion/test-workspace.js'

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const OPENCODE_PATTERN = /^ses_[A-Za-z0-9_-]{6,191}$/
const enabledProviders = new Set(
  (process.env.SHENNIAN_NATIVE_LIFECYCLE_PROVIDERS ?? 'codex')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean),
)
const runId = `native-lifecycle-${new Date().toISOString().replace(/\D/g, '').slice(0, 14)}-${crypto.randomUUID().slice(0, 8)}`
const roots: string[] = []
type FixtureReport = { provider: string; sessionId: string; workDir: string; state: string }
type LifecycleReport = {
  runId: string
  startedAt: string
  finishedAt?: string
  fixtures: FixtureReport[]
}
const report: LifecycleReport = {
  runId,
  startedAt: new Date().toISOString(),
  fixtures: [] as Array<{ provider: string; sessionId: string; workDir: string; state: string }>,
}
const reportPath = path.resolve(
  process.env.SHENNIAN_NATIVE_LIFECYCLE_REPORT ?? '.tmp/native-session-lifecycle/latest.json',
)

function run(command: string, args: string[], cwd?: string): string {
  try {
    return execFileSync(command, args, {
      cwd,
      encoding: 'utf8',
      env: { ...process.env, NO_COLOR: '1' },
      timeout: 120_000,
      maxBuffer: 16 * 1024 * 1024,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
  } catch (error) {
    const detail = error as { stdout?: string | Buffer; stderr?: string | Buffer; message?: string }
    throw new Error(
      `${command} ${args[0] ?? ''} failed: ${String(detail.stderr ?? detail.stdout ?? detail.message ?? error).trim()}`,
    )
  }
}

function makeWorkDir(provider: string): string {
  fs.mkdirSync(nativeTestWorkspaceRoot(), { recursive: true, mode: 0o700 })
  const root = fs.mkdtempSync(path.join(nativeTestWorkspaceRoot(), `${runId}-${provider}-`))
  roots.push(root)
  fs.writeFileSync(
    path.join(root, 'README.md'),
    `# ${runId}\n\nDisposable ${provider} lifecycle fixture.\n`,
  )
  return root
}

function recordFixture(provider: string, sessionId: string, workDir: string, state: string) {
  const fixture = { provider, sessionId, workDir, state }
  report.fixtures.push(fixture)
  persistReport()
  return fixture
}

function persistReport(): void {
  fs.mkdirSync(path.dirname(reportPath), { recursive: true })
  const temporary = `${reportPath}.${process.pid}.tmp`
  fs.writeFileSync(temporary, `${JSON.stringify(report, null, 2)}\n`)
  fs.renameSync(temporary, reportPath)
}

function updateState(fixture: (typeof report.fixtures)[number], state: string): void {
  fixture.state = state
  persistReport()
}

function collectJsonValues(value: unknown, keys: Set<string>, output: string[] = []): string[] {
  if (Array.isArray(value)) {
    for (const item of value) collectJsonValues(item, keys, output)
    return output
  }
  if (!value || typeof value !== 'object') return output
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    if (keys.has(key) && typeof item === 'string') output.push(item)
    collectJsonValues(item, keys, output)
  }
  return output
}

function parseJsonDocuments(output: string): unknown[] {
  const documents: unknown[] = []
  for (const line of output.split('\n')) {
    if (!line.trim()) continue
    try {
      documents.push(JSON.parse(line))
    } catch {
      // Some providers mix progress text with JSON output.
    }
  }
  if (documents.length === 0) {
    try {
      documents.push(JSON.parse(output))
    } catch {
      // The caller reports a provider-specific identity error.
    }
  }
  return documents
}

function exactSessionFile(root: string, sessionId: string): string | null {
  if (!fs.existsSync(root)) return null
  const pending = [root]
  const matches: string[] = []
  while (pending.length > 0) {
    const directory = pending.pop()!
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const target = path.join(directory, entry.name)
      if (entry.isDirectory()) pending.push(target)
      else if (entry.name.includes(sessionId)) matches.push(target)
    }
  }
  if (matches.length > 1)
    throw new Error(`Expected one exact ${sessionId} file, found ${matches.length}`)
  return matches[0] ?? null
}

function sha256(file: string): string {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')
}

function listCodexSessions(): Map<string, string> {
  const sessions = new Map<string, string>()
  for (const root of [
    path.join(os.homedir(), '.codex', 'sessions'),
    path.join(os.homedir(), '.codex', 'archived_sessions'),
  ]) {
    if (!fs.existsSync(root)) continue
    const pending = [root]
    while (pending.length > 0) {
      const directory = pending.pop()!
      for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
        const target = path.join(directory, entry.name)
        if (entry.isDirectory()) {
          pending.push(target)
          continue
        }
        const sessionId = entry.name.match(
          /[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/i,
        )?.[0]
        if (sessionId) sessions.set(sessionId, target)
      }
    }
  }
  return sessions
}

function createCodexSession(workDir: string): string {
  const marker = `SHENNIAN_FIXTURE_${runId}`
  const before = listCodexSessions()
  const output = run('codex', [
    'exec',
    '--json',
    '--skip-git-repo-check',
    '--ignore-rules',
    '-s',
    'read-only',
    '-C',
    workDir,
    `This is disposable release fixture ${marker}. Do not use tools. Reply exactly: fixture ready`,
  ])
  const outputCandidates = parseJsonDocuments(output)
    .flatMap((document) => collectJsonValues(document, new Set(['thread_id', 'threadId'])))
    .filter((value) => UUID_PATTERN.test(value))
  const after = listCodexSessions()
  const newSessions = [...after.entries()].filter(([sessionId]) => !before.has(sessionId))
  const markerCandidates = newSessions
    .filter(([, file]) => fs.readFileSync(file, 'utf8').includes(marker))
    .map(([sessionId]) => sessionId)
  const attributable = outputCandidates.filter((sessionId) => after.has(sessionId))
  const unique = [...new Set([...attributable, ...markerCandidates])]
  if (unique.length !== 1)
    throw new Error(`Codex did not return one exact fixture thread id; found ${unique.length}`)
  return unique[0]!
}

function listOpenCodeSessions(workDir: string): Array<Record<string, unknown>> {
  const output = run('opencode', ['session', 'list', '--format', 'json'], workDir).trim()
  const value = output ? JSON.parse(output) : []
  if (!Array.isArray(value)) throw new Error('OpenCode session list is not an array')
  return value.filter((item): item is Record<string, unknown> =>
    Boolean(item && typeof item === 'object'),
  )
}

function createOpenCodeSession(workDir: string): string {
  const title = `shennian-${runId}`
  const before = new Set(
    listOpenCodeSessions(workDir)
      .map((session) => session.id)
      .filter((id): id is string => typeof id === 'string'),
  )
  const output = run(
    'opencode',
    [
      'run',
      '--format',
      'json',
      '--title',
      title,
      '--dir',
      workDir,
      `This is disposable release fixture ${runId}. Do not use tools. Reply exactly: fixture ready`,
    ],
    workDir,
  )
  const outputCandidates = parseJsonDocuments(output)
    .flatMap((document) => collectJsonValues(document, new Set(['sessionID', 'sessionId'])))
    .filter((value) => OPENCODE_PATTERN.test(value))
  const listedCandidates = listOpenCodeSessions(workDir)
    .filter((session) => !before.has(String(session.id)))
    .filter((session) => session.title === title || outputCandidates.includes(String(session.id)))
    .map((session) => String(session.id))
    .filter((value) => OPENCODE_PATTERN.test(value))
  const unique = [...new Set([...outputCandidates, ...listedCandidates])]
  if (unique.length !== 1)
    throw new Error(
      `OpenCode did not create one attributable fixture session; found ${unique.length}`,
    )
  return unique[0]!
}

function listGeminiSessions(workDir: string): string {
  return run('gemini', ['--list-sessions'], workDir)
}

function createGeminiSession(workDir: string): string {
  const sessionId = crypto.randomUUID()
  run(
    'gemini',
    [
      '--session-id',
      sessionId,
      '--prompt',
      `This is disposable release fixture ${runId}. Do not use tools. Reply exactly: fixture ready`,
      '--output-format',
      'json',
      '--approval-mode',
      'plan',
    ],
    workDir,
  )
  if (!listGeminiSessions(workDir).includes(sessionId)) {
    throw new Error('Gemini did not persist the exact fixture session id')
  }
  return sessionId
}

async function cleanupCodex(sessionId: string): Promise<void> {
  run('codex', ['delete', '--force', sessionId])
  expect(exactSessionFile(path.join(os.homedir(), '.codex', 'sessions'), sessionId)).toBeNull()
  expect(
    exactSessionFile(path.join(os.homedir(), '.codex', 'archived_sessions'), sessionId),
  ).toBeNull()
}

async function cleanupNative(
  provider: 'opencode' | 'gemini',
  sessionId: string,
  workDir: string,
): Promise<void> {
  const result = await new NativeSessionLifecycleRegistry().execute(provider, sessionId, {
    workDir,
  })
  if (result.outcome !== 'deleted' && result.outcome !== 'already_absent') {
    throw new Error(`${provider} cleanup failed with ${result.outcome}`)
  }
}

beforeAll(() => {
  if (process.env.SHENNIAN_REAL_NATIVE_LIFECYCLE !== '1') {
    throw new Error(
      'Run this destructive, self-provisioning E2E only through test:e2e:native-lifecycle:*',
    )
  }
  const invalid = [...enabledProviders].filter(
    (provider) => provider !== 'codex' && provider !== 'opencode' && provider !== 'gemini',
  )
  if (enabledProviders.size === 0)
    throw new Error('At least one lifecycle provider must be selected')
  if (invalid.length > 0) throw new Error(`Unsupported lifecycle providers: ${invalid.join(', ')}`)
  persistReport()
})

afterAll(() => {
  report.finishedAt = new Date().toISOString()
  persistReport()
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true })
})

describe('native lifecycle self-provisioning E2E', () => {
  if (enabledProviders.has('codex'))
    it('creates, archives, verifies, unarchives, tombstones, and cleans one exact Codex fixture', async () => {
      const workDir = makeWorkDir('codex')
      let sessionId: string | null = null
      let fixture: (typeof report.fixtures)[number] | null = null
      try {
        sessionId = createCodexSession(workDir)
        fixture = recordFixture('codex', sessionId, workDir, 'created')
        const activeRoot = path.join(os.homedir(), '.codex', 'sessions')
        const archivedRoot = path.join(os.homedir(), '.codex', 'archived_sessions')
        const active = exactSessionFile(activeRoot, sessionId)
        expect(active).toBeTruthy()
        const beforeHash = sha256(active!)

        await expect(
          new NativeSessionLifecycleRegistry().execute('codex', sessionId),
        ).resolves.toEqual({ outcome: 'archived' })
        updateState(fixture, 'archived')
        expect(exactSessionFile(activeRoot, sessionId)).toBeNull()
        const archived = exactSessionFile(archivedRoot, sessionId)
        expect(archived).toBeTruthy()
        expect(sha256(archived!)).toBe(beforeHash)

        const converged = await new NativeSessionLifecycleRegistry().execute('codex', sessionId)
        expect(['archived', 'already_absent']).toContain(converged.outcome)

        run('codex', ['unarchive', sessionId])
        updateState(fixture, 'unarchived-for-tombstone-check')
        expect(exactSessionFile(activeRoot, sessionId)).toBeTruthy()
        const deletionStore = new NativeSourceDeletionStore({
          rootDir: path.join(workDir, 'shennian-state'),
          daemonInstallationId: runId,
        })
        deletionStore.record({
          sessionId: `fixture-${sessionId}`,
          agentType: 'codex',
          sourceSessionKey: sessionId,
          deletionRevision: 1,
        })
        const repository = new NativeFusionLocalRepository({
          rootDir: path.join(workDir, 'native-fusion'),
          daemonInstallationId: runId,
          canonicalStore: new CanonicalSessionStore(path.join(workDir, 'canonical'), runId),
          recordLocalSession: () => undefined,
          listLocalSessions: () => [],
          deletionStore,
        })
        expect(() =>
          repository.commitEvent({
            agentType: 'codex',
            sourceSessionKey: sessionId!,
            sourceEventKey: `fixture-${runId}`,
            sourceMode: 'codex_rollout_import',
            role: 'user',
            ts: Date.now(),
            payload: 'fixture',
            workDir,
            cursor: 'fixture-cursor',
            terminal: true,
          }),
        ).toThrow(NativeSourceDeletedError)
      } finally {
        if (sessionId) {
          await cleanupCodex(sessionId)
          if (fixture) updateState(fixture, 'cleaned')
        }
      }
    }, 180_000)

  if (enabledProviders.has('opencode'))
    it('creates, deletes, verifies, and cleans one exact OpenCode fixture', async () => {
      const workDir = makeWorkDir('opencode')
      let sessionId: string | null = null
      let fixture: (typeof report.fixtures)[number] | null = null
      try {
        sessionId = createOpenCodeSession(workDir)
        fixture = recordFixture('opencode', sessionId, workDir, 'created')
        expect(listOpenCodeSessions(workDir).some((session) => session.id === sessionId)).toBe(true)
        const result = await new NativeSessionLifecycleRegistry().execute('opencode', sessionId, {
          workDir,
        })
        expect(result).toEqual({ outcome: 'deleted' })
        updateState(fixture, 'deleted')
        expect(listOpenCodeSessions(workDir).some((session) => session.id === sessionId)).toBe(
          false,
        )
      } finally {
        if (sessionId) {
          await cleanupNative('opencode', sessionId, workDir)
          if (fixture) updateState(fixture, 'cleaned')
        }
      }
    }, 180_000)

  if (enabledProviders.has('gemini'))
    it('creates, deletes, verifies, and cleans one exact Gemini fixture', async () => {
      const workDir = makeWorkDir('gemini')
      let sessionId: string | null = null
      let fixture: (typeof report.fixtures)[number] | null = null
      try {
        sessionId = createGeminiSession(workDir)
        fixture = recordFixture('gemini', sessionId, workDir, 'created')
        const result = await new NativeSessionLifecycleRegistry().execute('gemini', sessionId, {
          workDir,
        })
        expect(result).toEqual({ outcome: 'deleted' })
        updateState(fixture, 'deleted')
        expect(listGeminiSessions(workDir)).not.toContain(sessionId)
      } finally {
        if (sessionId) {
          await cleanupNative('gemini', sessionId, workDir)
          if (fixture) updateState(fixture, 'cleaned')
        }
      }
    }, 180_000)
})
