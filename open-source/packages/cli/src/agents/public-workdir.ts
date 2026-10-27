// @arch open-source/docs/cli-runtime.md

import fs from 'node:fs/promises'
import path from 'node:path'
import { resolveProtectedShennianDirectories } from '../security/managed-agent-credential-paths.js'

function contains(root: string, candidate: string) {
  const relative = path.relative(root, candidate)
  return relative === '' || (relative !== '..' && !relative.startsWith(`..${path.sep}`)
    && !path.isAbsolute(relative))
}

/** Reuse the Owner's existing Agent directory; never create or chmod a visitor workspace. */
export async function preparePublicAgentWorkDir(workDir: string): Promise<string> {
  if (typeof workDir !== 'string' || !workDir.trim() || workDir.length > 1024
    || workDir.includes('\0') || !path.isAbsolute(workDir.trim())) {
    throw new Error('public_agent_workdir_invalid')
  }
  const resolved = await fs.realpath(workDir.trim())
  if (!(await fs.stat(resolved)).isDirectory()) throw new Error('public_agent_workdir_invalid')
  const protectedRoots = resolveProtectedShennianDirectories()
  if (protectedRoots.some((protectedRoot) => contains(protectedRoot, resolved)
    || contains(resolved, protectedRoot))) {
    throw new Error('public_agent_workdir_credential_overlap')
  }
  return resolved
}
