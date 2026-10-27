// @arch open-source/docs/wire.md
// @test src/__tests__/agent-workspace.test.ts

import type { AgentType, ManagerConfig, SessionMode } from './session.ts'
import type { AgentRepairAction, AgentRuntimeAvailability, RoomActivationMode } from './room.ts'

export const MANAGED_AGENT_PERMISSION_POLICY_VERSION = 1

export type ManagedAgentExecutionMode = 'native-full' | 'restricted'

export type ManagedAgentFileAccess = 'workspace-read' | 'workspace-write' | 'host-full'

export type ManagedAgentExternalCapabilities = {
  commandNetwork: boolean
  webSearch: boolean
  browser: boolean
  computerUse: boolean
  mcp: boolean
}

export type ManagedAgentPermissionPolicy = {
  /** Monotonic AgentIdentity policy revision, owned by the server. */
  version: number
  /** Optional on the wire only for clients released before execution modes. */
  executionMode?: ManagedAgentExecutionMode
  fileAccess: ManagedAgentFileAccess
  externalCapabilities: ManagedAgentExternalCapabilities
}

export type ManagedAgentEnforcementLevel = 'hard' | 'partial' | 'unverified'

export type ManagedAgentRuntimeCapabilityMatrix = {
  fileAccess: Record<ManagedAgentFileAccess, boolean>
  externalCapabilities: {
    [Capability in keyof ManagedAgentExternalCapabilities]: {
      allow: boolean
      deny: boolean
    }
  }
}

export type ManagedAgentRuntimeProtection = {
  level: ManagedAgentEnforcementLevel
  runtimeVersion: string
  platform: string
  /** Stable digest of the exact executable selected by the daemon. Absent on older daemons. */
  executableFingerprint?: string
  unsupportedCapabilities: string[]
  /** Directional native capability evidence; absent means the runtime is not trusted. */
  capabilityMatrix?: ManagedAgentRuntimeCapabilityMatrix
}

export type ManagedAgentEnforcement = ManagedAgentRuntimeProtection & {
  effectivePolicy: ManagedAgentPermissionPolicy
}

/** One-time request proving that the user accepted the currently displayed runtime risk. */
export type ManagedAgentPermissionConfirmationRequest = {
  runtimeAdapter: AgentType
  runtimeVersion: string
  platform: string
  executableFingerprint: string
  /** Missing values belong to confirmations created before execution modes. */
  executionMode?: ManagedAgentExecutionMode
  hostFullAccess: boolean
  limitedProtection: boolean
}

/** Server-owned confirmation bound to one policy revision and one exact local runtime. */
export type ManagedAgentPermissionConfirmation =
  ManagedAgentPermissionConfirmationRequest & {
    policyVersion: number
    confirmedAt: string
  }

export const DEFAULT_MANAGED_AGENT_PERMISSION_POLICY: ManagedAgentPermissionPolicy = {
  version: MANAGED_AGENT_PERMISSION_POLICY_VERSION,
  executionMode: 'restricted',
  fileAccess: 'workspace-read',
  externalCapabilities: {
    commandNetwork: false,
    webSearch: false,
    browser: false,
    computerUse: false,
    mcp: false,
  },
}

/** Explicit default sent by current creation surfaces; omission remains restricted. */
export const DEFAULT_NATIVE_FULL_MANAGED_AGENT_PERMISSION_POLICY: ManagedAgentPermissionPolicy = {
  version: MANAGED_AGENT_PERMISSION_POLICY_VERSION,
  executionMode: 'native-full',
  fileAccess: 'host-full',
  externalCapabilities: {
    commandNetwork: true,
    webSearch: true,
    browser: true,
    computerUse: true,
    mcp: true,
  },
}

/** Named alias used where the old-client fallback must be obvious at the call site. */
export const DEFAULT_RESTRICTED_MANAGED_AGENT_PERMISSION_POLICY =
  DEFAULT_MANAGED_AGENT_PERMISSION_POLICY

/**
 * Compatibility projection for payloads created before managed permissions existed.
 * Missing policy data must never be presented as if a restrictive sandbox were active.
 */
export const LEGACY_MANAGED_AGENT_PERMISSION_POLICY: ManagedAgentPermissionPolicy = {
  version: MANAGED_AGENT_PERMISSION_POLICY_VERSION,
  executionMode: 'restricted',
  fileAccess: 'host-full',
  externalCapabilities: {
    commandNetwork: true,
    webSearch: true,
    browser: true,
    computerUse: true,
    mcp: true,
  },
}

/**
 * Project the policy the runtime can actually guarantee. Missing directional
 * evidence is treated as possible host-wide file and external access.
 */
export function resolveManagedAgentEffectivePermissionPolicy(
  requested: ManagedAgentPermissionPolicy,
  protection?: ManagedAgentRuntimeProtection | null,
): ManagedAgentPermissionPolicy {
  const matrix = protection?.capabilityMatrix
  if (!matrix) {
    return {
      version: requested.version,
      executionMode: requested.executionMode ?? 'restricted',
      fileAccess: 'host-full',
      externalCapabilities: {
        commandNetwork: true,
        webSearch: true,
        browser: true,
        computerUse: true,
        mcp: true,
      },
    }
  }

  const fileAccess = matrix.fileAccess[requested.fileAccess]
    ? requested.fileAccess
    : matrix.fileAccess['host-full']
      ? 'host-full'
      : requested.fileAccess
  const externalCapabilities = { ...requested.externalCapabilities }
  for (const capability of Object.keys(externalCapabilities) as Array<
    keyof ManagedAgentExternalCapabilities
  >) {
    if (!externalCapabilities[capability] && !matrix.externalCapabilities[capability].deny) {
      externalCapabilities[capability] = true
    }
  }
  return {
    version: requested.version,
    executionMode: requested.executionMode ?? 'restricted',
    fileAccess,
    externalCapabilities,
  }
}

