// @arch open-source/docs/cli-runtime.md
// @test src/__tests__/managed-agent-executable.test.ts

import crypto from 'node:crypto'
import fs from 'node:fs'
import { spawnSync, type SpawnSyncReturns } from 'node:child_process'
import type { ResolvedCommandSpec } from '../agents/command-spec.js'

const SHA256 = /^[a-f0-9]{64}$/

export type ManagedAgentExecutableIdentity = {
  platform: NodeJS.Platform
  isWsl: boolean
  executableFingerprint?: string
}

type WslSpawn = (
  command: string,
  args: readonly string[],
) => Pick<SpawnSyncReturns<string>, 'status' | 'stdout'>

/**
 * Hashes the exact command selected by command-spec. WSL launchers are special:
 * hashing wsl.exe would bind the confirmation to the bridge rather than the
 * Agent, so the digest is computed inside WSL from the resolved Agent path.
 */
export function resolveManagedAgentExecutableIdentity(
  spec: ResolvedCommandSpec,
  options: {
    platform?: NodeJS.Platform
    wslSpawn?: WslSpawn
  } = {},
): ManagedAgentExecutableIdentity {
  const hostPlatform = options.platform ?? process.platform
  if (spec.kind === 'wsl-bridge') {
    const executableFingerprint = fingerprintWslExecutable(
      spec,
      options.wslSpawn ?? defaultWslSpawn,
    )
    return {
      platform: 'linux',
      isWsl: true,
      ...(executableFingerprint ? { executableFingerprint } : {}),
    }
  }

  const executableFingerprint = fingerprintNativeExecutable(spec.path)
  return {
    platform: hostPlatform,
    isWsl: false,
    ...(executableFingerprint ? { executableFingerprint } : {}),
  }
}

export function fingerprintNativeExecutable(filePath: string): string | undefined {
  let descriptor: number | undefined
  try {
    const resolved = fs.realpathSync(filePath)
    descriptor = fs.openSync(resolved, 'r')
    if (!fs.fstatSync(descriptor).isFile()) return undefined
    const digest = crypto.createHash('sha256')
    const buffer = Buffer.allocUnsafe(64 * 1024)
    while (true) {
      const bytesRead = fs.readSync(descriptor, buffer, 0, buffer.length, null)
      if (bytesRead === 0) break
      digest.update(buffer.subarray(0, bytesRead))
    }
    return `sha256:${digest.digest('hex')}`
  } catch {
    return undefined
  } finally {
    if (descriptor !== undefined) {
      try { fs.closeSync(descriptor) } catch {}
    }
  }
}

function fingerprintWslExecutable(
  spec: ResolvedCommandSpec,
  run: WslSpawn,
): string | undefined {
  const command = quotePosix(spec.command)
  const script = [
    'set -eu',
    `target=$(command -v -- ${command})`,
    'target=$(readlink -f -- "$target")',
    '[ -f "$target" ]',
    'if command -v sha256sum >/dev/null 2>&1; then sha256sum -- "$target"',
    'elif command -v shasum >/dev/null 2>&1; then shasum -a 256 -- "$target"',
    'elif command -v openssl >/dev/null 2>&1; then openssl dgst -sha256 "$target"',
    'else exit 127; fi',
  ].join('; ')
  try {
    const result = run(spec.path, ['-e', 'sh', '-lc', script])
    if (result.status !== 0 || typeof result.stdout !== 'string') return undefined
    const digest = result.stdout.toLowerCase().match(/[a-f0-9]{64}/)?.[0]
    return digest && SHA256.test(digest) ? `sha256:${digest}` : undefined
  } catch {
    return undefined
  }
}

function defaultWslSpawn(command: string, args: readonly string[]) {
  return spawnSync(command, [...args], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
    timeout: 10_000,
    windowsHide: true,
    maxBuffer: 1024,
  })
}

function quotePosix(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`
}
