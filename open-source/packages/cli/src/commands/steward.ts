import { readWorkerSettings, saveWorkerSettings } from '../steward/worker-settings.js'
import { personalModelSummary, savePersonalModel } from '../personal-agent/model-settings.js'
// @arch open-source/docs/cli-runtime.md
// @test src/__tests__/steward-command.test.ts

import fs from 'node:fs'
import { primaryMachineRequest } from '../steward/primary-machine.js'
import { configurePersonalPaths } from '../steward/configure.js'
import { readPersonalPaths } from '../steward/settings.js'
import { getStewardDir, ensureStewardWorkspace } from '../steward/workspace.js'
import type { Command } from 'commander'
import { callDaemonIpc } from '../daemon-ipc/client.js'
import { DaemonIpcError } from '../daemon-ipc/protocol.js'
import { STEWARD_SAY_MAX_CHARS, STEWARD_SESSION_ID_ENV } from '../steward/session.js'

type Io = { write: (text: string) => void; fail: () => void }
export type StewardCommandOptions = {
  callDaemon?: typeof callDaemonIpc
  io?: Io
  env?: NodeJS.ProcessEnv
  readStdin?: () => string
}

const defaultIo: Io = {
  write: (text) => process.stdout.write(text),
  fail: () => { process.exitCode = 1 },
}