function copyManagedAgentPermissionPolicy(
  policy: ManagedAgentPermissionPolicy,
): ManagedAgentPermissionPolicy {
  return {
    ...policy,
    externalCapabilities: { ...policy.externalCapabilities },
  }
}

/** Strictly parse an explicit policy. Invalid or incomplete values are not silently repaired. */
export function parseManagedAgentPermissionPolicy(
  value: unknown,
): ManagedAgentPermissionPolicy | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const policy = value as Record<string, unknown>
  if (!Number.isSafeInteger(policy.version) || Number(policy.version) < 1) return null
  if (
    policy.executionMode !== undefined &&
    policy.executionMode !== 'native-full' &&
    policy.executionMode !== 'restricted'
  ) {
    return null
  }
  if (
    policy.fileAccess !== 'workspace-read' &&
    policy.fileAccess !== 'workspace-write' &&
    policy.fileAccess !== 'host-full'
  ) {
    return null
  }
  if (
    !policy.externalCapabilities ||
    typeof policy.externalCapabilities !== 'object' ||
    Array.isArray(policy.externalCapabilities)
  ) {
    return null
  }
  const capabilities = policy.externalCapabilities as Record<string, unknown>
  if (
    typeof capabilities.commandNetwork !== 'boolean' ||
    typeof capabilities.webSearch !== 'boolean' ||
    typeof capabilities.browser !== 'boolean' ||
    typeof capabilities.computerUse !== 'boolean' ||
    typeof capabilities.mcp !== 'boolean'
  ) {
    return null
  }
  return {
    version: Number(policy.version),
    executionMode: policy.executionMode === 'native-full' ? 'native-full' : 'restricted',
    fileAccess: policy.fileAccess,
    externalCapabilities: {
      commandNetwork: capabilities.commandNetwork,
      webSearch: capabilities.webSearch,
      browser: capabilities.browser,
      computerUse: capabilities.computerUse,
      mcp: capabilities.mcp,
    },
  }
}

export function managedAgentExecutionMode(
  policy: ManagedAgentPermissionPolicy,
): ManagedAgentExecutionMode {
  return policy.executionMode === 'native-full' ? 'native-full' : 'restricted'
}

/** Reuse the Room Agent's existing policy-bound Owner approval semantics. */
export function managedAgentConfirmationMatchesPolicy(input: {
  confirmation: unknown
  policy: ManagedAgentPermissionPolicy
  runtimeAdapter: string
}): boolean {
  const value = input.confirmation
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const confirmation = value as Record<string, unknown>
  const mode = managedAgentExecutionMode(input.policy)
  return typeof confirmation.runtimeVersion === 'string'
    && confirmation.runtimeVersion.length > 0
    && typeof confirmation.platform === 'string'
    && confirmation.platform.length > 0
    && typeof confirmation.executableFingerprint === 'string'
    && /^sha256:[a-f0-9]{64}$/.test(confirmation.executableFingerprint)
    && typeof confirmation.limitedProtection === 'boolean'
    && confirmation.policyVersion === input.policy.version
    && confirmation.runtimeAdapter === input.runtimeAdapter
    && (confirmation.executionMode ?? 'restricted') === mode
    && confirmation.hostFullAccess === (mode === 'native-full'
      || input.policy.fileAccess === 'host-full')
    && typeof confirmation.confirmedAt === 'string'
    && Number.isFinite(Date.parse(confirmation.confirmedAt))
}

export function resolveManagedAgentPermissionPolicy(
  value: unknown,
  fallback: 'default' | 'legacy' = 'legacy',
): ManagedAgentPermissionPolicy {
  const parsed = parseManagedAgentPermissionPolicy(value)
  if (parsed) return parsed
  return copyManagedAgentPermissionPolicy(
    fallback === 'default'
      ? DEFAULT_MANAGED_AGENT_PERMISSION_POLICY
      : LEGACY_MANAGED_AGENT_PERMISSION_POLICY,
  )
}

export type AgentWorkspaceRoomLink = {
  bindingId: string
  status: string
  roomId: string
  roomName: string
  activationMode: RoomActivationMode
  /** Optional for compatibility with servers released before machine recovery. */
  availability?: AgentRuntimeAvailability
  repairAction?: AgentRepairAction
}

export type AgentWorkspaceSession = {
  id: string
  title: string
  status: string
  agentType: AgentType
  modelId: string | null
  machineId: string
  machineName: string | null
  workDir: string
  lastActivityAt: string
  room: AgentWorkspaceRoomLink | null
}

export type AgentWorkspace = {
  id: string
  /** Monotonic server-owned revision of the complete managed Agent configuration. */
  configurationVersion?: number
  displayName: string
  description: string
  systemPrompt: string
  avatar: {
    version: string
    smallUrl: string
    mediumUrl: string
    updatedAt: string
  } | null
  status: string
  /** Optional additive field; old cached projections safely treat absence as available. */
  availability?: AgentRuntimeAvailability
  repairAction?: AgentRepairAction
  pinnedAt?: string | null
  machineId: string | null
  machineName: string | null
  runtimeAdapter: AgentType | null
  workDir: string
  modelId: string | null
  sessionMode: SessionMode
  managerConfig: ManagerConfig | null
  /** Optional only for wire/cache compatibility. New servers always return an explicit policy. */
  permissionPolicy?: ManagedAgentPermissionPolicy
  /** Null means this policy/runtime has no persisted high-risk or limited-protection approval. */
  permissionConfirmation?: ManagedAgentPermissionConfirmation | null
  createdAt: string
  updatedAt: string
  sessions: AgentWorkspaceSession[]
}
