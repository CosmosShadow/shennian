// @arch docs/features/agent-local-first-persistence.md#九写操作
// @test ../../__tests__/agent-editor-model.test.ts
import { db } from '../../storage/db.native'
import { agentAccountClient } from './agentAccountClient.native'
import { isAgentAccountNotFound } from './agentAccountClient.types'
import { assertAgentEditorCurrent, type AgentEditorContext, type AgentEditorModel, type CreateAgentInput } from './agentEditorModel.types'

export function createAgentEditorModel(context: AgentEditorContext): AgentEditorModel {
  let active = false
  let revision = 0
  let publishedRevision = 0
  const current = () => active && context.isCurrent()
  const refresh = async () => {
    const request = ++revision
    try {
      const agent = await agentAccountClient.getAgent(context.agentId)
      if (!current() || request !== revision) return
      await db.upsertAgent(context.accountId, agent)
      if (!current() || request !== revision) return
      publishedRevision = request
      context.onAgent(agent)
    } catch (error) {
      if (!current() || request !== revision) return
      if (isAgentAccountNotFound(error)) {
        await db.removeAgent(context.accountId, context.agentId)
        if (current() && request === revision) {
          publishedRevision = request
          context.onAgent(null)
        }
      } else context.onError(error)
    }
  }
  return {
    start() {
      active = true
      const request = revision + 1
      void db.getAgent(context.accountId, context.agentId).then((cached) => {
        if (current() && request === revision && cached && publishedRevision < request) context.onAgent(cached)
      }).catch((error) => { if (current()) context.onError(error) })
      void refresh().catch((error) => { if (current()) context.onError(error) })
      return () => { active = false; revision++ }
    },
    async retry() {
      assertAgentEditorCurrent(current)
      await refresh().catch((error) => { if (current()) context.onError(error) })
    },
    async save(draft) {
      assertAgentEditorCurrent(current)
      revision++
      const agent = await agentAccountClient.updateAgent(context.agentId, draft)
      assertAgentEditorCurrent(current)
      await db.upsertAgent(context.accountId, agent)
      assertAgentEditorCurrent(current)
      context.onAgent(agent)
    },
    async avatarChanged(agent, avatar) {
      assertAgentEditorCurrent(current)
      revision++
      const cached = await db.getAgent(context.accountId, agent.id)
      assertAgentEditorCurrent(current)
      if (!cached) throw new Error('agent_editor_missing_projection')
      const next = { ...cached, avatar }
      await db.upsertAgent(context.accountId, next)
      assertAgentEditorCurrent(current)
      context.onAgent(next)
    },
  }
}

export async function createAgentWithAvatar(input: CreateAgentInput): Promise<string> {
  assertAgentEditorCurrent(input.isCurrent)
  let agent = await agentAccountClient.createAgent(input.draft)
  assertAgentEditorCurrent(input.isCurrent)
  if (input.uploadAvatar) {
    try { agent = { ...agent, avatar: await input.uploadAvatar(agent.id) } }
    catch { if (input.isCurrent()) input.onAvatarError() }
  }
  assertAgentEditorCurrent(input.isCurrent)
  await db.upsertAgent(input.accountId, agent)
  assertAgentEditorCurrent(input.isCurrent)
  return agent.id
}
