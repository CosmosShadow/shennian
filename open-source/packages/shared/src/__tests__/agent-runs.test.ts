import { describe, it, expect } from 'vitest'
import {
  buildAgentRunEnvelopes,
  hydrateAgentRunFromEnvelopes,
} from '../agent-runs'

describe('agent run helpers', () => {
  it('rehydrates a cached run from stored envelopes', () => {
    const envelopes = buildAgentRunEnvelopes('s1', {
      runId: 'run-1',
      ts: 999,
      segments: [
        { type: 'text', content: 'hello' },
        { type: 'tool', name: 'shell_command', args: { command: 'pwd' }, result: '/tmp' },
      ],
    })

    const run = hydrateAgentRunFromEnvelopes('run-1', envelopes)

    expect(run).toEqual({
      runId: 'run-1',
      ts: 999,
      segments: [
        { type: 'text', content: 'hello', thinking: undefined },
        { type: 'tool', name: 'shell_command', args: { command: 'pwd' }, result: '/tmp' },
      ],
    })
  })
})
