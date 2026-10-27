// @arch open-source/docs/system-architecture.md
// @covers open-source/deploy/self-hosted/verify-runtime.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import crypto from 'node:crypto'
import { verifyRuntime } from './verify-runtime.mjs'

function fixture(t, file = 'packages/server/dist/core-server.js') {
  const base = path.join(os.tmpdir(), 'shennian-tests/unit')
  fs.mkdirSync(base, { recursive: true })
  const root = fs.mkdtempSync(path.join(base, 'runtime-verifier-'))
  t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true })
  fs.writeFileSync(path.join(root, file), 'export {}\n')
  const manifest = { schemaVersion: 1, variant: 'self-hosted', modules: [], files: {
    [file]: crypto.createHash('sha256').update('export {}\n').digest('hex'),
  } }
  const save = () => fs.writeFileSync(path.join(root, 'runtime-manifest.json'), JSON.stringify(manifest))
  save()
  return { root, file, manifest, save }
}
test('accepts a complete, unchanged public core runtime', t => {
  const { root } = fixture(t)
  assert.deepEqual(verifyRuntime(root), { variant: 'self-hosted', files: 1 })
})
test('rejects changed or missing compiled files', t => {
  const { root, file } = fixture(t)
  fs.appendFileSync(path.join(root, file), '// changed')
  assert.throws(() => verifyRuntime(root), /runtime_hash_mismatch/)
  fs.unlinkSync(path.join(root, file))
  assert.throws(() => verifyRuntime(root), /runtime_file_missing/)
})
for (const file of ['private/business.js', 'internal-docs/plan.md', '.env', 'database.env']) {
  test(`rejects forbidden input even when checksummed: ${file}`, t => {
    const { root } = fixture(t, file)
    assert.throws(() => verifyRuntime(root), /forbidden_runtime_path/)
  })
}
test('rejects unlisted files and symlinks', t => {
  const { root } = fixture(t)
  const unexpected = path.join(root, 'unexpected.txt')
  fs.writeFileSync(unexpected, 'fixture')
  assert.throws(() => verifyRuntime(root), /unmanifested_runtime_file/)
  fs.unlinkSync(unexpected)
  fs.symlinkSync(path.join(root, 'runtime-manifest.json'), unexpected)
  assert.throws(() => verifyRuntime(root), /runtime_symlink_not_allowed/)
})
test('rejects declared modules and path traversal', t => {
  const { root, manifest, save } = fixture(t)
  manifest.modules = ['billing']; save()
  assert.throws(() => verifyRuntime(root), /invalid_core_runtime_manifest/)
  manifest.modules = []; manifest.files['../escape'] = 'a'.repeat(64); save()
  assert.throws(() => verifyRuntime(root), /forbidden_runtime_path/)
})
test('rejects a symlinked manifest before reading it', t => {
  const { root, file } = fixture(t)
  fs.unlinkSync(path.join(root, 'runtime-manifest.json'))
  fs.symlinkSync(path.join(root, file), path.join(root, 'runtime-manifest.json'))
  assert.throws(() => verifyRuntime(root), /runtime_regular_files_only/)
})
