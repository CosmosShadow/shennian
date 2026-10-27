// @arch open-source/docs/cli-runtime.md
// @test src/__tests__/english-command.test.ts
import type { Command } from 'commander'
import { loadConfig } from '../config/index.js'
import { regionToUrl } from '../region.js'

export async function readEnglishProgress(fetchImpl: typeof fetch = fetch) {
  const config = loadConfig()
  if (!config.machineToken || !config.machineId) throw new Error('not_paired')
  const response = await fetchImpl(
    `${(config.serverUrl ?? regionToUrl('cn')).replace(/\/$/, '')}/api/english-cli/progress`,
    {
      method: 'GET',
      redirect: 'error',
      signal: AbortSignal.timeout(30000),
      headers: { authorization: `Bearer ${config.machineToken}` },
    },
  )
  if (!response.ok)
    throw new Error(
      response.status === 401
        ? 'english_auth_required'
        : response.status === 403
          ? 'english_access_denied'
          : response.status === 402
            ? 'english_plan_required'
            : response.status === 404
              ? 'english_server_upgrade_required'
              : 'english_progress_unavailable',
    )
  return await response.json()
}
export function registerEnglishCommand(
  program: Command,
  options: {
    read?: () => Promise<unknown>
    write?: (value: string) => void
    fail?: () => void
  } = {},
) {
  const write =
    options.write ??
    ((value) => {
      process.stdout.write(value)
    })
  program
    .command('english')
    .description('Read your cloud English learning progress (no recording or writes)')
    .command('progress')
    .description(
      'Fetch the paired account vocabulary, real usage counts and mastery states as JSON',
    )
    .action(async () => {
      try {
        write(
          `${JSON.stringify({ ok: true, ...((await (options.read ?? readEnglishProgress)()) as object) })}\n`,
        )
      } catch (error) {
        const message = error instanceof Error ? error.message : ''
        const code = [
          'not_paired',
          'english_auth_required',
          'english_access_denied',
          'english_plan_required',
          'english_server_upgrade_required',
        ].includes(message)
          ? message
          : 'english_progress_unavailable'
        write(`${JSON.stringify({ ok: false, error: code })}\n`)
        ;(
          options.fail ??
          (() => {
            process.exitCode = 1
          })
        )()
      }
    })
}
