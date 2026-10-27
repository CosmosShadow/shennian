// @arch open-source/docs/cli-runtime.md
// @test src/__tests__/logout.test.ts
import { execFile } from 'node:child_process'
import fs from 'node:fs'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import type { Command } from 'commander'
import { getConfigPath, saveConfig, type ShennianConfig } from '../config/index.js'

const execFileAsync = promisify(execFile)

export async function logout(): Promise<void> {
  // Reuse the installed CLI's cross-platform stop contract, including its durable
  // autostart lock. A separate process also keeps its status output out of ours.
  const entrypoint = fileURLToPath(new URL('../../bin/shennian.js', import.meta.url))
  const readStatus = async (command: 'status' | 'stop') => {
    const { stdout } = await execFileAsync(process.execPath, [entrypoint, command, '--json'], {
      timeout: 30_000, windowsHide: true,
    })
    return JSON.parse(stdout)
  }
  const initial = await readStatus('status')
  // An already unloaded launchd service can reject a second bootout. Its
  // durable pause marker and stopped process are sufficient for repeated logout.
  if (initial.error || initial.running !== false || initial.remoteAccessDisabled !== true) {
    const status = await readStatus('stop')
    if (status.error || status.running !== false || status.remoteAccessDisabled !== true) {
      throw new Error('Background service did not stop completely')
    }
  }

  // Read strictly: loadConfig's recovery fallback must not erase unrelated
  // settings when the file is unreadable or malformed.
  const configPath = getConfigPath()
  if (!fs.existsSync(configPath)) return
  const config = JSON.parse(fs.readFileSync(configPath, 'utf8').replace(/^\uFEFF/, '')) as ShennianConfig
  if (!config || typeof config !== 'object' || Array.isArray(config)) {
    throw new Error('Invalid configuration')
  }
  delete config.machineId
  delete config.machineToken
  delete config.accountNamespaceId
  delete config.accessToken
  delete config.refreshToken
  saveConfig(config)
}

export function registerLogoutCommand(program: Command): void {
  program.command('logout')
    .description('Stop the background service and clear local Shennian login credentials')
    .option('--json', 'Print machine-readable result JSON')
    .action(async (opts: { json?: boolean }) => {
      try {
        await logout()
        const message = 'Logged out of Shennian. Run shennian pair to sign in again.'
        console.log(opts.json ? JSON.stringify({ ok: true, message }) : message)
      } catch {
        // Child-process errors may contain captured logs; never echo them.
        const message = 'Logout incomplete. Check shennian status and retry shennian logout.'
        if (opts.json) {
          console.log(JSON.stringify({ ok: false, error: 'logout_failed', message, nextAction: 'retry_logout' }))
        } else {
          console.error(message)
        }
        process.exitCode = 1
      }
    })
}
