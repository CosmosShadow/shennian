// @arch open-source/docs/cli-runtime.md

import {
  isManagedAgentNativeFull,
  type CompiledManagedAgentPolicy,
} from './managed-agent-policy.js'

/**
 * Product decision (2026-09-26, explicit real-human direction): stop gating
 * public activation on proof of a full OS sandbox for every Adapter. Where
 * host-level isolation exists (Codex `hard`), it still applies and still
 * gives the stronger guarantee. Where it does not — most Adapters only ever
 * offer tool-layer restricted mode — a public turn now gets exactly the same
 * bar Room chat already runs those Adapters at today, using the Adapter's
 * restricted-mode tool config where available. Prompt instructions are an
 * additional behavioral request, not a file-system or network boundary.
 *
 * A public turn inherits the Owner's persisted Agent policy; host-full mode
 * is possible only after the compiler receives the Owner's policy-bound
 * confirmation. Even in native-full mode, the public turn must not receive
 * the Owner's Shennian Room tool bridge or machine token.
 */
export function assertPublicAgentPolicy(policy: CompiledManagedAgentPolicy | null | undefined): void {
  if (!policy
    || !policy.enforcement.executableFingerprint
    || policy.adapterPolicy.fileAccess !== policy.requestedPolicy.fileAccess
    || Object.entries(policy.requestedPolicy.externalCapabilities).some(([name, enabled]) =>
      policy.adapterPolicy.externalCapabilities[
        name as keyof typeof policy.requestedPolicy.externalCapabilities] !== enabled)
    || !policy.adapterPolicy.denySensitiveFiles
    || !policy.adapterPolicy.failClosed
    || policy.environmentPolicy.inheritDaemonEnv
    || policy.environmentPolicy.loadLoginShell) {
    throw new Error('public_agent_policy_unavailable')
  }
  if (isManagedAgentNativeFull(policy)) return
  if (policy.enforcement.level === 'unverified'
    || policy.enforcement.effectivePolicy.fileAccess !== policy.requestedPolicy.fileAccess
    || Object.entries(policy.requestedPolicy.externalCapabilities).some(([name, enabled]) =>
      policy.enforcement.effectivePolicy.externalCapabilities[
        name as keyof typeof policy.requestedPolicy.externalCapabilities] !== enabled)
    || policy.enforcement.unsupportedCapabilities.some((capability) =>
      capability === ({ 'workspace-read': 'fileAccess.workspaceRead',
        'workspace-write': 'fileAccess.workspaceWrite',
        'host-full': 'fileAccess.hostFull' } as const)[policy.requestedPolicy.fileAccess]
      || Object.entries(policy.requestedPolicy.externalCapabilities).some(([name, enabled]) =>
        enabled && capability === `externalCapabilities.${name}`))) {
    throw new Error('public_agent_policy_unavailable')
  }
}
