// @arch open-source/docs/cli-runtime.md
// @test src/__tests__/native-fusion-local-repository.test.ts

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

/** Reserved for real-provider probes. Keep it under HOME for macOS file-sandbox tests. */
export function nativeTestWorkspaceRoot(): string {
  return path.join(os.homedir(), 'tmp', 'shennian-tests')
}

export function isNativeTestWorkspace(workDir: string): boolean {
  if (!path.isAbsolute(workDir)) return false
  const root = nativeTestWorkspaceRoot()
  let canonicalRoot = root
  try { canonicalRoot = fs.realpathSync.native(root) } catch { /* Root may not exist yet. */ }
  return [root, canonicalRoot].some((candidateRoot) => {
    const relative = path.relative(candidateRoot, path.resolve(workDir))
    return relative === '' || (relative !== '..' && !relative.startsWith(`..${path.sep}`)
      && !path.isAbsolute(relative))
  })
}
