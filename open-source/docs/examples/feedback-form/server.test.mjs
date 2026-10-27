// @covers ./server.mjs
// @arch open-source/docs/application-examples.md
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import process from 'node:process'
import { Readable } from 'node:stream'
import { Buffer } from 'node:buffer'
import { createHandler, saveFeedback, validateFeedback } from './server.mjs'
const parent = path.join(os.tmpdir(), 'shennian-tests/unit'); await fs.mkdir(parent, { recursive: true })
test('validates fields and rejects secrets-like extra fields, empty or oversized text', () => {
  assert.deepEqual(validateFeedback({ category: 'idea', message: '  hello  ' }), { category: 'idea', message: 'hello' })
  for (const value of [null, [], {}, { category: 'admin', message: 'x' }, { category: 'idea', message: ' ' }, { category: 'bug', message: 'x'.repeat(2001) }, { category: 'idea', message: 'ok', token: 'not-a-real-token' }]) assert.throws(() => validateFeedback(value))
})
test('persists local records with restricted permissions outside web resources', async () => {
  const directory = await fs.mkdtemp(path.join(parent, 'feedback-'))
  try { const result = await saveFeedback(directory, { category: 'idea', message: '<script>no execution</script>\nnext line' }); const rows = (await fs.readFile(path.join(directory, 'feedback.jsonl'), 'utf8')).trim().split('\n'); assert.equal(rows.length, 1); assert.equal(JSON.parse(rows[0]).id, result.id); assert.equal(result.saved, true); if (process.platform !== 'win32') assert.equal((await fs.stat(path.join(directory, 'feedback.jsonl'))).mode & 0o077, 0) } finally { await fs.rm(directory, { recursive: true }) }
})
test('handler saves JSON, never exposes saved records and rejects invalid requests without opening a socket', async () => {
  const directory = await fs.mkdtemp(path.join(parent, 'feedback-handler-'))
  const handler = createHandler({ dataDirectory: directory, readPage: async () => '<html>demo</html>' })
  async function call(method, url, body = '', type = 'application/json') {
    const request = Readable.from([Buffer.from(body)]); Object.assign(request, { method, url, headers: { 'content-type': type } }); let status, response
    await handler(request, { writeHead(code) { status = code }, end(value) { response = value } }); return { status, response }
  }
  try { assert.equal((await call('GET', '/')).status, 200); assert.equal((await call('POST', '/api/feedback', JSON.stringify({ category: 'bug', message: 'Hello' }))).status, 201); for (const url of ['/feedback.jsonl', '/api/admin', '/../feedback.jsonl']) assert.equal((await call('GET', url)).status, 404); assert.equal((await call('POST', '/api/feedback', '{}')).status, 400); assert.equal((await call('POST', '/api/feedback', 'x'.repeat(8193))).status, 413); assert.equal((await call('POST', '/api/feedback', '{}', 'text/plain')).status, 415) } finally { await fs.rm(directory, { recursive: true }) }
})
