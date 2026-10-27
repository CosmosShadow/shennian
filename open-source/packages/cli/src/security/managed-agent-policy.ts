// @arch open-source/docs/cli-runtime.md
// @test src/__tests__/managed-agent-policy.test.ts

import fs from 'node:fs/promises'
import path from 'node:path'
import {
  managedAgentExecutionMode,
  parseManagedAgentPermissionPolicy,
  resolveManagedAgentEffectivePermissionPolicy,
  type ManagedAgentEnforcement,
  type ManagedAgentExternalCapabilities,
  type ManagedAgentPermissionPolicy,
} from '@shennian/wire'
import {
  getManagedAgentBaseEnvKeys,
  getManagedAgentProviderEnvKeys,
  getManagedAgentSessionEnvKeys,
} from '../agent-env.js'
import {
  collectPolicyEnforcementGaps,
  isRestrictedRoomChatUnsupported,
  resolveManagedAgentRuntimeProtection,
  resolveManagedAgentSecurityProfile,
  type ManagedAgentRuntimeResolutionInput,
} from './managed-agent-runtime.js'
import { resolveProtectedShennianDirectories } from './managed-agent-credential-paths.js'

export type ManagedAgentAdapterPolicy = {
  version: number
  workDir: string
  fileAccess: ManagedAgentPermissionPolicy['fileAccess']
  externalCapabilities: ManagedAgentExternalCapabilities
  denySensitiveFiles: true
  failClosed: true
}

export type CompiledManagedAgentPolicy = {
  /** Missing only on persisted/test snapshots created before execution modes. */
  executionMode?: 'native-full' | 'restricted'
  requestedPolicy: ManagedAgentPermissionPolicy
  enforcement: ManagedAgentEnforcement
  adapterPolicy: ManagedAgentAdapterPolicy
  environmentPolicy: {
    inheritDaemonEnv: false
    loadLoginShell: false
    providerEnvKeys: readonly string[]
    sessionEnvKeys: readonly string[]
    shellSubprocess: {
      inherit: 'none'
      allowedEnvKeys: readonly string[]
      deniedEnvKeys: readonly string[]
    }
  }
}

export function isManagedAgentNativeFull(
  policy: CompiledManagedAgentPolicy | null | undefined,
): boolean {
  return Boolean(
    policy &&
      (policy.executionMode === 'native-full' ||
        policy.requestedPolicy.executionMode === 'native-full'),
  )
}

/**
 * Native adapters must always attempt the user's requested restriction. The
 * effective policy is an honest projection for display and confirmation; it
 * must never be fed back into an adapter because doing so would turn a known
 * enforcement gap into an intentional permission expansion.
 */
export function resolveManagedAgentAdapterEnforcement(
  compiled: CompiledManagedAgentPolicy,
): ManagedAgentEnforcement {
  return {
    ...compiled.enforcement,
    effectivePolicy: {
      version: compiled.adapterPolicy.version,
      executionMode: compiled.executionMode ?? 'restricted',
      fileAccess: compiled.adapterPolicy.fileAccess,
      externalCapabilities: { ...compiled.adapterPolicy.externalCapabilities },
    },
  }
}

export type ManagedAgentPolicyCompileErrorCode =
  | 'managed_agent_policy_invalid'
  | 'managed_agent_workdir_invalid'
  | 'managed_agent_workdir_unavailable'
  | 'managed_agent_host_full_confirmation_required'
  | 'managed_agent_limited_protection_confirmation_required'
  | 'managed_agent_capability_unavailable'
  | 'managed_agent_restricted_room_unsupported'

export type ManagedAgentPolicyCompileResult =
  | { ok: true; value: CompiledManagedAgentPolicy }
  | {
      ok: false
      errorCode: ManagedAgentPolicyCompileErrorCode
      unsupportedCapabilities?: string[]
    }

export type ManagedAgentPolicyCompileInput = ManagedAgentRuntimeResolutionInput & {
  policy: unknown
  workDir: string
  /** Public visitor replies are collected by the host, without Room send tools. */
  channel?: 'room' | 'public'
  hostFullAccessConfirmed?: boolean
  limitedProtectionConfirmed?: boolean
  resolveWorkDir?: (workDir: string) => Promise<string>
}

/**
 * Turns untrusted policy input into one immutable per-turn runtime snapshot.
 * Invalid input and unconfirmed host-wide access fail. Native enforcement gaps
 * remain explicit in the immutable snapshot so the prompt can preserve the
 * user's authorization ceiling while each adapter applies what it supports.
 */
