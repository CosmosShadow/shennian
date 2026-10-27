// @arch open-source/docs/cli-runtime.md
// @test src/__tests__/command-reference.test.ts

import type { Command } from 'commander'
import { registerGuideCommand } from './guide.js'

function isPublic(command: Command): boolean {
  return !(command as Command & { _hidden?: boolean })._hidden
}

export function registerCommandReference(program: Command, clientVersion: string): void {
  registerGuideCommand(program, clientVersion)
  program.addHelpCommand(false)
  program
    .command('help [path...]')
    .description('Show current Client commands and usage')
    .action((path: string[]) => {
      let current = program
      for (const segment of path) {
        const child = current.commands.find(command => isPublic(command) &&
          (command.name() === segment || command.aliases().includes(segment)))
        if (!child) {
          process.stderr.write(`Unknown command: ${path.join(' ')}\n`)
          process.exitCode = 1
          return
        }
        current = child
      }
      process.stdout.write(`Shennian Client ${clientVersion}\n${current.helpInformation()}\n`)
    })
}
