// @arch open-source/docs/cli-runtime.md
// @test src/__tests__/daemon-ipc.test.ts

import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { getShennianDir } from '../config/index.js'

export const MANAGED_ROOM_IPC_ROOT_ENV = 'SHENNIAN_MANAGED_ROOM_IPC_ROOT'

export type DaemonIpcPaths = {
  runtimeDirectory: string
  secretFile: string
  endpoint: string
  transport: 'unix_socket' | 'windows_named_pipe'
}

export function resolveDaemonIpcPaths(
  rootDir = getShennianDir(),
  platform: NodeJS.Platform = process.platform,
): DaemonIpcPaths {
  const runtimeDirectory = path.join(rootDir, 'runtime')
  const secretFile = path.join(runtimeDirectory, 'daemon-ipc.secret')
  if (platform === 'win32') {
    const scope = crypto
      .createHash('sha256')
      .update(path.resolve(rootDir).toLowerCase())
      .digest('hex')
      .slice(0, 20)
    return {
      runtimeDirectory,
      secretFile,
      endpoint: `\\\\.\\pipe\\shennian-daemon-${scope}`,
      transport: 'windows_named_pipe',
    }
  }
  return {
    runtimeDirectory,
    secretFile,
    endpoint: path.join(runtimeDirectory, 'daemon.sock'),
    transport: 'unix_socket',
  }
}

/**
 * Managed Agents must never read the persistent ~/.shennian tree. Their only
 * local bridge is a separate, daemon-owned IPC endpoint whose handler still
 * requires the per-turn managed Room capability.
 */
export function getManagedRoomIpcRoot(
  shennianDir = getShennianDir(),
  tempDirectory = os.tmpdir(),
): string {
  const scope = crypto
    .createHash('sha256')
    .update(path.resolve(shennianDir))
    .digest('hex')
    .slice(0, 20)
  // macOS limits sockaddr_un paths to 104 bytes. Its per-user temp directory is
  // already long, so keep the private managed-Room root deliberately compact.
  // macOS exposes the same temporary directory through both /var and
  // /private/var. Native sandboxes compare the canonical Unix-socket path,
  // so the daemon and restricted child must receive the same real path.
  let canonicalTempDirectory = tempDirectory
  try {
    canonicalTempDirectory = fsRealpath(tempDirectory)
  } catch {
    // Tests and unusual hosts may provide a not-yet-created temp root. The
    // daemon creates it later; path resolution remains deterministic there.
  }
  return path.join(canonicalTempDirectory, `sn-mr-${scope}`)
}

export function resolveManagedRoomIpcPaths(
  rootDir = getManagedRoomIpcRoot(),
  platform: NodeJS.Platform = process.platform,
): DaemonIpcPaths {
  return resolveDaemonIpcPaths(rootDir, platform)
}

function fsRealpath(value: string): string {
  // Keep this helper local so callers cannot accidentally canonicalize the
  // persistent Shennian credential root through a different policy path.
  return fs.realpathSync.native(value)
}
