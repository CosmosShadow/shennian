// @arch docs/features/published-agent-direct-conversations.md

type Publication = {
  id: string; status: 'draft' | 'active' | 'paused' | 'revoked'
  generation: number; policyVersion: number; publicId?: string
  displayName: string; description: string; dailyMessageLimit: number
  messagesUsedToday: number
  plazaListed: boolean
}
export type OwnedPublication = Publication
export type PublicationReadiness = { machineOnline: boolean; runtimeAdapter: string | null
  executionMode?: 'native-full' | 'restricted'
  runtimeVersion: string | null; runtimePlatform: string | null
  protectionLevel: string; authState: string; runtimeEligible: boolean
  blockers: string[]; activationAvailable: boolean }
export type OwnedConversation = { id: string; visitorName?: string; visitorUserId: string;
  visitorPhoneMasked?: string | null;
  status: string; lastActivityAt: string }
export type OwnedMessage = { id: string; authorRole: 'visitor' | 'agent'; text: string;
  sequence: string; status: string }
export type OwnedConversationPage = { conversations: OwnedConversation[]; nextCursor: string | null;
  summary: { conversationCount: number; pendingCount: number; runningCount: number; failedCount: number } | null }
export type OwnedMessagePage = { messages: OwnedMessage[]; nextBefore: string | null;
  conversation: { id: string; displayName: string; role: 'owner' | 'visitor' } }

type Operation = 'agent.publication.get' | 'agent.publication.readiness' | 'agent.publication.draft' | 'agent.publication.update'
  | 'agent.publication.activate'
  | 'agent.publication.pause' | 'agent.publication.revoke'
  | 'agent.publication.conversations' | 'agent.publication.conversation'
  | 'agent.publication.plaza'
type Result = { ok: true; value: unknown } | { ok: false; error: { code: string; message: string } }
type DesktopWindow = typeof globalThis & { shennianDesktop?: { account?: {
  execute(command: { requestId: string; operation: Operation; input: Record<string, unknown> }): Promise<Result>
} } }

let sequence = 0
async function execute(operation: Operation, input: Record<string, unknown>): Promise<Record<string, unknown>> {
  const account = (globalThis as DesktopWindow).shennianDesktop?.account
  if (!account?.execute) throw new Error('Desktop account bridge unavailable')
  const result = await account.execute({ requestId: `desktop-publication-${Date.now()}-${++sequence}`, operation, input })
  if (!result.ok) throw new Error(result.error.message)
  if (!result.value || typeof result.value !== 'object' || Array.isArray(result.value)) {
    throw new Error('Invalid publication response')
  }
  return result.value as Record<string, unknown>
}

export const desktopPublicationPort = {
  async get(agentId: string) {
    return execute('agent.publication.get', { agentId }) as Promise<{ publication: OwnedPublication | null }>
  },
  async readiness(agentId: string) {
    return execute('agent.publication.readiness', { agentId }) as Promise<{ readiness: PublicationReadiness }>
  },
  async draft(agentId: string, displayName: string, description: string, dailyMessageLimit: number) {
    return execute('agent.publication.draft', { agentId, displayName, description, dailyMessageLimit }) as Promise<{ publication: OwnedPublication }>
  },
  async update(agentId: string, current: OwnedPublication, displayName: string, description: string, dailyMessageLimit: number) {
    return execute('agent.publication.update', { agentId, expectedGeneration: current.generation,
      expectedPolicyVersion: current.policyVersion, displayName, description, dailyMessageLimit }) as Promise<{ publication: OwnedPublication }>
  },
  async pause(agentId: string, current: OwnedPublication) {
    return execute('agent.publication.pause', { agentId, expectedGeneration: current.generation,
      expectedPolicyVersion: current.policyVersion }) as Promise<{ publication: OwnedPublication }>
  },
  async activate(agentId: string, current: OwnedPublication) {
    return execute('agent.publication.activate', { agentId, expectedGeneration: current.generation,
      expectedPolicyVersion: current.policyVersion }) as Promise<{ publication: OwnedPublication }>
  },
  async revoke(agentId: string, current: OwnedPublication) {
    return execute('agent.publication.revoke', { agentId, expectedGeneration: current.generation }) as Promise<{ publication: OwnedPublication }>
  },
  async plaza(agentId: string, current: OwnedPublication, listed: boolean) {
    return execute('agent.publication.plaza', { agentId, listed, expectedGeneration: current.generation,
      expectedPolicyVersion: current.policyVersion }) as Promise<{ listing: { plazaListed: boolean; generation: number; policyVersion: number } }>
  },
  async conversations(agentId: string, cursor?: string) {
    return execute('agent.publication.conversations', { agentId, ...(cursor ? { cursor } : {}) }) as Promise<OwnedConversationPage>
  },
  async conversation(conversationId: string, before?: string) {
    return execute('agent.publication.conversation', { conversationId, ...(before ? { before } : {}) }) as Promise<OwnedMessagePage>
  },
}
