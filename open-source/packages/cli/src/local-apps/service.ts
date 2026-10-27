// @arch open-source/docs/cli-runtime.md
// @test src/__tests__/local-apps.test.ts
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { LOCAL_APP_MAX_BYTES, localServicePath, personalServiceInput, type LocalApp, type PersonalServiceResponse } from '@shennian/wire'
import { getShennianDir } from '../config/index.js'

export type LocalAppDiagnosis = { check: 'local_entry_http'; appId: string; status: 'ready' | 'http_error' | 'unavailable'; httpStatus?: number; reason?: string }

export function createLocalAppService(root = path.join(getShennianDir(), 'local-apps'), transport = fetch) {
  let registrations = Promise.resolve()
  let active = 0
  const file = (id: string) => { if (!/^[a-zA-Z0-9_-]{1,80}$/.test(id)) throw new Error('invalid_app_id'); return path.join(root, id + '.json') }
  const get = async (id: string): Promise<LocalApp> => {
    try { const value = JSON.parse(await fs.readFile(file(id), 'utf8')) as LocalApp; if (value.id !== id || typeof value.title !== 'string' || value.title.length > 120 || typeof value.directory !== 'string' || value.directory.length > 1000 || typeof value.updatedAt !== 'string') throw new Error(); personalServiceInput({ appId: value.id, port: value.port, method: 'GET', path: value.entryPath }); return value }
    catch { throw new Error('local_app_unavailable') }
  }
  return {
    get,
    async list(): Promise<LocalApp[]> {
      let files: string[]
      try { files = await fs.readdir(root) } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []; throw error }
      const rows = await Promise.all(files.filter((name) => /^[\w-]+\.json$/.test(name)).slice(0, 100).map((name) => get(name.slice(0, -5)).catch(() => null)))
      return rows.filter((row): row is LocalApp => row !== null).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    },
    async register(raw: unknown) {
      const run = registrations.then(async () => {
        if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('invalid_app_registration')
        const p = raw as Record<string, unknown>
        if (Object.keys(p).some((key) => !['id', 'title', 'port', 'entryPath', 'directory'].includes(key)) || typeof p.title !== 'string' || !p.title.trim() || p.title.length > 120 || typeof p.directory !== 'string' || p.directory.length > 1000 || !/^(?:\/|[A-Za-z]:[\\/]|\\\\)/.test(p.directory) || /[\u0000-\u001f]/.test(p.directory)) throw new Error('invalid_app_registration')
        const id = typeof p.id === 'string' ? p.id : randomUUID()
        const entryPath = localServicePath(p.entryPath ?? '/')
        personalServiceInput({ appId: id, port: p.port, method: 'GET', path: entryPath })
        const app: LocalApp = { id, title: p.title.trim(), port: Number(p.port), entryPath, directory: p.directory, updatedAt: new Date().toISOString() }
        await fs.mkdir(root, { recursive: true, mode: 0o700 })
        const names = await fs.readdir(root)
        if (names.filter(name => /^[\w-]+\.json$/.test(name)).length >= 100 && !names.includes(id + '.json')) throw new Error('local_app_limit')
        const temporary = file(id) + '.' + randomUUID() + '.tmp'
        try { await fs.writeFile(temporary, JSON.stringify(app), { mode: 0o600 }); await fs.rename(temporary, file(id)) }
        finally { await fs.unlink(temporary).catch(() => {}) }
        return app
      })
      registrations = run.then(() => {}, () => {})
      return run
    },
    async doctor(id: string): Promise<LocalAppDiagnosis> {
      let app: LocalApp
      try { app = await get(id) } catch { return { check: 'local_entry_http', appId: id, status: 'unavailable', reason: 'app_not_registered' } }
      try {
        // GET only: reuse the same registered-port/redirect/size/time boundary.
        // Never execute repair commands, probe other ports or return page content.
        const response = await this.request({ appId: id, port: app.port, method: 'GET', path: app.entryPath, asset: true })
        return { check: 'local_entry_http', appId: id, status: response.status >= 200 && response.status < 300 ? 'ready' : 'http_error', httpStatus: response.status }
      } catch (error) {
        const known = ['service_timeout', 'service_busy', 'service_redirect_blocked', 'service_response_too_large', 'service_port_forbidden', 'local_app_unavailable']
        return { check: 'local_entry_http', appId: id, status: 'unavailable', reason: error instanceof Error && known.includes(error.message) ? error.message : 'service_unavailable' }
      }
    },
    async remove(id: string) { await fs.unlink(file(id)); return { removed: true } },
    async request(raw: unknown): Promise<PersonalServiceResponse> {
      const p = personalServiceInput(raw), app = await get(p.appId)
      if (app.port !== p.port) throw new Error('service_port_forbidden')
      if (active >= 8) throw new Error('service_busy')
      active++
      const abort = new AbortController(), timer = setTimeout(() => abort.abort(), 15000)
      try {
        const url = new URL(p.path, `http://127.0.0.1:${p.port}`)
        if (url.hostname !== '127.0.0.1' || url.port !== String(p.port)) throw new Error('invalid_service_path')
        if (p.method === 'GET' && p.args) for (const [key, value] of Object.entries(p.args)) url.searchParams.set(key, typeof value === 'string' ? value : JSON.stringify(value))
        const response = await transport(url, { method: p.method, redirect: 'manual', signal: abort.signal,
          headers: { 'accept-encoding': 'identity', ...(p.method !== 'GET' ? { 'content-type': 'application/json' } : {}) },
          ...(p.method !== 'GET' ? { body: JSON.stringify(p.args ?? {}) } : {}) })
        if (response.status >= 300 && response.status < 400) { await response.body?.cancel(); throw new Error('service_redirect_blocked') }
        const length = Number(response.headers.get('content-length'))
        if (Number.isFinite(length) && length > LOCAL_APP_MAX_BYTES) { await response.body?.cancel(); throw new Error('service_response_too_large') }
        const chunks: Uint8Array[] = []; let bytes = 0
        if (response.body) {
          const reader = response.body.getReader()
          try { for (;;) { const next = await reader.read(); if (next.done) break; bytes += next.value.byteLength; if (bytes > LOCAL_APP_MAX_BYTES) { await reader.cancel(); throw new Error('service_response_too_large') }; chunks.push(next.value) } }
          finally { reader.releaseLock() }
        }
        const headers: Record<string, string> = {}
        for (const name of ['content-type', 'etag', 'last-modified']) { const value = response.headers.get(name); if (value && !/[\r\n]/.test(value)) headers[name] = value }
        return { status: response.status, headers, base64: Buffer.concat(chunks).toString('base64') }
      } catch (error) {
        if (abort.signal.aborted) throw new Error('service_timeout')
        if (error instanceof Error && ['service_redirect_blocked', 'service_response_too_large'].includes(error.message)) throw error
        throw new Error('service_unavailable')
      } finally { clearTimeout(timer); active-- }
    },
  }
}
export const localApps = createLocalAppService()
