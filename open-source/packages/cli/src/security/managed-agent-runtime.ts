// @arch open-source/docs/cli-runtime.md
// @test src/__tests__/managed-agent-policy.test.ts

import fs from 'node:fs'
import os from 'node:os'
import type {
  AgentType,
  ManagedAgentEnforcementLevel,
  ManagedAgentExternalCapabilities,
  ManagedAgentFileAccess,
  ManagedAgentPermissionPolicy,
  ManagedAgentRuntimeProtection,
} from '@shennian/wire'

export type ManagedAgentRuntimePlatform = 'darwin' | 'linux' | 'win32' | 'wsl' | 'unsupported'
export type ManagedAgentExternalCapability = keyof ManagedAgentExternalCapabilities

export type ManagedAgentRuntimeSecurityProfile = {
  level: Exclude<ManagedAgentEnforcementLevel, 'unverified'>
  fileAccess: Record<ManagedAgentFileAccess, boolean>
  externalCapabilities: Record<
    ManagedAgentExternalCapability,
    {
      allow: boolean
      deny: boolean
    }
  >
  /** Known gaps that are not directly representable by the product policy. */
  knownGaps?: readonly string[]
}

export type ManagedAgentRuntimeSecurityDeclaration = {
  /** Lowest runtime version covered by this adapter's conformance evidence. */
  minimumRuntimeVersion?: string
  /** First runtime version not covered by this declaration (normally a new major). */
  maximumRuntimeVersionExclusive?: string
  platforms: Partial<Record<ManagedAgentRuntimePlatform, ManagedAgentRuntimeSecurityProfile>>
}

export type ManagedAgentRuntimeResolutionInput = {
  agentType: AgentType
  runtimeVersion?: string
  platform?: NodeJS.Platform
  isWsl?: boolean
  executableFingerprint?: string
  /** Current managed Agent entry points set this to prevent identity-less hard claims. */
  requireExecutableFingerprint?: boolean
  /** Primarily supplied by the Agent adapter that owns the native security mapping. */
  securityDeclaration?: ManagedAgentRuntimeSecurityDeclaration
}

const FILE_ACCESS_CODES: Record<ManagedAgentFileAccess, string> = {
  'workspace-read': 'fileAccess.workspaceRead',
  'workspace-write': 'fileAccess.workspaceWrite',
  'host-full': 'fileAccess.hostFull',
}

const EXTERNAL_CAPABILITY_CODES: Record<ManagedAgentExternalCapability, string> = {
  commandNetwork: 'externalCapabilities.commandNetwork',
  webSearch: 'externalCapabilities.webSearch',
  browser: 'externalCapabilities.browser',
  computerUse: 'externalCapabilities.computerUse',
  mcp: 'externalCapabilities.mcp',
}

export const ALL_MANAGED_AGENT_POLICY_CAPABILITIES = [
  ...Object.values(FILE_ACCESS_CODES),
  ...Object.values(EXTERNAL_CAPABILITY_CODES),
] as const

const declarations = new Map<AgentType, ManagedAgentRuntimeSecurityDeclaration>()

/**
 * Registers evidence-backed native enforcement owned by an Agent adapter.
 * Merely being installed or recognized must never register a declaration.
 */
export function registerManagedAgentRuntimeSecurity(
  agentType: AgentType,
  declaration: ManagedAgentRuntimeSecurityDeclaration,
): void {
  declarations.set(agentType, declaration)
}

export function unregisterManagedAgentRuntimeSecurity(agentType: AgentType): void {
  declarations.delete(agentType)
}

/**
 * Restricted mode must still leave a working Room `send` channel. OpenCode's
 * restricted configuration denies `bash` and disables plugins, so its only
 * channel (`shennian room send`) can never run: the Agent could be added to a
 * Room but never speak. Until a real send-verified channel exists, restricted
 * OpenCode is not offered for Room chat and is rejected at activation.
 */
const RESTRICTED_ROOM_CHAT_UNSUPPORTED: ReadonlySet<AgentType> = new Set<AgentType>(['opencode'])

export function isRestrictedRoomChatUnsupported(agentType: AgentType): boolean {
  return RESTRICTED_ROOM_CHAT_UNSUPPORTED.has(agentType)
}

export function resolveManagedAgentRuntimeProtection(
  input: ManagedAgentRuntimeResolutionInput,
): ManagedAgentRuntimeProtection {
  const runtimeVersion = input.runtimeVersion?.trim() || 'unknown'
  const runtimePlatform = resolveRuntimePlatform(input)
  const declaration = input.securityDeclaration ?? declarations.get(input.agentType)
  const profile = declaration?.platforms[runtimePlatform]

  if (
    !declaration ||
    !profile ||
    runtimeVersion === 'unknown' ||
    (input.requireExecutableFingerprint && !input.executableFingerprint) ||
    (declaration.minimumRuntimeVersion &&
      !versionAtLeast(runtimeVersion, declaration.minimumRuntimeVersion)) ||
    (declaration.maximumRuntimeVersionExclusive &&
      versionAtLeast(runtimeVersion, declaration.maximumRuntimeVersionExclusive))
  ) {
    return {
      level: 'unverified',
      runtimeVersion,
      platform: runtimePlatform,
      ...(input.executableFingerprint
        ? { executableFingerprint: input.executableFingerprint }
        : {}),
      unsupportedCapabilities: [...ALL_MANAGED_AGENT_POLICY_CAPABILITIES],
    }
  }

  return {
    level: profile.level,
    runtimeVersion,
    platform: runtimePlatform,
    ...(input.executableFingerprint ? { executableFingerprint: input.executableFingerprint } : {}),
    unsupportedCapabilities: collectUnsupportedCapabilities(profile),
    capabilityMatrix: {
      fileAccess: { ...profile.fileAccess },
      externalCapabilities: Object.fromEntries(
        Object.entries(profile.externalCapabilities).map(([capability, support]) => [
          capability,
          { ...support },
        ]),
      ) as ManagedAgentRuntimeSecurityProfile['externalCapabilities'],
    },
  }
}

