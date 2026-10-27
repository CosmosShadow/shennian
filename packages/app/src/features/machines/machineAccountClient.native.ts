// @arch docs/features/desktop-local-first-client.md#33-进程职责
// @test src/__tests__/machine-account-client-web.test.ts

import type { Machine, MachineGrant, NianProject } from '@shennian/wire'
import * as Crypto from 'expo-crypto'
import { useAuthStore } from '../../config/auth'
import { accountRuntime } from '../account-runtime/accountRuntime'
import { buildLocalSessionDraft } from '../sessions/localSessionDraft'
import { authApi } from '../../config/api'
import type {
  MachineAccountClient,
  MachineAgentCatalogEntry,
  MachineGrantInvite,
  MachineGrantPreview,
} from './machineAccountClient.types'

export const machineAccountClient: MachineAccountClient = {
  async listMachines() {
    return (await authApi<{ machines: Machine[] }>('/machines')).machines
  },
  async claimPair(pairToken) {
    const result = await authApi<{ machine?: { id?: string }; machineId?: string }>('/machines/pair/claim', {
      method: 'POST',
      body: JSON.stringify({ pairToken }),
    })
    return { machineId: result?.machine?.id ?? result?.machineId }
  },
  async updateMachine(machineId, name) {
    await authApi(`/machines/${machineId}`, {
      method: 'PATCH',
      body: JSON.stringify({ name }),
    })
  },
  async removeMachine(machineId) {
    await authApi(`/machines/${machineId}`, { method: 'DELETE' })
  },
  async listGrants(machineId) {
    return (await authApi<{ grants: MachineGrant[] }>(`/machines/${machineId}/grants`)).grants
  },
  async createGrant(machineId, expiresAt) {
    return authApi<MachineGrantInvite>(`/machines/${machineId}/grants`, {
      method: 'POST',
      body: JSON.stringify(expiresAt ? { expiresAt } : {}),
    })
  },
  async revokeGrant(machineId, grantId) {
    await authApi(`/machines/${machineId}/grants/${grantId}`, { method: 'DELETE' })
  },
  async previewGrant(shareToken) {
    return authApi<MachineGrantPreview>(
      `/machines/grants/${encodeURIComponent(shareToken)}/preview`,
    )
  },
  async redeemGrant(shareToken) {
    return (
      await authApi<{ machineId: string }>('/machines/grants/redeem', {
        method: 'POST',
        body: JSON.stringify({ shareToken }),
      })
    ).machineId
  },
  async listAgentCatalog() {
    return (await authApi<{ agents: MachineAgentCatalogEntry[] }>('/public/acp-agents')).agents
  },
  async createProject(machineId, workDir) {
    return (
      await authApi<{ project: NianProject }>('/projects', {
        method: 'POST',
        body: JSON.stringify({ machineId, workDir }),
      })
    ).project
  },
  async createSession(input) {
    const draft = buildLocalSessionDraft(input, useAuthStore.getState().user?.id ?? '', `sess_${Crypto.randomUUID()}`)
    await accountRuntime.persistSession(draft)
    return draft
  },
  async deleteSession(sessionId) {
    await authApi(`/sessions/${sessionId}`, {
      method: 'DELETE',
      body: JSON.stringify({ nativeCleanupPolicy: 'none' }),
    })
  },
}
