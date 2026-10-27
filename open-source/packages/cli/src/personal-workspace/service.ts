import type { AgentInfo } from '@shennian/wire'
import { readWorkerSettings, saveWorkerSettings } from '../steward/worker-settings.js'
import { saveAutomaticPersonalModel } from '../personal-agent/automatic-model.js'
import { personalModelSummary } from '../personal-agent/model-settings.js'
// @arch open-source/docs/cli-runtime.md
// @test src/__tests__/personal-workspace.test.ts
import fs from 'node:fs'
import { createHash, randomUUID } from 'node:crypto'
import path from 'node:path'
import { getStewardDir, assertPathsSeparate } from '../steward/workspace.js'
import { readPersonalPaths } from '../steward/settings.js'
import { getShennianDir } from '../config/index.js'

const MAX_BYTES = 512 * 1024
const SAFE_TEXT = /\.(md|txt|json|yaml|yml|csv|tsv|log)$/i
const blocked = (part: string) => !part || part.startsWith('.') || /(?:^|[-_])(credentials?|secrets?|tokens?|passwords?|private[-_]?key)(?:[._-]|$)/i.test(part) || /\.(pem|key|p12|pfx|keystore)$/i.test(part)
const fail = (code: string): never => { throw new Error(`personal_${code}`) }
function relative(value: unknown): string {
  if (value === undefined || value === '') return ''
  if (typeof value !== 'string' || value.length > 2000 || /[\\\u0000-\u001f:]/.test(value) || value.startsWith('/')) return fail('path_forbidden')
  if (value.split('/').some(blocked)) return fail('path_forbidden')
  return value
}
function rootFor(kind: unknown): string {
  const configured = kind === 'memory' ? getStewardDir() : kind === 'diary' ? readPersonalPaths().diary : undefined
  if (!configured) return fail('directory_not_configured')
  assertPathsSeparate(configured, getShennianDir())
  let parent = configured
  while (true) {
    if (fs.lstatSync(parent).isSymbolicLink()) return fail('path_forbidden')
    const next = path.dirname(parent); if (next === parent) break; parent = next
  }
  const real = fs.realpathSync(configured)
  assertPathsSeparate(real, fs.existsSync(getShennianDir()) ? fs.realpathSync(getShennianDir()) : getShennianDir())
  if (!fs.statSync(real).isDirectory()) return fail('directory_unavailable')
  return real
}
function safePath(root: string, rel: string): string {
  let current = root
  for (const part of rel ? rel.split('/') : []) {
    current = path.join(current, part)
    if (fs.lstatSync(current).isSymbolicLink()) return fail('path_forbidden')
  }
  const real = fs.realpathSync(current), check = path.relative(root, real)
  if (check.startsWith('..') || path.isAbsolute(check)) return fail('path_forbidden')
  return real
}
function read(root: string, rel: string): string {
  if (!SAFE_TEXT.test(rel)) return fail('text_only')
  const target = safePath(root, rel)
  const fd = fs.openSync(target, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0))
  try {
    const stat = fs.fstatSync(fd)
    if (!stat.isFile()) return fail('text_only')
    if (stat.size > MAX_BYTES) return fail('file_too_large')
    // Read no more than the cap even if a concurrent writer grows the file.
    const buffer = Buffer.alloc(MAX_BYTES + 1), size = fs.readSync(fd, buffer, 0, buffer.length, 0)
    if (size > MAX_BYTES) return fail('file_too_large')
    if (safePath(root, rel) !== target || fs.statSync(target).ino !== stat.ino) return fail('file_changed')
    const text = buffer.subarray(0, size).toString('utf8')
    if (text.includes('\0')) return fail('text_only')
    return text
  } finally { fs.closeSync(fd) }
}
function offsetOf(value: unknown): number {
  if (value === undefined) return 0
  if (!Number.isSafeInteger(value) || Number(value) < 0 || Number(value) > 100000) return fail('invalid_request')
  return Number(value)
}
function diaryDate(rel: string): string | null {
  const m = /^(\d{4})\/(\d{4}-\d{2}-\d{2})\.md$/.exec(rel)
  if (!m || m[1] !== m[2]!.slice(0, 4)) return null
  const date = new Date(`${m[2]}T00:00:00Z`)
  return Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== m[2] ? null : m[2]!
}
const diaryMetadataCache = new Map<string, { signature: string; title: string; summary: string; revision: string }>()
const revisionOf = (content: string) => createHash('sha256').update(content).digest('hex')
export function personalWorkspace(raw: unknown, agents: AgentInfo[] = []): unknown {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return fail('invalid_request')
  const p = raw as Record<string, unknown>
  if (p.action === 'worker_info' && Object.keys(p).length === 1) return { ...readWorkerSettings(), defaultWorkDir: getStewardDir(), agents: agents.filter(a => a.supportsExternalWorkerTarget === true).map(a => ({ type: a.type, models: a.models.map(m => ({ id: m.id, name: m.name })) })) }
  if (p.action === 'worker_set' && Object.keys(p).every(k => ['action', 'settings'].includes(k))) return saveWorkerSettings(p.settings)
  if (p.action === 'model_info' && Object.keys(p).length === 1) return personalModelSummary()
  if (p.action === 'model_set' && Object.keys(p).every(k => ['action', 'settings'].includes(k))) return saveAutomaticPersonalModel(p.settings)
  if (Object.keys(p).some(k => !['action', 'kind', 'path', 'offset', 'content', 'expectedRevision'].includes(k))) return fail('invalid_request')
  if (p.action !== 'diary_write' && ('content' in p || 'expectedRevision' in p)) return fail('invalid_request')
  if (p.action === 'info') return { workspace: getStewardDir(), diary: readPersonalPaths().diary ?? null, readOnly: true, projectTaskEvents: true, diarySync: 1, diaryEdit: 1 }
  if (!['list', 'read', 'diary', 'diary_write'].includes(String(p.action))) return fail('invalid_request')
  if (p.kind !== 'memory' && p.kind !== 'diary') return fail('invalid_request')
  const root = rootFor(p.kind), rel = relative(p.path), offset = offsetOf(p.offset)
  if (p.action === 'read') {
    if (p.kind === 'diary' && !diaryDate(rel)) return fail('path_forbidden')
    const content = read(root, rel)
    return { path: rel, content, revision: revisionOf(content) }
  }
  if (p.action === 'diary_write') {
    if (p.kind !== 'diary' || !diaryDate(rel)) return fail('path_forbidden')
    if (typeof p.content !== 'string' || p.content.includes('\0') || typeof p.expectedRevision !== 'string' || !/^[a-f0-9]{64}$/.test(p.expectedRevision)) return fail('invalid_request')
    if (Buffer.byteLength(p.content, 'utf8') > MAX_BYTES) return fail('file_too_large')
    const target = safePath(root, rel), current = read(root, rel)
    if (revisionOf(current) !== p.expectedRevision) return fail('file_changed')
    // Same-directory atomic replacement: a failed write never truncates the original.
    const temporary = path.join(path.dirname(target), `.diary-${randomUUID()}.tmp`)
    try {
      const fd = fs.openSync(temporary, 'wx', fs.statSync(target).mode & 0o777)
      try { fs.writeFileSync(fd, p.content, 'utf8'); fs.fsyncSync(fd) } finally { fs.closeSync(fd) }
      if (safePath(root, rel) !== target || revisionOf(read(root, rel)) !== p.expectedRevision) return fail('file_changed')
      fs.renameSync(temporary, target)
    } finally { if (fs.existsSync(temporary)) fs.unlinkSync(temporary) }
    const content = read(root, rel)
    if (content !== p.content) return fail('file_changed')
    return { path: rel, content, revision: revisionOf(content) }
  }
  if (p.action === 'diary') {
    if (p.kind !== 'diary' || rel) return fail('invalid_request')
    const years = fs.readdirSync(root, { withFileTypes: true }).filter(e => e.isDirectory() && /^\d{4}$/.test(e.name))
    if (years.length > 300) return fail('directory_too_large')
    const files: string[] = []
    for (const year of years) {
      const entries = fs.readdirSync(safePath(root, year.name), { withFileTypes: true })
      if (entries.length > 500) return fail('directory_too_large')
      for (const e of entries) { const item = `${year.name}/${e.name}`; if (e.isFile() && diaryDate(item)) files.push(item) }
    }
    if (files.length > 10000) return fail('directory_too_large')
    files.sort().reverse()
    const signatures = new Map(files.map(item => { const stat = fs.statSync(safePath(root, item)); return [item, JSON.stringify([stat.size, stat.mtimeMs, stat.ctimeMs, stat.ino])] }))
    const snapshot = revisionOf(JSON.stringify([root, ...signatures]))
    const entries = files.slice(offset, offset + 30).map(item => {
      const key = JSON.stringify([root, item]), signature = signatures.get(item)!
      const cached = diaryMetadataCache.get(key)
      if (cached?.signature === signature) return { path: item, date: diaryDate(item), title: cached.title, summary: cached.summary, revision: cached.revision }
      let title = '', summary = '', revision: string | undefined
      try {
        const text = read(root, item); revision = revisionOf(text); title = /^#\s+(.+)$/m.exec(text)?.[1]?.slice(0, 200) ?? ''; summary = /^>\s*概要[：:]\s*(.+)$/m.exec(text)?.[1]?.slice(0, 300) ?? ''
        // Cache metadata only, never bodies; unchanged files need no repeated full read.
        if (diaryMetadataCache.size >= 10000) diaryMetadataCache.delete(diaryMetadataCache.keys().next().value!)
        diaryMetadataCache.set(key, { signature, title, summary, revision })
      } catch { /* Entry stays visible; opening reports the precise failure. */ }
      return { path: item, date: diaryDate(item), title, summary, revision }
    })
    return { entries, snapshot, nextOffset: offset + 30 < files.length ? offset + 30 : null }
  }
  if (p.kind !== 'memory') return fail('invalid_request')
  const entries = fs.readdirSync(safePath(root, rel), { withFileTypes: true })
  if (entries.length > 10000) return fail('directory_too_large')
  const visible = entries.filter(e => !blocked(e.name) && !e.isSymbolicLink() && (e.isDirectory() || e.isFile()))
    .sort((a, b) => Number(b.isDirectory()) - Number(a.isDirectory()) || a.name.localeCompare(b.name))
  return { path: rel, entries: visible.slice(offset, offset + 100).map(e => ({ name: e.name, path: rel ? `${rel}/${e.name}` : e.name, isDir: e.isDirectory() })), nextOffset: offset + 100 < visible.length ? offset + 100 : null }
}
