// @arch docs/design/desktop/unified-desktop-control.md
// @test ../../__tests__/desktop-machine-detail.test.ts

import type { AgentInfo } from '@shennian/wire'
import type { DesktopControlStateKey } from '../desktop-control/utils/status'
import type { DaemonStatus, DesktopConnectorSource } from '../desktop-control/types'
import { getAgentStatusKind } from '../machines/utils/acp-agent-presentation'

export function resolveDesktopMachineUpdateOwner(input: {
  machineId: string
  status: DaemonStatus | null
  source: DesktopConnectorSource | null
}): 'desktop' | 'cli' | 'unknown' {
  if (!input.status?.machineId) return 'unknown'
  // Remote machines retain their existing protocol; local provenance must not
  // be applied to a different machine's update controls.
  if (input.machineId !== input.status.machineId) return 'cli'
  const kind =
    input.status.running && !input.status.stale ? input.status.launcher : input.source?.kind
  // Historical managed daemons are unsupported. Never route their upgrade
  // through the Desktop updater or pretend Desktop still owns a current Client.
  if (kind === 'desktop-managed') return 'unknown'
  if (kind === 'global-cli') return 'cli'
  return 'unknown'
}

export type DesktopMachineResourceStatus =
  | 'available'
  | 'installed'
  | 'auth-error'
  | 'auth-required'
  | 'version-mismatch'
  | 'unavailable'
  | 'unknown'

export function resolveDesktopMachineResourceStatus(input: {
  relayConnected: boolean
  machineOnline: boolean
  info?: AgentInfo
}): DesktopMachineResourceStatus {
  if (!input.relayConnected) return 'unknown'
  if (!input.machineOnline) return 'unavailable'
  const status = getAgentStatusKind(true, input.info)
  if (status === 'version_mismatch') return 'version-mismatch'
  if (status === 'auth_required') return 'auth-required'
  if (status === 'auth_error') return 'auth-error'
  return status
}

export type DesktopLocalServicePresentation = {
  status: 'checking' | 'running' | 'stopped' | 'attention'
  canToggle: boolean
  toggle: 'start' | 'stop'
}

export function resolveDesktopLocalServicePresentation(input: {
  state: DesktopControlStateKey
  matchingMachine: boolean
  bridgeAvailable: boolean
  running?: boolean
  actionFailed?: boolean
}): DesktopLocalServicePresentation {
  if (input.state === 'loading' || input.state === 'setup-running') {
    return { status: 'checking', canToggle: false, toggle: 'start' }
  }
  if (!input.bridgeAvailable || !input.matchingMachine) {
    return { status: 'attention', canToggle: false, toggle: 'start' }
  }
  if (
    input.state === 'unavailable' ||
    input.state === 'missing-connector' ||
    input.state === 'unpaired' ||
    input.state === 'incompatible' ||
    input.state === 'unsupported-source'
  ) {
    return { status: 'attention', canToggle: false, toggle: 'start' }
  }
  if (input.state === 'error' || input.actionFailed) {
    return { status: 'attention', canToggle: true, toggle: input.running ? 'stop' : 'start' }
  }
  if (input.state === 'connected' || input.state === 'service-running') {
    return { status: 'running', canToggle: true, toggle: 'stop' }
  }
  if (input.state === 'paused' || input.state === 'stopped') {
    return { status: 'stopped', canToggle: true, toggle: 'start' }
  }
  return { status: 'attention', canToggle: true, toggle: 'start' }
}
