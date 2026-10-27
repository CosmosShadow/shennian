import readline from 'node:readline'

const mode = process.argv[2]
const lines = readline.createInterface({ input: process.stdin })
lines.once('line', (line) => {
  const request = JSON.parse(line)
  if (mode === 'stall') return
  if (mode === 'oversize') {
    process.stdout.write('x'.repeat(4 * 1024 * 1024 + 1))
    return
  }
  if (mode === 'invalid-json') {
    process.stdout.write('{not-json}\n')
    setTimeout(() => process.exit(0), 20)
    return
  }
  process.stderr.write('API_KEY=super-secret-value\n')
  process.stdout.write(`${JSON.stringify({
    jsonrpc: '2.0',
    id: request.id,
    result: {
      protocolVersion: mode === 'future-field' ? 1 : 999,
      agentCapabilities: {},
      authMethods: [],
      agentInfo: { name: 'adversarial', version: '1.0.0' },
      unknownFutureField: { ignored: true },
    },
  })}\n`)
})
/* global process, setTimeout */
