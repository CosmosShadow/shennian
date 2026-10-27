// @arch open-source/docs/server-runtime.md

import { parseManagedAgentRuntimeProtection } from './managed-agent-permission-policy.js'
import { managedAgentConfirmationMatchesPolicy, managedAgentExecutionMode,
  parseManagedAgentPermissionPolicy } from '@shennian/wire'

/** One authoritative interpretation of the paired daemon's public runtime report. */
export function assessPublicAgentRuntime(agents: unknown, runtimeAdapter: string | null,
  policyRaw: unknown, confirmation: unknown) {
  const matches = Array.isArray(agents) && runtimeAdapter
    ? agents.filter((item) => item && typeof item === 'object'
      && !Array.isArray(item) && (item as Record<string, unknown>).type === runtimeAdapter)
    : []
  const info = matches.length === 1 ? matches[0] as Record<string, unknown> : null
  const protection = parseManagedAgentRuntimeProtection(info?.managedAgentProtection)
  const capabilities = protection?.capabilityMatrix
  const policy = parseManagedAgentPermissionPolicy(policyRaw)
  const executionMode = policy ? managedAgentExecutionMode(policy) : null
  const modes = info?.supportedAgentExecutionModes
  const modeAvailable = executionMode === 'native-full'
    ? Array.isArray(modes) && modes.includes('native-full')
    : Array.isArray(modes) ? modes.includes('restricted') : info?.supportsManagedAgent === true
  const blockers: string[] = []
  if (!info || !modeAvailable) blockers.push('runtime_unavailable')
  // Most third-party adapters (including Pi) cannot report a sign-in probe.
  // `unknown` is not evidence of a failed sign-in: the Client's real hello
  // check and the first visitor turn establish actual model availability.
  // Keep explicit authentication failures closed.
  if (info?.authState === 'required' || info?.authState === 'error') {
    blockers.push('runtime_auth_unverified')
  }
  if (!policy || !protection?.executableFingerprint) {
    blockers.push('runtime_protection_unverified')
  } else if (executionMode === 'native-full') {
    if (!managedAgentConfirmationMatchesPolicy({ confirmation, policy,
      runtimeAdapter: runtimeAdapter! })) {
      blockers.push('runtime_permission_unconfirmed')
    }
  } else {
    // Use the same supported saved permission policy as Room execution;
    // a public entry does not impose a second Codex hard-only requirement.
    if (policy.fileAccess === 'host-full' && !managedAgentConfirmationMatchesPolicy({
      confirmation, policy, runtimeAdapter: runtimeAdapter!,
    })) blockers.push('runtime_permission_unconfirmed')
    if (protection.level === 'unverified') blockers.push('runtime_protection_unverified')
    const permitted = capabilities?.fileAccess[policy.fileAccess] === true
      && Object.entries(policy.externalCapabilities).every(([name, enabled]) =>
        capabilities.externalCapabilities[name as keyof typeof policy.externalCapabilities][
          enabled ? 'allow' : 'deny'] === true)
    if (!permitted) blockers.push('runtime_capability_gap')
  }
  return {
    runtimeVersion: protection?.runtimeVersion ?? null,
    runtimePlatform: protection?.platform ?? null,
    protectionLevel: protection?.level ?? 'unverified',
    authState: typeof info?.authState === 'string' ? info.authState : 'unknown',
    executableFingerprint: blockers.length === 0
      ? protection!.executableFingerprint ?? null : null,
    blockers,
  }
}
