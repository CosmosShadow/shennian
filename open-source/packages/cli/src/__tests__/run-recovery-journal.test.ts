// @covers open-source/packages/cli/src/session/run-recovery/schema.ts
// @covers open-source/packages/cli/src/session/run-recovery/journal.ts

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ActiveRunJournal } from '../session/run-recovery/journal.js'
import { RECOVERY_CONTINUE_TEXT } from '../session/run-recovery/schema.js'

const roots: string[] = []

afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true })
})

function createJournal(installationId = 'install-a') {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'shennian-run-journal-'))
  roots.push(root)
  return new ActiveRunJournal(installationId, { directory: path.join(root, 'active') })
}

function begin(journal: ActiveRunJournal) {
  return journal.begin({
    daemonInstallationId: journal.daemonInstallationId,
    sessionId: 'session-1',
    runId: 'run-1',
    clientMessageId: 'message-1',
    agentType: 'codex',
    sessionMode: 'standard',
    workDir: '/tmp/project',
    agentSessionId: null,
    modelId: 'gpt-5',
    reasoningEffort: 'high',
    nativeSessionVisibility: 'user',
    providerRunId: null,
    source: 'personal',
    parentSessionId: null,
    roomContextRegistryKey: null,
    activationCauseMessageId: null,
    rootCauseMessageId: null,
    activationSequence: null,
    activationHopCount: null,
  })
}

describe('ActiveRunJournal', () => {
  it('writes private atomic records without message content', () => {
    const journal = createJournal()
    const record = begin(journal)
    const [file] = fs.readdirSync(journal.directory)
    const stat = fs.statSync(path.join(journal.directory, file!))
    if (process.platform !== 'win32') expect(stat.mode & 0o777).toBe(0o600)
    const raw = fs.readFileSync(path.join(journal.directory, file!), 'utf8')
    expect(raw).not.toContain('prompt')
    expect(raw).not.toContain('todo')
    expect(raw).not.toContain('token')
    expect(record.phase).toBe('dispatching')
    expect(record.deliveryMode).toBe('direct')
    expect(record.externalRunId).toBeNull()
    expect(RECOVERY_CONTINUE_TEXT).toBe('Continue.')
  })

  it('persists external-owner delivery identity for passive restart recovery', () => {
    const journal = createJournal()
    begin(journal)
    journal.update('session-1', 'run-1', {
      deliveryMode: 'external_owner_queue',
      externalRunId: 'codex-external-submit-1',
    })

    const replacement = new ActiveRunJournal('install-a', { directory: journal.directory })
    expect(replacement.get('session-1', 'run-1')).toMatchObject({
      deliveryMode: 'external_owner_queue',
      externalRunId: 'codex-external-submit-1',
    })
  })

  it('advances identity and marks all active records for planned upgrade', () => {
    const journal = createJournal()
    begin(journal)
    journal.update('session-1', 'run-1', {
      phase: 'running',
      agentSessionId: 'thread-1',
      providerRunId: 'turn-1',
      lastObservedEventSeq: 4,
    })
    expect(journal.markPlannedUpgrade('upgrade-1')).toBe(1)
    expect(journal.get('session-1', 'run-1')).toMatchObject({
      phase: 'running',
      agentSessionId: 'thread-1',
      providerRunId: 'turn-1',
      lastObservedEventSeq: 4,
      upgradeJobId: 'upgrade-1',
      interruptionReason: 'planned_upgrade',
    })
  })

  it('quarantines corrupt, foreign, and misnamed records', () => {
    const journal = createJournal()
    fs.writeFileSync(path.join(journal.directory, 'broken.json'), '{')
    const foreign = begin(journal)
    const file = fs.readdirSync(journal.directory).find((name) => name !== 'broken.json')!
    fs.writeFileSync(path.join(journal.directory, file), JSON.stringify({
      ...foreign,
      daemonInstallationId: 'install-b',
    }))
    const loaded = journal.loadRecoverable()
    expect(loaded.records).toEqual([])
    expect(loaded.quarantined).toHaveLength(2)
    expect(fs.readdirSync(journal.quarantineDirectory)).toHaveLength(2)
  })

  it('refuses symlink journal entries', () => {
    if (process.platform === 'win32') return
    const journal = createJournal()
    const outside = path.join(path.dirname(journal.directory), 'outside')
    fs.writeFileSync(outside, '{}')
    fs.symlinkSync(outside, path.join(journal.directory, 'unsafe.json'))
    expect(journal.loadRecoverable().records).toEqual([])
    expect(fs.readFileSync(outside, 'utf8')).toBe('{}')
  })

  it.each(['dispatching', 'running', 'waiting_approval', 'recovering'] as const)(
    'survives a daemon crash at the %s phase',
    (phase) => {
      const journal = createJournal()
      begin(journal)
      journal.update('session-1', 'run-1', { phase })
      const replacement = new ActiveRunJournal('install-a', { directory: journal.directory })
      expect(replacement.loadRecoverable().records).toHaveLength(1)
      expect(replacement.loadRecoverable().records[0]?.phase).toBe(phase)
    },
  )

  it('keeps the previous durable record when atomic replacement fails', () => {
    const journal = createJournal()
    begin(journal)
    const rename = vi.spyOn(fs, 'renameSync').mockImplementationOnce(() => {
      throw Object.assign(new Error('simulated disk failure'), { code: 'ENOSPC' })
    })
    expect(() => journal.update('session-1', 'run-1', { phase: 'running' })).toThrow()
    rename.mockRestore()
    expect(journal.get('session-1', 'run-1')?.phase).toBe('dispatching')
    expect(fs.readdirSync(journal.directory).filter((name) => name.includes('.tmp-'))).toEqual([])
  })

  it('survives a transient Windows sharing violation while replacing the record', () => {
    const journal = createJournal()
    begin(journal)
    const platform = vi.spyOn(process, 'platform', 'get').mockReturnValue('win32')
    const real = fs.renameSync.bind(fs)
    let locked = 2
    const rename = vi.spyOn(fs, 'renameSync').mockImplementation((from, to) => {
      if (locked-- > 0) throw Object.assign(new Error('EPERM: scanner holds the temp file'), { code: 'EPERM' })
      real(from, to)
    })
    try {
      journal.update('session-1', 'run-1', { phase: 'running' })
    } finally {
      rename.mockRestore()
      platform.mockRestore()
    }
    expect(journal.get('session-1', 'run-1')?.phase).toBe('running')
    expect(fs.readdirSync(journal.directory).filter((name) => name.includes('.tmp-'))).toEqual([])
  })

  it('retains abort and failed-terminal tombstones for startup reconciliation', () => {
    const journal = createJournal()
    begin(journal)
    journal.markAborted('session-1', 'run-1')
    expect(journal.loadRecoverable().records).toEqual([])
    expect(journal.loadPendingReconciliation().records[0]?.phase).toBe('aborted')
  })
})
