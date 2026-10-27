// @covers open-source/packages/cli/src/room/managed-attachment-directory.ts

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, expect, it } from 'vitest'
import { managedAttachmentDirectory } from '../room/managed-attachment-directory.js'

const roots: string[] = []
afterEach(() => { for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true }) })

it('isolates attachment paths by managed Session without exposing its id', () => {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), 'managed-attachment-directory-'))
  roots.push(parent)
  const base = path.join(parent, 'attachments')
  const first = managedAttachmentDirectory('session-a', base)
  const second = managedAttachmentDirectory('session-b', base)
  expect(first).not.toBe(second)
  expect(first).not.toContain('session-a')
  expect(path.dirname(first)).toBe(base)
  if (process.platform !== 'win32') {
    expect(fs.statSync(base).mode & 0o777).toBe(0o700)
    expect(fs.statSync(first).mode & 0o777).toBe(0o700)
  }
})

it('refuses a symlinked attachment root', () => {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), 'managed-attachment-symlink-'))
  roots.push(parent)
  const target = path.join(parent, 'target')
  fs.mkdirSync(target)
  const alias = path.join(parent, 'alias')
  fs.symlinkSync(target, alias)
  expect(() => managedAttachmentDirectory('session-a', alias)).toThrow('unsafe_managed_attachment_directory')
})
