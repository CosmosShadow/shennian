// @arch open-source/docs/cli-runtime.md
// @test src/__tests__/personal-recordings.test.ts
import type { Command } from 'commander'
import { configureRecordingDirectory, recordingDirectory } from '../personal-workspace/recordings.js'
export function registerRecordingCommand(program: Command): void {
  program.command('recordings').description('Configure private original-audio storage on this Client')
    .command('directory [absolute-path]').description('Show or configure the receiving directory (restart Client after changing it)')
    .action((directory?: string) => {
      try {
        const selected = directory ? configureRecordingDirectory(directory) : recordingDirectory()
        process.stdout.write(`${JSON.stringify({ ok: true, directory: selected, restartRequired: !!directory, previousFilesNotMigrated: !!directory })}\n`)
      } catch {
        process.stdout.write(`${JSON.stringify({ ok: false, error: 'recording_directory_invalid' })}\n`)
        process.exitCode = 1
      }
    })
}
