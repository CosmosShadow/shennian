// @arch open-source/docs/server-runtime.md
// @covers open-source/packages/server/scripts/check-core-boundary.mjs
// @covers open-source/packages/server/scripts/build-core.mjs
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { checkCoreBoundary } from '../../packages/server/scripts/check-core-boundary.mjs'
import { buildCore } from '../../packages/server/scripts/build-core.mjs'
const parent = path.join(os.tmpdir(), 'shennian-tests/unit')
fs.mkdirSync(parent, { recursive: true })
function fixture(run) {
  const root = fs.mkdtempSync(path.join(parent, 'core-boundary-'))
  const configPath = path.join(root, 'tsconfig.core.json')
  fs.writeFileSync(configPath, JSON.stringify({ files: ['core.ts'], compilerOptions: { noLib: true, types: [], module: 'ESNext', moduleResolution: 'bundler' } }))
  try { run(root, configPath) } finally { fs.rmSync(root, { recursive: true, force: true }) }
}
test('core host resolves public inputs and refuses forbidden or missing source imports', () => fixture((root, configPath) => {
  fs.writeFileSync(path.join(root, 'core.ts'), 'export const modules = []')
  assert.equal(checkCoreBoundary({ configPath, forbiddenDirectories: [] }).sourceFiles, 1)
  const forbidden = path.join(root, 'forbidden')
  fs.mkdirSync(forbidden)
  fs.writeFileSync(path.join(forbidden, 'module.ts'), 'export const value = 1')
  fs.writeFileSync(path.join(root, 'core.ts'), "export { value } from './forbidden/module'")
  assert.throws(() => checkCoreBoundary({ configPath, forbiddenDirectories: [forbidden] }), /Cannot find module/)
  fs.writeFileSync(path.join(root, 'core.ts'), "export { value } from './missing'")
  assert.throws(() => checkCoreBoundary({ configPath, forbiddenDirectories: [] }), /Cannot find module/)
}))
test('successful core output contains schemas and an empty module manifest', () => fixture(root => {
  fs.writeFileSync(path.join(root, 'core.ts'), 'export const modules = []')
  fs.mkdirSync(path.join(root, 'src/schemas'), { recursive: true })
  fs.writeFileSync(path.join(root, 'src/schemas/unit.json'), '{}')
  buildCore({ root, runCompiler: (_config, cwd) => {
    fs.mkdirSync(path.join(cwd, 'dist-core'))
    fs.writeFileSync(path.join(cwd, 'dist-core/core-server.js'), 'export {}')
  } })
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(root, 'dist-core/build-modules.json'), 'utf8')).modules, [])
  assert.equal(fs.readFileSync(path.join(root, 'dist-core/schemas/unit.json'), 'utf8'), '{}')
}))
test('failed compilation cannot leave an old successful manifest', () => fixture(root => {
  fs.writeFileSync(path.join(root, 'core.ts'), 'export const modules = []')
  fs.mkdirSync(path.join(root, 'dist-core'))
  fs.writeFileSync(path.join(root, 'dist-core/build-modules.json'), '{}')
  assert.throws(() => buildCore({ root, runCompiler: () => { throw Error('unit_compile_failure') } }), /unit_compile_failure/)
  assert.equal(fs.existsSync(path.join(root, 'dist-core/build-modules.json')), false)
}))
