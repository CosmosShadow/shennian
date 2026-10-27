// In production: import { Agent } from '@shennian/agent'
import { Agent } from '../dist/index.js'

const agent = new Agent({
  name: 'Echo Agent',
  model: 'echo',
  resume: true,
})

// Restore your own durable state here. In spawn mode the SDK then delivers
// stdin (including Shennian's internal `Continue.` recovery turn) to onSend.
agent.onResume(async ({ agentSessionId }) => {
  if (!agentSessionId) throw new Error('missing session id')
})

agent.onSend(({ text }) => {
  agent.delta(`You said: ${text}`)
  agent.final()
})

agent.run()