export async function compileManagedAgentPolicy(
  input: ManagedAgentPolicyCompileInput,
): Promise<ManagedAgentPolicyCompileResult> {
  const requestedPolicy = parseManagedAgentPermissionPolicy(input.policy)
  if (!requestedPolicy) return { ok: false, errorCode: 'managed_agent_policy_invalid' }
  const executionMode = managedAgentExecutionMode(requestedPolicy)

  if (
    (executionMode === 'native-full' || requestedPolicy.fileAccess === 'host-full') &&
    !input.hostFullAccessConfirmed
  ) {
    return { ok: false, errorCode: 'managed_agent_host_full_confirmation_required' }
  }

  if (executionMode === 'restricted' && input.channel !== 'public'
    && isRestrictedRoomChatUnsupported(input.agentType)) {
    return { ok: false, errorCode: 'managed_agent_restricted_room_unsupported' }
  }

  const workDirResult = await validateManagedAgentWorkDir(input.workDir, input.resolveWorkDir)
  if (!workDirResult.ok) return workDirResult

  const runtimeInput = runtimeResolutionInput(input)
  const protection = resolveManagedAgentRuntimeProtection(runtimeInput)
  const profile = resolveManagedAgentSecurityProfile(runtimeInput)
  const gaps = executionMode === 'restricted'
    ? collectPolicyEnforcementGaps(requestedPolicy, profile)
    : { unavailableCapabilities: [], overgrantedCapabilities: [] }

  const unsupportedCapabilities = unique([
    ...(executionMode === 'restricted' && protection.level !== 'hard'
      ? ['runtime.hardIsolation']
      : []),
    // Public turns need proof for the exact deny-by-default request. A runtime
    // that can deny computer use but cannot enable it still satisfies a public
    // policy that explicitly denies computer use. The requested-policy gaps
    // below retain every actual overgrant or unavailable requested feature.
    ...(executionMode === 'restricted' && input.channel !== 'public'
      ? protection.unsupportedCapabilities : []),
    ...gaps.unavailableCapabilities,
    ...gaps.overgrantedCapabilities,
  ])
  const effectivePolicy = resolveManagedAgentEffectivePermissionPolicy(requestedPolicy, protection)
  const enforcement: ManagedAgentEnforcement = {
    level: protection.level,
    effectivePolicy,
    unsupportedCapabilities,
    runtimeVersion: protection.runtimeVersion,
    platform: protection.platform,
    ...(protection.executableFingerprint
      ? { executableFingerprint: protection.executableFingerprint }
      : {}),
  }

  return {
    ok: true,
    value: {
      requestedPolicy: copyPolicy(requestedPolicy),
      executionMode,
      enforcement,
      adapterPolicy: {
        version: requestedPolicy.version,
        workDir: workDirResult.workDir,
        fileAccess: requestedPolicy.fileAccess,
        externalCapabilities: { ...requestedPolicy.externalCapabilities },
        denySensitiveFiles: true,
        failClosed: true,
      },
      environmentPolicy: {
        inheritDaemonEnv: false,
        loadLoginShell: false,
        providerEnvKeys: [...getManagedAgentProviderEnvKeys(input.agentType)],
        sessionEnvKeys: [...getManagedAgentSessionEnvKeys(input.agentType)],
        shellSubprocess: {
          inherit: 'none',
          allowedEnvKeys: unique([
            ...getManagedAgentBaseEnvKeys(input.platform),
            ...getManagedAgentSessionEnvKeys(input.agentType),
          ]),
          deniedEnvKeys: [...getManagedAgentProviderEnvKeys(input.agentType)],
        },
      },
    },
  }
}

function runtimeResolutionInput(
  input: ManagedAgentPolicyCompileInput,
): ManagedAgentRuntimeResolutionInput {
  return {
    agentType: input.agentType,
    runtimeVersion: input.runtimeVersion,
    platform: input.platform,
    isWsl: input.isWsl,
    executableFingerprint: input.executableFingerprint,
    requireExecutableFingerprint: input.requireExecutableFingerprint,
    securityDeclaration: input.securityDeclaration,
  }
}

export async function validateManagedAgentWorkDir(
  rawWorkDir: string,
  resolver: ManagedAgentPolicyCompileInput['resolveWorkDir'],
): Promise<
  | { ok: true; workDir: string }
  | { ok: false; errorCode: 'managed_agent_workdir_invalid' | 'managed_agent_workdir_unavailable' }
> {
  const workDir = rawWorkDir.trim()
  if (!workDir || !path.isAbsolute(workDir)) {
    return { ok: false, errorCode: 'managed_agent_workdir_invalid' }
  }

  try {
    const resolved = await (resolver ?? defaultResolveWorkDir)(workDir)
    if (!resolved || !path.isAbsolute(resolved)) {
      return { ok: false, errorCode: 'managed_agent_workdir_invalid' }
    }
    const normalized = path.normalize(resolved)
    if (await overlapsProtectedCredentialRoot(normalized)) {
      return { ok: false, errorCode: 'managed_agent_workdir_invalid' }
    }
    return { ok: true, workDir: normalized }
  } catch {
    return { ok: false, errorCode: 'managed_agent_workdir_unavailable' }
  }
}

async function defaultResolveWorkDir(workDir: string): Promise<string> {
  const resolved = await fs.realpath(workDir)
  const stat = await fs.stat(resolved)
  if (!stat.isDirectory()) throw new Error('managed_agent_workdir_not_directory')
  return resolved
}

async function overlapsProtectedCredentialRoot(
  workDir: string,
): Promise<boolean> {
  const roots = resolveProtectedShennianDirectories()
  return roots.some((root) => pathsOverlap(workDir, root, process.platform))
}

function pathsOverlap(first: string, second: string, platform: NodeJS.Platform): boolean {
  const normalize = (value: string) => {
    const resolved = path.resolve(value)
    return platform === 'win32' ? resolved.toLowerCase() : resolved
  }
  const left = normalize(first)
  const right = normalize(second)
  return containsPath(left, right) || containsPath(right, left)
}

function containsPath(parent: string, candidate: string): boolean {
  const relative = path.relative(parent, candidate)
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative))
}

function copyPolicy(policy: ManagedAgentPermissionPolicy): ManagedAgentPermissionPolicy {
  return {
    ...policy,
    externalCapabilities: { ...policy.externalCapabilities },
  }
}

function unique(values: readonly string[]): string[] {
  return [...new Set(values)]
}
