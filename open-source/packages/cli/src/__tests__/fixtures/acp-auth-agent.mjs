import fs from 'node:fs'
import { Readable, Writable } from 'node:stream'
import * as acp from '@agentclientprotocol/sdk'

const marker = process.env.ACP_AUTH_MARKER
const authenticated = () => Boolean(marker && fs.existsSync(marker))

const app = acp.agent({ name: 'Shennian ACP auth fixture' })
  .onRequest(acp.methods.agent.initialize, ({ params }) => ({
    protocolVersion: params.protocolVersion,
    agentCapabilities: {},
    authMethods: [{ id: 'fixture-login', name: 'Fixture login' }],
    agentInfo: { name: 'auth-fixture', version: '1.0.0' },
  }))
  .onRequest(acp.methods.agent.authenticate, () => {
    if (!marker) throw new Error('missing fixture marker')
    fs.writeFileSync(marker, 'authenticated')
    return {}
  })
  .onRequest(acp.methods.agent.logout, () => {
    if (marker) try { fs.unlinkSync(marker) } catch {}
    return {}
  })
  .onRequest(acp.methods.agent.session.new, () => {
    if (!authenticated()) throw new acp.RequestError(-32000, 'Authentication required')
    return { sessionId: 'authenticated-session' }
  })
  .onRequest(acp.methods.agent.session.prompt, async ({ params, client }) => {
    await client.notify(acp.methods.client.session.update, {
      sessionId: params.sessionId,
      update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'authenticated' } },
    })
    return { stopReason: 'end_turn' }
  })

app.connect(acp.ndJsonStream(
  Writable.toWeb(process.stdout),
  Readable.toWeb(process.stdin),
))
/* global process */
