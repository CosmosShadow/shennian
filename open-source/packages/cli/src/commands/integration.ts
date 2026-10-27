// @arch open-source/docs/cli-runtime.md
// @test src/__tests__/retired-external-channel-compat.test.ts

import type { Command } from 'commander'

/** Compatibility tombstone. Shennian no longer writes third-party host config. */
export function registerIntegrationCommand(program: Command): void {
  program
    .command('integration', { hidden: true })
    .allowUnknownOption(true)
    .allowExcessArguments(true)
    .action(() => {
      process.stdout.write(`${JSON.stringify({
        ok: false,
        error: 'integration_command_retired',
        message: 'Shennian no longer installs MCP, Hooks, or host integrations. Install the official Shennian Skill with your Agent host.',
        nextAction: { type: 'open_install_guide', url: 'https://shennian.net/install.md' },
      })}\n`)
      process.exitCode = 1
    })
}
