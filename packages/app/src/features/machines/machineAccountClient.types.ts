// @arch docs/features/desktop-local-first-client.md#33-进程职责
// @test src/__tests__/machine-account-client-web.test.ts

import type {
  AgentType,
  Machine,
  MachineGrant,
  NianProject,
  NianSession,
  SessionMode,
} from '@shennian/wire'

export type MachineAgentCatalogEntry = {
  id: string
  name: string
  website?: string
  platforms?: string[]
}

export type MachineSessionCreateInput = {
  title?: string
  machineId: string
  agentType: AgentType
  workDir: string
  sessionMode: SessionMode
  /** Steward drafts are created lazily like any session; the daemon pins their directory. */
  sessionScope?: 'steward'
  modelId?: string
  managerConfig?: {
    defaultWorkerAgentType?: AgentType | null
    defaultWorkerModelId?: string | null
  }
  managerDefaultWorkerAgentType?: AgentType | null
  managerDefaultWorkerModelId?: string | null
}

export type MachineGrantInvite = {
  grantId: string
  inviteUrl: string
  expiresAt: string | null
}

export type MachineGrantPreview = {
  machineName: string
  ownerName: string
  expiresAt: string | null
}

export type MachineAccountClient = {
  listMachines(): Promise<Machine[]>
  claimPair(pairToken: string): Promise<{ machineId?: string } | void>
  updateMachine(machineId: string, name: string): Promise<void>
  removeMachine(machineId: string): Promise<void>
  listGrants(machineId: string): Promise<MachineGrant[]>
  createGrant(machineId: string, expiresAt?: string): Promise<MachineGrantInvite>
  revokeGrant(machineId: string, grantId: string): Promise<void>
  previewGrant(shareToken: string): Promise<MachineGrantPreview>
  redeemGrant(shareToken: string): Promise<string>
  listAgentCatalog(): Promise<MachineAgentCatalogEntry[]>
  createProject(machineId: string, workDir: string): Promise<NianProject>
  createSession(input: MachineSessionCreateInput): Promise<NianSession>
  deleteSession(sessionId: string): Promise<void>
}

export function isMachineAccountUnauthorized(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false
  const candidate = error as { code?: unknown; status?: unknown }
  return candidate.code === 'AUTH_REQUIRED' || candidate.status === 401
}
