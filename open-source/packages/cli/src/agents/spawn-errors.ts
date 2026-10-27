// @arch open-source/docs/cli-runtime.md
// @test src/__tests__/codex-adapter.test.ts
import fs from 'node:fs'

/**
 * Node reports a missing spawn `cwd` as ENOENT, exactly like a missing executable. Blaming the
 * CLI for a deleted project directory sends the user to reinstall the wrong thing, so only
 * report the command as missing when the working directory is actually there.
 */
export function spawnEnoentError(workDir: string | null | undefined, commandNotFound: string): Error {
  if (workDir && !fs.existsSync(workDir)) {
    return new Error(`agent_workdir_not_found: 工作目录不存在：${workDir}`)
  }
  return new Error(commandNotFound)
}
