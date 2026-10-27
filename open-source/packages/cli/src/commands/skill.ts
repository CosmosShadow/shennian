// @arch open-source/docs/cli-runtime.md
// @test src/__tests__/skill-updater.test.ts

import type { Command } from 'commander'
import { getCurrentVersion } from '../upgrade/engine.js'
import { updateOfficialSkill } from '../skill/updater.js'

export function registerSkillCommand(program: Command): void {
  const skill = program.command('skill').description('Check or update one explicitly referenced official Skill')
  skill
    .command('update')
    .requiredOption('--path <path>', 'Absolute path to the current Shennian SKILL.md')
    .option('--force-check', 'Ignore the 24-hour check cache')
    .option('--replace', 'Explicitly replace an unregistered or locally modified copy')
    .option('--json', 'Print machine-readable result JSON')
    .action(async (flags: { path: string; forceCheck?: boolean; replace?: boolean; json?: boolean }) => {
      try {
        const result = await updateOfficialSkill(flags.path, {
          clientVersion: getCurrentVersion(),
          forceCheck: flags.forceCheck,
          replace: flags.replace,
        })
        if (flags.json) process.stdout.write(`${JSON.stringify({ ok: true, command: 'skill.update', result })}\n`)
        else console.log(result.message)
      } catch (error) {
        const message = error instanceof Error ? error.message : 'skill_update_failed'
        if (flags.json) {
          process.stdout.write(`${JSON.stringify({ ok: false, command: 'skill.update', error: message })}\n`)
        } else console.error(`Skill update failed: ${message}`)
        process.exitCode = 1
      }
    })
}
