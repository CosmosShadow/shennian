// @arch docs/architecture/session-organization.md
// @test packages/app/src/__tests__/project-directory.test.ts

import type { ResFrame } from '@shennian/wire'

export function isHomeDirectoryAlias(path: string): boolean {
  return /^~(?:[\\/]|$)/.test(path.trim())
}

/** Resolve on the target machine, never using the phone's or desktop's home. */
export async function resolveProjectDirectory(
  machineId: string,
  workDir: string,
  runtime: {
    observeMachine(machineId: string): Promise<boolean>
    unobserveMachine(machineId: string): Promise<void>
    requestMachine(machineId: string, method: string, params: { path: string }): Promise<ResFrame>
  },
): Promise<string> {
  const path = workDir.trim()
  // Already selected absolute directories retain their existing offline semantics.
  if (!isHomeDirectoryAlias(path)) return path
  const observed = await runtime.observeMachine(machineId)
  if (!observed) throw new Error('Unable to connect to machine')
  try {
    const response = await runtime.requestMachine(machineId, 'fs.ls', { path })
    if (!response.ok) throw new Error(response.error || 'Unable to resolve project directory')
    const resolved = (response.payload as { path?: unknown } | undefined)?.path
    if (typeof resolved !== 'string' || !/^(?:\/|[A-Za-z]:[\\/]|\\\\)/.test(resolved)) {
      throw new Error('Machine returned an invalid project directory')
    }
    return resolved
  } finally {
    await runtime.unobserveMachine(machineId)
  }
}