export function registerStewardCommand(program: Command, options: StewardCommandOptions = {}): void {
  // Applies to the Client lifecycle, never another command such as worker start.
  // run-service also covers OS autostart, which bypasses the public start command.
  program.hook('preAction', (_command, action) => {
    const clientLifecycle = action.parent === program || action.parent?.name() === 'daemon'
    if (clientLifecycle && ['start', 'restart', 'run-service'].includes(action.name())) ensureStewardWorkspace()
  })
  const io = options.io ?? defaultIo
  const callDaemon = options.callDaemon ?? callDaemonIpc
  const env = options.env ?? process.env
  const readStdin = options.readStdin ?? (() => fs.readFileSync(0, 'utf8'))

  const steward = program.command('steward')
    .description('Talk to the user as the Shennian steward')

  steward.command('primary').description('Read the account primary computer, or explicitly select this paired computer')
    .option('--set-current', 'Select this paired computer as primary; never migrates files')
    .option('--expected-revision <number>', 'Exact current primary-setting revision')
    .option('--confirm', 'Confirm the primary computer selection')
    .action(async (flags: { setCurrent?: boolean; expectedRevision?: string; confirm?: boolean }) => {
      try {
        const revision = Number(flags.expectedRevision)
        if (flags.setCurrent && (!flags.confirm || flags.expectedRevision === undefined || !Number.isSafeInteger(revision) || revision < 0)) throw new Error('personal_primary_confirmation_required')
        const result = await primaryMachineRequest(flags.setCurrent ? { expectedRevision: revision, confirmed: true } : undefined)
        io.write(`${JSON.stringify({ ok: true, ...result })}\n`)
      } catch (error) { io.write(`${JSON.stringify({ ok: false, error: error instanceof Error && /^personal_[a-z_]+$/.test(error.message) ? error.message : 'personal_primary_request_failed' })}\n`); io.fail() }
    })

  steward.command('model').description('Configure the bundled personal Agent model; keys are accepted through stdin only')
    .option('--official', 'Use the official Shennian model (default)')
    .option('--custom', 'Use your own OpenAI-compatible model')
    .option('--model <id>', 'Provider model ID')
    .option('--base-url <url>', 'Provider Base URL')
    .option('--context-window <tokens>', 'Provider context capacity')
    .option('--key-stdin', 'Read API key from stdin; never put a key in process arguments')
    .action((flags: { official?: boolean; custom?: boolean; model?: string; baseUrl?: string; contextWindow?: string; keyStdin?: boolean }) => {
      try {
        if (flags.official && flags.custom) throw new Error()
        const changed = flags.official || flags.custom || flags.model || flags.baseUrl || flags.keyStdin || flags.contextWindow
        const result = changed ? savePersonalModel({ mode: flags.official ? 'official' : 'custom',
          ...(flags.model ? { model: flags.model } : {}), ...(flags.baseUrl ? { baseUrl: flags.baseUrl } : {}),
          ...(flags.keyStdin ? { apiKey: readStdin().trim() } : {}), ...(flags.contextWindow ? { contextWindow: Number(flags.contextWindow) } : {}),
        }) : personalModelSummary()
        io.write(`${JSON.stringify({ ok: true, ...result })}\n`)
      } catch { io.write(`${JSON.stringify({ ok: false, error: 'personal_model_settings_invalid' })}\n`); io.fail() }
    })

  steward.command('worker-defaults').description('Read or set the personal steward default Worker; does not install or sign in to providers')
    .option('--agent <type>', 'Default discovered Worker Agent')
    .option('--model <id>', 'Default model, otherwise use provider default')
    .option('--workdir <path>', 'Fallback start directory; explicit task/project directory wins')
    .option('--clear', 'Reset to builtin Shennian and the default personal directory')
    .action((flags: { agent?: string; model?: string; workdir?: string; clear?: boolean }) => {
      try {
        if ((flags.clear && (flags.agent || flags.model || flags.workdir)) || (flags.model && !flags.agent)) throw new Error()
        const settings = flags.clear ? saveWorkerSettings({ agentType: 'shennian', modelId: null, workDir: null }) : flags.agent || flags.workdir ? saveWorkerSettings({ ...readWorkerSettings(), ...(flags.agent ? { agentType: flags.agent, modelId: flags.model ?? null } : {}), ...(flags.workdir ? { workDir: flags.workdir } : {}) }) : readWorkerSettings()
        io.write(`${JSON.stringify({ ok: true, ...settings })}\n`)
      } catch { io.write(`${JSON.stringify({ ok: false, error: 'personal_worker_settings_invalid' })}\n`); io.fail() }
    })

  steward.command('paths').description('Show Personal Agent and diary directories (no credentials)')
    .action(() => { io.write(`${JSON.stringify({ ok: true, workspace: getStewardDir(), diary: readPersonalPaths().diary ?? null })}\n`) })
  steward.command('configure').description('Set local Personal Agent / diary directories; restart Client after changing workspace')
    .option('--workspace <directory>', 'Absolute Personal Agent directory')
    .option('--diary <directory>', 'Absolute diary directory')
    .option('--clear-diary', 'Disconnect the diary directory without deleting any files')
    .action((flags: { workspace?: string; diary?: string; clearDiary?: boolean }) => {
      try { io.write(`${JSON.stringify({ ok: true, ...configurePersonalPaths(flags), restartRequired: true })}\n`) }
      catch { io.write(`${JSON.stringify({ ok: false, error: 'personal_configuration_failed', message: 'Use absolute, non-symlink directories separate from Client credentials.' })}\n`); io.fail() }
    })

  steward.command('say [text]')
    .description('Send a message the user will see on their phone; in a steward session everything else you output stays hidden from them')
    .option('--file <path>', 'Read the message from a file')
    .option('--stdin', 'Read the message from standard input')
    .action(async (text: string | undefined, flags: { file?: string; stdin?: boolean }) => {
      try {
        // Inside a steward session the environment names it; anywhere else (the user's own AI
        // in a terminal) the daemon files the message under its "来自终端" conversation.
        const sessionId = env[STEWARD_SESSION_ID_ENV]?.trim()
        const message = readMessage(text, flags, readStdin)
        const result = await callDaemon({
          method: 'steward.say',
          params: sessionId ? { sessionId, text: message } : { text: message },
        })
        io.write(`${JSON.stringify({ ok: true, command: 'steward.say', result })}\n`)
      } catch (error) {
        const known = error instanceof DaemonIpcError
        // A missing IPC secret means no daemon has ever run here or it is not running now.
        const daemonDown = !known && (error as NodeJS.ErrnoException)?.code === 'ENOENT'
        io.write(`${JSON.stringify({
          ok: false,
          error: known ? error.code : daemonDown ? 'daemon_unavailable' : 'steward_command_failed',
          message: known ? error.message
            : daemonDown ? 'Shennian is not running on this computer.'
              : 'Shennian steward command failed.',
          nextAction: null,
        })}\n`)
        io.fail()
      }
    })
}

function readMessage(
  text: string | undefined,
  flags: { file?: string; stdin?: boolean },
  readStdin: () => string,
): string {
  const sources = [text !== undefined, flags.file !== undefined, flags.stdin === true].filter(Boolean).length
  if (sources !== 1) {
    throw new DaemonIpcError('steward_say_invalid', 'Provide exactly one of: text, --file, --stdin.')
  }
  let message: string
  if (flags.file !== undefined) {
    try { message = fs.readFileSync(flags.file, 'utf8') } catch {
      throw new DaemonIpcError('steward_say_invalid', 'The message file could not be read.')
    }
  } else if (flags.stdin) {
    try { message = readStdin() } catch {
      throw new DaemonIpcError('steward_say_invalid', 'Standard input could not be read.')
    }
  } else {
    message = text ?? ''
  }
  message = message.trim()
  if (!message || message.length > STEWARD_SAY_MAX_CHARS) {
    throw new DaemonIpcError(
      'steward_say_invalid',
      `Provide a non-empty message of at most ${STEWARD_SAY_MAX_CHARS} characters.`,
    )
  }
  return message
}
