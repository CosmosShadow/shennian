// @arch open-source/docs/cli-runtime.md
// @test src/__tests__/personal-sync-account-namespace.test.ts
// @test src/__tests__/machine-authority-transport.test.ts

import { setTimeout as delay } from 'node:timers/promises'
import { SESSION_SYNC_DATA_EPOCH } from '@shennian/wire'
import { loadConfig, saveConfig } from '../config/index.js'
import { getDaemonInstallationId } from './identity.js'

export type MachinePersonalAuthority = {
  machineId: string
  daemonInstallationId: string
  dataEpoch: number
}

export async function synchronizeMachinePersonalAuthority(input: {
  serverUrl: string
  machineToken: string
  machineId?: string | null
  fetchImpl?: typeof fetch
}): Promise<MachinePersonalAuthority> {
  const response = await fetchMachineAuthorityResponse(
    `${input.serverUrl.replace(/\/+$/, '')}/api/machines/identity`,
    input.machineToken,
    input.fetchImpl,
  )
  if (!response.ok) throw new Error(`machine_personal_authority_unavailable:${response.status}`)
  const body = await response.json() as {
    machineId?: unknown
    daemonInstallationId?: unknown
    dataEpoch?: unknown
  }
  if (
    typeof body.machineId !== 'string' || !body.machineId
    || typeof body.daemonInstallationId !== 'string' || !body.daemonInstallationId
    || typeof body.dataEpoch !== 'number' || !Number.isSafeInteger(body.dataEpoch)
  ) throw new Error('machine_personal_authority_invalid_response')
  if (input.machineId && body.machineId !== input.machineId) {
    throw new Error('machine_personal_authority_machine_mismatch')
  }
  if (body.daemonInstallationId !== getDaemonInstallationId()) {
    throw new Error('machine_personal_authority_daemon_mismatch')
  }
  if (body.dataEpoch !== SESSION_SYNC_DATA_EPOCH) {
    throw new Error('machine_personal_authority_epoch_mismatch')
  }

  const config = loadConfig()
  if (config.machineId !== body.machineId) {
    // accountNamespaceId is deliberately left untouched as legacy pairing
    // metadata. It never selects, clears, or authorizes personal storage.
    saveConfig({ ...config, machineId: body.machineId })
  }
  return body as MachinePersonalAuthority
}

// Only retry transport resets on this idempotent GET. All attempts share the
// original startup deadline; HTTP/auth/schema/identity failures stay fail-closed.
export async function fetchMachineAuthorityResponse(
  url: string,
  machineToken: string,
  request: typeof fetch = fetch,
): Promise<Response> {
  const signal = AbortSignal.timeout(10_000)
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await request(url, {
        headers: { Authorization: `Bearer ${machineToken}` }, signal,
      })
    } catch (error) {
      const failure = error as { cause?: { code?: string }; code?: string } | null
      const code = failure?.cause?.code ?? failure?.code
      if (signal.aborted || attempt >= 2 ||
          !['ECONNRESET', 'EPIPE', 'UND_ERR_SOCKET'].includes(code ?? '')) throw error
      await delay(250 * (attempt + 1), undefined, { signal })
    }
  }
}
