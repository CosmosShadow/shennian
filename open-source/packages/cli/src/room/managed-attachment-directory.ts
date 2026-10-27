// @arch open-source/docs/cli-runtime.md
// @test src/__tests__/managed-attachment-directory.test.ts

import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

/** A private per-Session cache that a restricted Agent can read without seeing other Sessions' attachments. */
export function managedAttachmentDirectory(sessionId: string, baseDirectory = path.join(os.homedir(), '.shennian-room-attachments')): string {
  if (!sessionId || sessionId.length > 191) throw new Error('invalid_managed_attachment_session')
  if (!path.isAbsolute(baseDirectory)) throw new Error('invalid_managed_attachment_directory')
  const root = baseDirectory
  const directory = path.join(root, crypto.createHash('sha256').update(sessionId, 'utf8').digest('hex'))
  ensurePrivateDirectory(root)
  ensurePrivateDirectory(directory)
  return directory
}

function ensurePrivateDirectory(directory: string): void {
  try {
    fs.mkdirSync(directory, { mode: 0o700 })
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
  }
  const stat = fs.lstatSync(directory)
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('unsafe_managed_attachment_directory')
  if (process.platform !== 'win32') fs.chmodSync(directory, 0o700)
}
