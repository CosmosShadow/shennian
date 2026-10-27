// @arch open-source/docs/system-architecture.md
// @covers open-source/deploy/self-hosted/backup-archive.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import crypto from 'node:crypto'
import { archive } from './backup-archive.mjs'
function fixture(t) {
  const parent = path.join(os.tmpdir(), 'shennian-tests/unit')
  fs.mkdirSync(parent, { recursive: true })
  const root = fs.mkdtempSync(path.join(parent, 'backup-'))
  t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  const keyFile = path.join(root, 'key'), input = path.join(root, 'input')
  fs.writeFileSync(keyFile, crypto.randomBytes(32), { mode: 0o600 })
  fs.writeFileSync(input, 'private fixture only\n'.repeat(10000))
  return { root, keyFile, input, output: path.join(root, 'sealed') }
}
test('roundtrip preserves exact bytes, publishes private output and randomizes ciphertext', async t => {
  const f = fixture(t)
  await archive({ ...f, mode: 'seal' })
  const restored = path.join(f.root, 'restored')
  await archive({ mode: 'open', input: f.output, output: restored, keyFile: f.keyFile })
  assert.deepEqual(fs.readFileSync(restored), fs.readFileSync(f.input))
  assert.equal(fs.statSync(restored).mode & 0o777, 0o600)
  const second = path.join(f.root, 'second')
  await archive({ ...f, mode: 'seal', output: second })
  assert.notDeepEqual(fs.readFileSync(second), fs.readFileSync(f.output))
})
for (const kind of ['ciphertext', 'tag', 'nonce', 'header', 'truncated', 'wrong-key']) {
  test(`rejects ${kind} without publishing plaintext or leaving partial files`, async t => {
    const f = fixture(t)
    await archive({ ...f, mode: 'seal' })
    let bytes = fs.readFileSync(f.output)
    if (kind === 'wrong-key') fs.writeFileSync(f.keyFile, crypto.randomBytes(32))
    else if (kind === 'truncated') bytes = bytes.subarray(0, 30)
    else { const index = { ciphertext: 25, tag: bytes.length - 1, nonce: 10, header: 0 }[kind]; bytes[index] ^= 1 }
    fs.writeFileSync(f.output, bytes)
    const restored = path.join(f.root, 'restored')
    await assert.rejects(archive({ mode: 'open', input: f.output, output: restored, keyFile: f.keyFile }))
    assert.equal(fs.existsSync(restored), false)
    assert.equal(fs.readdirSync(f.root).some(x => x.includes('.partial-')), false)
  })
}
test('rejects insecure keys, symbolic inputs and existing destinations', async t => {
  const f = fixture(t)
  fs.chmodSync(f.keyFile, 0o644)
  await assert.rejects(archive({ ...f, mode: 'seal' }), /permissions/)
  fs.chmodSync(f.keyFile, 0o600)
  fs.writeFileSync(f.output, 'keep')
  await assert.rejects(archive({ ...f, mode: 'seal' }), /not_exist/)
  assert.equal(fs.readFileSync(f.output, 'utf8'), 'keep')
  fs.unlinkSync(f.output)
  const sym = path.join(f.root, 'link'); fs.symlinkSync(f.input, sym)
  await assert.rejects(archive({ ...f, mode: 'seal', input: sym }), /regular_file/)
})
test('supports empty archives and rejects invalid key length or mode', async t => {
  const f = fixture(t); fs.writeFileSync(f.input, '')
  await archive({ ...f, mode: 'seal' })
  await archive({ mode: 'open', input: f.output, output: path.join(f.root, 'empty'), keyFile: f.keyFile })
  assert.equal(fs.statSync(path.join(f.root, 'empty')).size, 0)
  fs.writeFileSync(f.keyFile, 'bad')
  await assert.rejects(archive({ ...f, output: path.join(f.root, 'new'), mode: 'seal' }), /32_random/)
  await assert.rejects(archive({ ...f, mode: 'other' }), /invalid_archive_mode/)
})
