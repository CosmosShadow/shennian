// @arch open-source/docs/cli-runtime.md
// @test src/__tests__/acp-manifests.test.ts

import fs from 'node:fs'
import { renameSyncWithRetry } from '../../fs/atomic-rename.js'
import path from 'node:path'
import { z } from 'zod'
import { resolveShennianPath } from '../../config/index.js'
import type { AcpAgentManifest } from './types.js'

export const ACP_MANIFEST_SCHEMA_ID = 'https://shennian.net/schemas/acp-agent-manifest-v1.json'
export const ACP_MANIFEST_DIRECTORY = 'acp-agents.d'
const MAX_MANIFEST_BYTES = 64 * 1024

const manifestSchema = z.object({
  schemaVersion: z.literal(1),
  id: z.string().regex(/^[a-z0-9][a-z0-9._-]{0,63}$/),
  name: z.string().trim().min(1).max(80),
  protocol: z.literal('acp'),
  command: z.string().trim().min(1).max(4096),
  args: z.array(z.string().max(4096)).max(64).default([]),
  enabled: z.boolean().default(true),
  homepage: z.string().url().refine((url) => new URL(url).protocol === 'https:').optional(),
  clientCapabilities: z.object({
    readTextFile: z.boolean().default(false),
    writeTextFile: z.boolean().default(false),
    terminal: z.boolean().default(false),
  }).strict().optional(),
}).strict()

export type AcpManifestDocument = z.infer<typeof manifestSchema>

export function getAcpManifestDirectory(): string {
  return resolveShennianPath(ACP_MANIFEST_DIRECTORY)
}

export function validateAcpManifest(input: unknown): AcpManifestDocument {
  const document = manifestSchema.parse(input)
  if (document.command.includes('\0') || document.args.some((arg) => arg.includes('\0'))) {
    throw new Error('ACP manifest command contains NUL')
  }
  if (!path.isAbsolute(document.command) && path.basename(document.command) !== document.command) {
    throw new Error('ACP manifest command must be absolute or a plain command name')
  }
  return document
}

export function readAcpManifests(directory = getAcpManifestDirectory()): AcpAgentManifest[] {
  let names: string[]
  try {
    names = fs.readdirSync(directory).filter((name) => name.endsWith('.json')).sort()
  } catch {
    return []
  }
  const manifests: AcpAgentManifest[] = []
  const ids = new Set<string>()
  for (const name of names) {
    const file = path.join(directory, name)
    try {
      const stat = fs.statSync(file)
      if (!stat.isFile() || stat.size > MAX_MANIFEST_BYTES) continue
      const document = validateAcpManifest(JSON.parse(fs.readFileSync(file, 'utf8')))
      if (!document.enabled || ids.has(document.id)) continue
      ids.add(document.id)
      manifests.push({
        id: document.id,
        name: document.name,
        homepage: document.homepage,
        source: 'local',
        launch: { command: document.command, args: document.args },
        ...(document.clientCapabilities ? { clientCapabilities: document.clientCapabilities } : {}),
      })
    } catch {
      // One invalid or unreadable manifest must not hide other installed Agents.
    }
  }
  return manifests
}

export function writeAcpManifest(document: AcpManifestDocument, directory = getAcpManifestDirectory()): string {
  const value = validateAcpManifest(document)
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 })
  if (process.platform !== 'win32') fs.chmodSync(directory, 0o700)
  const target = path.join(directory, `${value.id}.json`)
  const temporary = `${target}.tmp-${process.pid}`
  try {
    fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600, flag: 'wx' })
    renameSyncWithRetry(temporary, target)
    if (process.platform !== 'win32') fs.chmodSync(target, 0o600)
  } finally {
    try { fs.unlinkSync(temporary) } catch {}
  }
  return target
}

export function removeAcpManifest(id: string, directory = getAcpManifestDirectory()): boolean {
  const normalized = validateAcpId(id)
  try {
    fs.unlinkSync(path.join(directory, `${normalized}.json`))
    return true
  } catch {
    return false
  }
}

export function validateAcpId(id: string): string {
  return manifestSchema.shape.id.parse(id)
}
