// @arch open-source/docs/cli-runtime.md
// @test src/__tests__/support-command.test.ts

import type { Command } from 'commander'
import { SupportClient, SupportClientError } from '../support/support-client.js'
import { parseWaitTimeout, waitForMessages } from '../room/wait-for-messages.js'

type SupportCommandIo = { write: (text: string) => void; fail: () => void }
type SupportCommandOptions = { client?: SupportClient; io?: SupportCommandIo }

const MAX_SUPPORT_TEXT_LENGTH = 2000
const SUSPICIOUS_TEXT_PATTERNS: RegExp[] = [
  /\bBearer\s+\S+/i,
  /\b(sk|pk)-[A-Za-z0-9_-]{8,}\b/,
  /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/,
  /\b[A-Za-z0-9_+/]{40,}={0,2}\b/,
  /\/Users\/\S+/,
  /\/home\/\S+/,
  /\/root\/\S+/,
  /[A-Za-z]:\\\S+/,
  /\.env(\.[a-z]+)?\b/i,
]

const defaultIo: SupportCommandIo = {
  write: (text) => process.stdout.write(text),
  fail: () => {
    process.exitCode = 1
  },
}

export function registerSupportCommand(
  program: Command,
  options: SupportCommandOptions = {},
): void {
  const client = options.client ?? new SupportClient()
  const io = options.io ?? defaultIo
  const support = program
    .command('support')
    .description('Contact Shennian support through the official Room after pairing')

  support
    .command('status')
    .description('Check official support Room membership without joining')
    .action(() => run('support.status', io, () => client.status()))

  support
    .command('ask')
    .description('Send a redacted question and join the official support Room if needed')
    .requiredOption('--text <text>', 'Redacted question; never include secrets, source, or full logs')
    .action((flags: { text: string }) =>
      run('support.ask', io, () => client.ask(normalizeSupportText(flags.text))),
    )

  support
    .command('read')
    .description('Read replies after support contact has joined the official Room')
    .option('--before <sequence>', 'Read messages before this sequence')
    .option('--after <sequence>', 'Read messages after this sequence')
    .option('--limit <count>', 'Maximum messages, 1 to 50', '50')
    .action((flags: { before?: string; after?: string; limit: string }) =>
      run('support.read', io, () => {
        if (flags.before && flags.after) {
          invalid('ambiguous_sequence_cursor', '--before and --after are mutually exclusive.')
        }
        if (flags.before && !isSequence(flags.before))
          invalid('invalid_sequence', '--before sequence is invalid.')
        if (flags.after && !isSequence(flags.after))
          invalid('invalid_sequence', '--after sequence is invalid.')
        const limit = Number(flags.limit)
        if (!Number.isInteger(limit) || limit < 1 || limit > 50)
          invalid('invalid_limit', '--limit must be between 1 and 50.')
        return client.read({ before: flags.before, after: flags.after, limit })
      }),
    )

  support
    .command('wait')
    .description('Wait up to 60 seconds for new messages after an exact sequence')
    .requiredOption('--after <sequence>', 'Sequence returned by support ask or read')
    .option('--timeout <seconds>', 'Wait for 1 to 60 seconds', '60')
    .action((flags: { after: string; timeout: string }) =>
      run('support.wait', io, () => {
        if (!isSequence(flags.after)) invalid('invalid_sequence', '--after sequence is invalid.')
        let timeout: number
        try { timeout = parseWaitTimeout(flags.timeout) }
        catch { invalid('invalid_wait_timeout', '--timeout must be between 1 and 60 seconds.') }
        return waitForMessages(
          after => client.read({ after, limit: 50 }),
          flags.after,
          timeout!,
        )
      }),
    )
}

async function run(
  command: string,
  io: SupportCommandIo,
  operation: () => Promise<unknown>,
): Promise<void> {
  try {
    const result = await operation()
    io.write(`${JSON.stringify({ ok: true, command, result })}\n`)
  } catch (error) {
    if (error instanceof SupportClientError) {
      const nextAction = error.nextAction ?? supportNextAction(error.code)
      io.write(`${JSON.stringify({ ok: false, error: error.code, message: error.message, nextAction })}\n`)
      io.fail()
      return
    }
    io.write(`${JSON.stringify({ ok: false, error: 'support_command_failed', message: 'Shennian support command failed.', nextAction: null })}\n`)
    io.fail()
  }
}

function normalizeSupportText(rawText: string): string {
  const text = rawText.trim()
  if (!text) invalid('support_text_required', 'Support text is required.')
  if (text.length > MAX_SUPPORT_TEXT_LENGTH)
    invalid('support_text_too_long', 'Support text must be at most 2000 characters.')
  if (SUSPICIOUS_TEXT_PATTERNS.some((pattern) => pattern.test(text))) {
    invalid(
      'support_text_contains_sensitive_data',
      'Remove tokens, absolute paths, environment values, source code, and full logs before contacting support.',
      {
        type: 'ask_user',
        message: 'Rewrite the issue as a short redacted summary, then run support ask again.',
      },
    )
  }
  return text
}

function supportNextAction(code: string): Record<string, string> | null {
  if (code === 'support_room_not_joined') {
    return { type: 'run_command', command: 'shennian support ask --text <redacted-question>' }
  }
  if (code === 'support_room_pending_approval' || code === 'official_room_unavailable') {
    return { type: 'retry_later', message: 'The official support Room is temporarily unavailable.' }
  }
  return null
}

function isSequence(value: string): boolean {
  return /^(0|[1-9]\d{0,19})$/.test(value)
}

function invalid(
  code: string,
  message: string,
  nextAction: Record<string, string> | null = null,
): never {
  throw new SupportClientError(code, message, nextAction)
}
