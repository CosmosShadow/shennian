// @covers open-source/packages/cli/src/upgrade/updater-bootstrap.ts

import fs from 'node:fs'
import os from 'node:os'
import { execFileSync } from 'node:child_process'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { ensureUpdaterInstalled, readUpdaterReadiness } from '../upgrade/updater-bootstrap.js'

const roots: string[] = []
afterEach(() => roots.splice(0).forEach((root) => fs.rmSync(root, { recursive: true, force: true })))

describe('updater bootstrap', () => {
  it('copies the worker outside the package and writes a non-sensitive readiness marker', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'shennian-updater-bootstrap-'))
    roots.push(root)
    const asset = path.join(root, 'source.js')
    const runtime = path.join(root, 'runtime')
    fs.writeFileSync(asset, '#!/usr/bin/env node\n')
    const readiness = ensureUpdaterInstalled({ root: runtime, assetPath: asset, now: new Date(0) })
    expect(fs.readFileSync(readiness.workerPath, 'utf8')).toBe('#!/usr/bin/env node\n')
    expect(readUpdaterReadiness(runtime)).toEqual(readiness)
    const marker = fs.readFileSync(path.join(runtime, 'readiness.json'), 'utf8')
    expect(marker).not.toMatch(/token|prompt|session|room/i)
  })

  it('runs the copied ESM worker outside the npm package even under a CommonJS parent', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'shennian-worker-esm-'))
    roots.push(root)
    fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ type: 'commonjs' }))
    const asset = path.join(root, 'source.js')
    fs.writeFileSync(asset, "import { basename } from 'node:path'; process.stdout.write(basename('/worker/ready'))")
    const readiness = ensureUpdaterInstalled({ root: path.join(root, 'runtime'), assetPath: asset })
    expect(JSON.parse(fs.readFileSync(path.join(path.dirname(readiness.workerPath), 'package.json'), 'utf8'))).toEqual({ type: 'module' })
    expect(execFileSync(process.execPath, [readiness.workerPath], { encoding: 'utf8' })).toBe('ready')
  })

  it('atomically switches current without deleting an older protocol directory', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'shennian-updater-bootstrap-'))
    roots.push(root)
    const asset = path.join(root, 'source.js')
    const runtime = path.join(root, 'runtime')
    fs.mkdirSync(path.join(runtime, 'versions', '0'), { recursive: true })
    fs.writeFileSync(path.join(runtime, 'versions', '0', 'updater-worker.js'), 'old')
    fs.writeFileSync(asset, 'new')
    ensureUpdaterInstalled({ root: runtime, assetPath: asset })
    expect(fs.readFileSync(path.join(runtime, 'versions', '0', 'updater-worker.js'), 'utf8')).toBe('old')
  })
})
