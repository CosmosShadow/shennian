// @arch open-source/docs/application-examples.md
// @test ./server.test.mjs
import http from 'node:http'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { URL, fileURLToPath, pathToFileURL } from 'node:url'
import { randomUUID } from 'node:crypto'
import { Buffer } from 'node:buffer'
import process from 'node:process'
import console from 'node:console'
const pageFile = fileURLToPath(new URL('./index.html', import.meta.url))
const allowedCategories = new Set(['idea', 'bug', 'other'])
export function validateFeedback(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw Error('invalid_feedback')
  if (Object.keys(value).some(key => !['message', 'category'].includes(key))) throw Error('invalid_feedback')
  if (!allowedCategories.has(value.category) || typeof value.message !== 'string') throw Error('invalid_feedback')
  const message = value.message.trim()
  if (!message || message.length > 2000) throw Error('invalid_feedback')
  return { category: value.category, message }
}
export async function saveFeedback(dataDirectory, value) {
  const feedback = validateFeedback(value)
  await fs.mkdir(dataDirectory, { recursive: true, mode: 0o700 })
  const record = { id: randomUUID(), createdAt: new Date().toISOString(), ...feedback }
  await fs.appendFile(path.join(dataDirectory, 'feedback.jsonl'), JSON.stringify(record) + '\n', { mode: 0o600 })
  return { id: record.id, saved: true }
}
export function createHandler({ dataDirectory, readPage = () => fs.readFile(pageFile) }) {
  return async (request, response) => {
    const reply = (status, value) => { response.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' }); response.end(JSON.stringify(value)) }
    try {
      if (request.method === 'GET' && request.url === '/') {
        response.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' }); response.end(await readPage()); return
      }
      if (request.method !== 'POST' || request.url !== '/api/feedback') return reply(404, { error: 'not_found' })
      if (!/^application\/json(?:;|$)/i.test(request.headers['content-type'] || '')) return reply(415, { error: 'json_required' })
      const chunks = []; let bytes = 0
      for await (const chunk of request) { bytes += Buffer.byteLength(chunk); if (bytes > 8192) return reply(413, { error: 'too_large' }); chunks.push(Buffer.from(chunk)) }
      let input
      try { input = validateFeedback(JSON.parse(Buffer.concat(chunks).toString('utf8'))) } catch { return reply(400, { error: 'invalid_feedback' }) }
      return reply(201, await saveFeedback(dataDirectory, input))
    } catch { return reply(500, { error: 'save_failed' }) }
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const dataDirectory = path.resolve(process.env.FEEDBACK_DATA_DIR || path.join(os.homedir(), '.local/share/shennian-examples/feedback'))
  const port = Number(process.env.PORT || 18371)
  if (!Number.isInteger(port) || port < 1024 || port > 65535) throw Error('invalid_port')
  http.createServer(createHandler({ dataDirectory })).listen(port, '127.0.0.1', () => console.log(`Feedback form: http://127.0.0.1:${port} (data is outside the web root)`))
}
