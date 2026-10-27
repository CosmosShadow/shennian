// In production: import { Agent } from '@shennian/agent'
import { Agent } from '../dist/index.js'

const agent = new Agent({
  name: 'Monitor Agent',
  model: 'monitor',
  mode: 'stdio',
  proactive: true,
})

agent.onSend(({ text }) => {
  agent.delta(`Received: ${text}`)
  agent.final()
})

// Proactive notifications every 30 seconds
setInterval(() => {
  const mem = process.memoryUsage()
  const mbUsed = Math.round(mem.heapUsed / 1024 / 1024)
  agent.notify(`Memory usage: ${mbUsed}MB`, 'System Monitor', 'monitor-agent')
}, 30_000)

agent.run()
