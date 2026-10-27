// @arch open-source/docs/cli-runtime.md

import path from 'node:path'
import { SESSION_SYNC_DATA_EPOCH } from '@shennian/wire'
import { resolveShennianPath } from '../config/index.js'

export const PERSONAL_SYNC_V1_ROOT_NAME = 'personal-sync-v1'
export const PERSONAL_SYNC_ROOT_NAME = 'personal-sync'

export function resolvePersonalSyncV1RootPath(...parts: string[]): string {
  return path.join(resolveShennianPath(PERSONAL_SYNC_V1_ROOT_NAME), ...parts)
}

export function resolvePersonalSyncRootPath(...parts: string[]): string {
  return path.join(resolveShennianPath(PERSONAL_SYNC_ROOT_NAME), ...parts)
}

export function resolvePersonalSyncV1Path(...parts: string[]): string {
  // Kept as an exported name while callers migrate. The active data root is
  // machine + epoch scoped; the current account is authorization only.
  return resolvePersonalSyncRootPath(String(SESSION_SYNC_DATA_EPOCH), ...parts)
}
