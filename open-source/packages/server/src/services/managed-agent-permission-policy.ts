// @arch open-source/docs/server-runtime.md
// @test src/__tests__/agent-workspaces.test.ts
// @test src/__tests__/room-agent-actions.test.ts

import {
  isAvailableAgentType,
  managedAgentExecutionMode,
  resolveManagedAgentPermissionPolicy,
  type ManagedAgentPermissionConfirmation,
  type ManagedAgentPermissionConfirmationRequest,
  type ManagedAgentPermissionPolicy,
  type ManagedAgentRuntimeCapabilityMatrix,
  type ManagedAgentRuntimeProtection,
} from '@shennian/wire'

const EXECUTABLE_FINGERPRINT = /^sha256:[a-f0-9]{64}$/

/** Serialize persisted JSON plus its authoritative relational revision. */
export function resolveStoredManagedAgentPermissionPolicy(record: {
  permissionPolicy?: unknown
  permissionPolicyVersion?: number
}): ManagedAgentPermissionPolicy {
  const version =
    Number.isSafeInteger(record.permissionPolicyVersion) &&
    Number(record.permissionPolicyVersion) > 0
      ? Number(record.permissionPolicyVersion)
      : undefined
  const raw =
    record.permissionPolicy && typeof record.permissionPolicy === 'object'
      ? { ...(record.permissionPolicy as Record<string, unknown>), ...(version ? { version } : {}) }
      : record.permissionPolicy
  const resolved = resolveManagedAgentPermissionPolicy(raw, 'legacy')
  return version ? { ...resolved, version } : resolved
}

export function parseManagedAgentRuntimeProtection(
  value: unknown,
): ManagedAgentRuntimeProtection | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const protection = value as Record<string, unknown>
  if (
    (protection.level !== 'hard' &&
      protection.level !== 'partial' &&
      protection.level !== 'unverified') ||
    typeof protection.runtimeVersion !== 'string' ||
    !protection.runtimeVersion.trim() ||
    typeof protection.platform !== 'string' ||
    !protection.platform.trim() ||
    typeof protection.executableFingerprint !== 'string' ||
    !EXECUTABLE_FINGERPRINT.test(protection.executableFingerprint) ||
    !Array.isArray(protection.unsupportedCapabilities) ||
    !protection.unsupportedCapabilities.every((item) => typeof item === 'string')
  ) {
    return null
  }
  const capabilityMatrix = parseManagedAgentRuntimeCapabilityMatrix(
    protection.capabilityMatrix,
  )
  if (protection.capabilityMatrix !== undefined && !capabilityMatrix) return null
  if (protection.level === 'hard' && !capabilityMatrix) return null
  return {
    level: protection.level,
    runtimeVersion: protection.runtimeVersion,
    platform: protection.platform,
    executableFingerprint: protection.executableFingerprint,
    unsupportedCapabilities: [...protection.unsupportedCapabilities],
    ...(capabilityMatrix ? { capabilityMatrix } : {}),
  }
}

function parseManagedAgentRuntimeCapabilityMatrix(
  value: unknown,
): ManagedAgentRuntimeCapabilityMatrix | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const matrix = value as Record<string, unknown>
  const fileAccess = matrix.fileAccess as Record<string, unknown> | undefined
  const external = matrix.externalCapabilities as Record<string, unknown> | undefined
  if (!fileAccess || !external) return null
  if (
    typeof fileAccess['workspace-read'] !== 'boolean' ||
    typeof fileAccess['workspace-write'] !== 'boolean' ||
    typeof fileAccess['host-full'] !== 'boolean'
  ) {
    return null
  }
  const capabilities = ['commandNetwork', 'webSearch', 'browser', 'computerUse', 'mcp'] as const
  const parsedExternal = {} as ManagedAgentRuntimeCapabilityMatrix['externalCapabilities']
  for (const capability of capabilities) {
    const support = external[capability]
    if (!support || typeof support !== 'object' || Array.isArray(support)) return null
    const direction = support as Record<string, unknown>
    if (typeof direction.allow !== 'boolean' || typeof direction.deny !== 'boolean') return null
    parsedExternal[capability] = { allow: direction.allow, deny: direction.deny }
  }
  return {
    fileAccess: {
      'workspace-read': fileAccess['workspace-read'],
      'workspace-write': fileAccess['workspace-write'],
      'host-full': fileAccess['host-full'],
    },
    externalCapabilities: parsedExternal,
  }
}

export function parseManagedAgentPermissionConfirmationRequest(
  value: unknown,
): ManagedAgentPermissionConfirmationRequest | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const confirmation = value as Record<string, unknown>
  if (
    typeof confirmation.runtimeAdapter !== 'string' ||
    !isAvailableAgentType(confirmation.runtimeAdapter) ||
    typeof confirmation.runtimeVersion !== 'string' ||
    !confirmation.runtimeVersion.trim() ||
    typeof confirmation.platform !== 'string' ||
    !confirmation.platform.trim() ||
    typeof confirmation.executableFingerprint !== 'string' ||
    !EXECUTABLE_FINGERPRINT.test(confirmation.executableFingerprint) ||
    typeof confirmation.hostFullAccess !== 'boolean' ||
    typeof confirmation.limitedProtection !== 'boolean'
  ) {
    return null
  }
  return {
    runtimeAdapter: confirmation.runtimeAdapter,
    runtimeVersion: confirmation.runtimeVersion,
    platform: confirmation.platform,
    executableFingerprint: confirmation.executableFingerprint,
    executionMode: confirmation.executionMode === 'native-full' ? 'native-full' : 'restricted',
    hostFullAccess: confirmation.hostFullAccess,
    limitedProtection: confirmation.limitedProtection,
  }
}

export function parseStoredManagedAgentPermissionConfirmation(
  value: unknown,
): ManagedAgentPermissionConfirmation | null {
  const request = parseManagedAgentPermissionConfirmationRequest(value)
  if (!request || !value || typeof value !== 'object' || Array.isArray(value)) return null
  const confirmation = value as Record<string, unknown>
  if (
    !Number.isSafeInteger(confirmation.policyVersion) ||
    Number(confirmation.policyVersion) < 1 ||
    typeof confirmation.confirmedAt !== 'string' ||
    !Number.isFinite(Date.parse(confirmation.confirmedAt))
  ) {
    return null
  }
  return {
    ...request,
    policyVersion: Number(confirmation.policyVersion),
    confirmedAt: confirmation.confirmedAt,
  }
}

export function managedAgentPermissionConfirmationMatches(input: {
  confirmation: ManagedAgentPermissionConfirmation | null
  policy: ManagedAgentPermissionPolicy
  runtimeAdapter: string
  protection: ManagedAgentRuntimeProtection
}): boolean {
  const { confirmation, policy, runtimeAdapter } = input
  return Boolean(
    confirmation &&
      confirmation.policyVersion === policy.version &&
      confirmation.runtimeAdapter === runtimeAdapter &&
      (confirmation.executionMode ?? 'restricted') === managedAgentExecutionMode(policy) &&
      confirmation.hostFullAccess ===
        (managedAgentExecutionMode(policy) === 'native-full' || policy.fileAccess === 'host-full'),
  )
}
