import process from 'node:process'
// @arch open-source/docs/server-runtime.md
// @covers open-source/deploy/self-hosted/init-config.mjs
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createConfiguration } from './init-config.mjs'
const parent = path.join(os.tmpdir(), 'shennian-tests/unit')
fs.mkdirSync(parent, { recursive: true })
test('generates independent identities and secrets without requiring any provider credentials', () => {
  const root = fs.mkdtempSync(path.join(parent, 'selfhost-init-'))
  try {
    for (const name of ['one', 'two']) {
      const directory = path.join(root, name)
      assert.deepEqual(createConfiguration(directory, { publicUrl: 'https://example.invalid' }), { files: 2, registration: 'invite' })
      if (process.platform !== 'win32') assert.equal(fs.statSync(path.join(directory, 'server.env')).mode & 0o777, 0o600)
    }
    const first = fs.readFileSync(path.join(root, 'one/server.env'), 'utf8')
    const second = fs.readFileSync(path.join(root, 'two/server.env'), 'utf8')
    assert.notEqual(first, second)
    assert.match(first, /SHENNIAN_PUSH_MODE=off/)
    assert.match(first, /SHENNIAN_STORAGE_PROVIDER=local/)
    assert.doesNotMatch(first, /API_KEY|ACCESS_KEY|SMS/)
    assert.throws(() => createConfiguration(path.join(root, 'one'), { publicUrl: 'https://example.invalid' }), /already_exists/)
    assert.equal(fs.readFileSync(path.join(root, 'one/server.env'), 'utf8'), first)
    assert.throws(() => createConfiguration(path.join(root, 'bad'), { publicUrl: 'http://example.invalid' }), /https/)
    assert.equal(fs.existsSync(path.join(root, 'bad')), false)
  } finally { fs.rmSync(root, { recursive: true, force: true }) }
})