export function resolveManagedAgentSecurityProfile(
  input: ManagedAgentRuntimeResolutionInput,
): ManagedAgentRuntimeSecurityProfile | null {
  const runtimeVersion = input.runtimeVersion?.trim()
  if (!runtimeVersion) return null
  const declaration = input.securityDeclaration ?? declarations.get(input.agentType)
  if (!declaration) return null
  if (
    declaration.minimumRuntimeVersion &&
    !versionAtLeast(runtimeVersion, declaration.minimumRuntimeVersion)
  ) {
    return null
  }
  if (
    declaration.maximumRuntimeVersionExclusive &&
    versionAtLeast(runtimeVersion, declaration.maximumRuntimeVersionExclusive)
  )
    return null
  return declaration.platforms[resolveRuntimePlatform(input)] ?? null
}

export function collectPolicyEnforcementGaps(
  policy: ManagedAgentPermissionPolicy,
  profile: ManagedAgentRuntimeSecurityProfile | null,
): {
  overgrantedCapabilities: string[]
  unavailableCapabilities: string[]
} {
  if (!profile) {
    return {
      overgrantedCapabilities: [...ALL_MANAGED_AGENT_POLICY_CAPABILITIES],
      unavailableCapabilities: [],
    }
  }

  const overgrantedCapabilities = [...(profile.knownGaps ?? [])]
  const unavailableCapabilities: string[] = []

  if (!profile.fileAccess[policy.fileAccess]) {
    if (policy.fileAccess !== 'host-full' && profile.fileAccess['host-full']) {
      overgrantedCapabilities.push(FILE_ACCESS_CODES[policy.fileAccess])
    } else {
      unavailableCapabilities.push(FILE_ACCESS_CODES[policy.fileAccess])
    }
  }

  for (const [capability, requested] of Object.entries(policy.externalCapabilities) as Array<
    [ManagedAgentExternalCapability, boolean]
  >) {
    const support = profile.externalCapabilities[capability]
    if (requested && !support.allow)
      unavailableCapabilities.push(EXTERNAL_CAPABILITY_CODES[capability])
    if (!requested && !support.deny)
      overgrantedCapabilities.push(EXTERNAL_CAPABILITY_CODES[capability])
  }

  return {
    overgrantedCapabilities: unique(overgrantedCapabilities),
    unavailableCapabilities: unique(unavailableCapabilities),
  }
}

function collectUnsupportedCapabilities(profile: ManagedAgentRuntimeSecurityProfile): string[] {
  const unsupported = [...(profile.knownGaps ?? [])]
  for (const [access, supported] of Object.entries(profile.fileAccess) as Array<
    [ManagedAgentFileAccess, boolean]
  >) {
    if (!supported) unsupported.push(FILE_ACCESS_CODES[access])
  }
  for (const [capability, support] of Object.entries(profile.externalCapabilities) as Array<
    [ManagedAgentExternalCapability, { allow: boolean; deny: boolean }]
  >) {
    if (!support.allow || !support.deny) unsupported.push(EXTERNAL_CAPABILITY_CODES[capability])
  }
  return unique(unsupported)
}

function resolveRuntimePlatform(
  input: ManagedAgentRuntimeResolutionInput,
): ManagedAgentRuntimePlatform {
  const platform = input.platform ?? process.platform
  if (platform === 'linux' && (input.isWsl ?? detectWsl())) return 'wsl'
  if (platform === 'darwin' || platform === 'linux' || platform === 'win32') return platform
  return 'unsupported'
}

function detectWsl(): boolean {
  if (process.platform !== 'linux') return false
  if (process.env.WSL_DISTRO_NAME || process.env.WSL_INTEROP) return true
  try {
    return /microsoft|wsl/i.test(`${os.release()} ${fs.readFileSync('/proc/version', 'utf-8')}`)
  } catch {
    return /microsoft|wsl/i.test(os.release())
  }
}

function versionAtLeast(actual: string, minimum: string): boolean {
  const actualParts = parseVersion(actual)
  const minimumParts = parseVersion(minimum)
  if (!actualParts || !minimumParts) return false
  const length = Math.max(actualParts.length, minimumParts.length)
  for (let index = 0; index < length; index += 1) {
    const actualPart = actualParts[index] ?? 0
    const minimumPart = minimumParts[index] ?? 0
    if (actualPart !== minimumPart) return actualPart > minimumPart
  }
  return true
}

function parseVersion(value: string): number[] | null {
  const match = value.trim().match(/(?:^|\s|v)(\d+(?:\.\d+){0,3})(?:[-+\s]|$)/i)
  if (!match?.[1]) return null
  return match[1].split('.').map(Number)
}

function unique(values: readonly string[]): string[] {
  return [...new Set(values)]
}
