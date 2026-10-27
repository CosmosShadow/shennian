// @arch open-source/docs/cli-runtime.md
// @test src/__tests__/native-fusion-parsers.test.ts

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { ParsedNativeEvent } from './types.js'
export {
  listCodexRolloutFiles,
  lookupCodexThreadName,
  parseCodexRolloutChunk,
  parseCodexRolloutChunkCooperatively,
} from './codex-parser.js'
export { inspectNativeSessionFile, normalizeNativeTimestamp } from './session-header.js'
export {
  listOpenCodeSessionFiles, parseOpenCodeSessionFile, parseOpenCodeSessionSnapshot,
  type OpenCodeSnapshot,
} from './opencode-parser.js'
import { parseClaudeEntry, type ClaudeTitleState } from './claude-entry-parser.js'
import {
  readClaudeEventCwd,
  readJsonlLines,
  readJsonlLinesCooperatively,
  readTimestamp,
  safeParse,
  isClaudeSubagentTranscript,
  shouldIgnoreClaudeProjectDir,
  shouldIgnoreClaudeTranscriptPath,
  shouldIgnoreNativeScanPath,
} from './parser-common.js'

export function listNativeTranscriptRoots(): string[] {
  return [
    path.join(os.homedir(), '.codex', 'sessions'),
    path.join(os.homedir(), '.codex', 'archived_sessions'),
    path.join(os.homedir(), '.claude', 'projects'),
    path.join(os.homedir(), '.local', 'share', 'opencode'),
  ]
}

function relativeProjectDir(cwd: string): string {
  const home = os.homedir()
  if (cwd.startsWith(home)) return cwd.slice(home.length).replace(/^\//, '') || '~'
  return cwd.replace(/\//g, '-')
}

export function listClaudeTranscriptFiles(): string[] {
  const root = path.join(os.homedir(), '.claude', 'projects')
  if (!fs.existsSync(root)) return []
  const files: string[] = []
  const walk = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) {
        if (dir === root && shouldIgnoreClaudeProjectDir(entry.name)) continue
        walk(full)
      } else if (entry.isFile() && entry.name.endsWith('.jsonl')) files.push(full)
    }
  }
  walk(root)
  return files.sort()
}

export function lookupClaudeTranscriptCwd(sourceSessionKey: string): string | null {
  if (!sourceSessionKey) return null
  const match = listClaudeTranscriptFiles().find(
    (filePath) => path.basename(filePath, '.jsonl') === sourceSessionKey,
  )
  if (!match) return null

  let found: string | null = null
  readJsonlLines(match, 0, (line) => {
    if (found || !line.trim()) return
    const parsed = safeParse(line)
    if (!parsed) return
    const cwd = readClaudeEventCwd(parsed)
    if (cwd) found = cwd
  })
  return found
}

type ClaudeTranscriptChunk = {
  nextOffset: number
  events: ParsedNativeEvent[]
}

type ClaudeTranscriptCollector = {
  onLine: (line: string, lineOffset: number) => void
  finish: (nextOffset: number) => ClaudeTranscriptChunk
}

function createClaudeTranscriptCollector(filePath: string): ClaudeTranscriptCollector | ClaudeTranscriptChunk {
  const fileSize = fs.statSync(filePath).size

  if (isClaudeSubagentTranscript(filePath) || shouldIgnoreClaudeTranscriptPath(filePath)) {
    return { nextOffset: fileSize, events: [] }
  }

  const events: ParsedNativeEvent[] = []
  const sourceSessionKey = path.basename(filePath, '.jsonl')
  const fallbackWorkDir = relativeProjectDir(path.dirname(filePath).replace(path.join(os.homedir(), '.claude', 'projects') + path.sep, ''))
  if (shouldIgnoreNativeScanPath(fallbackWorkDir)) {
    return { nextOffset: fileSize, events: [] }
  }
  const title: ClaudeTitleState = { value: '' }

  const onLine = (line: string, lineOffset: number) => {
    const parsed = safeParse(line)
    if (!parsed) return

    const ts = readTimestamp(parsed.timestamp)
    const type = typeof parsed.type === 'string' ? parsed.type : ''
    if (!ts || !type) return
    const eventCwd = readClaudeEventCwd(parsed)
    if (eventCwd && shouldIgnoreNativeScanPath(eventCwd)) return

    events.push(...parseClaudeEntry(
      parsed,
      { filePath, lineOffset, sourceSessionKey, ts, workDir: eventCwd ?? fallbackWorkDir },
      title,
    ))
  }

  return { onLine, finish: (nextOffset) => ({ nextOffset, events }) }
}

function isClaudeTranscriptChunk(
  value: ClaudeTranscriptCollector | ClaudeTranscriptChunk,
): value is ClaudeTranscriptChunk {
  return 'nextOffset' in value
}

export function parseClaudeTranscriptChunk(
  filePath: string,
  startOffset: number,
): ClaudeTranscriptChunk {
  const collector = createClaudeTranscriptCollector(filePath)
  if (isClaudeTranscriptChunk(collector)) return collector
  return collector.finish(readJsonlLines(filePath, startOffset, collector.onLine))
}

export async function parseClaudeTranscriptChunkCooperatively(
  filePath: string,
  startOffset: number,
): Promise<ClaudeTranscriptChunk> {
  const collector = createClaudeTranscriptCollector(filePath)
  if (isClaudeTranscriptChunk(collector)) return collector
  return collector.finish(
    await readJsonlLinesCooperatively(filePath, startOffset, collector.onLine),
  )
}
