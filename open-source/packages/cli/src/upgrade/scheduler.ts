// @arch open-source/docs/cli-runtime.md
// @test open-source/packages/cli/src/__tests__/upgrade-scheduler.test.ts

import type { RuntimeAutoUpgradePolicy } from '../config/index.js'
import {
  checkForUpdate,
  isUpgradeVersionInCooldown,
  type VersionCheckResult,
} from './engine.js'

export type UpgradeIdleState = {
  idle: boolean
  reasons: string[]
}

export type CliReleasePolicy = {
  automaticPatchEnabled: boolean
  rolloutPercentage: number
  pausedVersions: string[]
  blockedVersions: string[]
  blockedCurrentVersions: string[]
  killSwitch: boolean
  releaseLevel: 'normal' | 'required' | 'blocked'
  /** Legacy wire field; normal updates now wait for idle without a deadline. */
  maxIdleWaitMs: number
  minimumSessionSyncProtocolVersion?: number
  minimumDataEpoch?: number
  requiredCapabilities: string[]
  externalUpdaterEnabled: boolean
  minimumUpdaterProtocolVersion?: number
}

type AutoUpgradeSchedulerDeps = {
  currentVersion: string
  machineId: string
  serverUrl: string
  getIdleState: () => UpgradeIdleState
  startUpgrade: (targetVersion: string, mandatory?: boolean) => Promise<void>
  checkForUpdate?: (currentVersion?: string) => Promise<VersionCheckResult>
  fetchReleasePolicy?: () => Promise<CliReleasePolicy>
  inCooldown?: (version: string) => boolean
  initialDelayMs?: number
  intervalMs?: number
  setTimeout?: (handler: () => void, delayMs: number) => ReturnType<typeof setTimeout>
  clearTimeout?: (timer: ReturnType<typeof setTimeout>) => void
  random?: () => number
  sessionSyncProtocolVersion?: number
  dataEpoch?: number
  advertisedCapabilities?: readonly string[]
  updaterProtocolVersion?: number
}

const DEFAULT_RELEASE_POLICY: CliReleasePolicy = {
  automaticPatchEnabled: false,
  rolloutPercentage: 0,
  pausedVersions: [],
  blockedVersions: [],
  blockedCurrentVersions: [],
  killSwitch: true,
  releaseLevel: 'normal',
  maxIdleWaitMs: 30 * 60_000,
  requiredCapabilities: [],
  externalUpdaterEnabled: false,
}

export function deterministicRolloutBucket(machineId: string): number {
  let hash = 2166136261
  for (let i = 0; i < machineId.length; i++) {
    hash ^= machineId.charCodeAt(i)
    hash = Math.imul(hash, 16777619)
  }
  return (hash >>> 0) % 100
}

export function isAutomaticPatchAllowed(
  policy: CliReleasePolicy,
  machineId: string,
  currentVersion: string,
  targetVersion: string,
): boolean {
  if (policy.killSwitch || !policy.automaticPatchEnabled) return false
  if (policy.blockedVersions.includes(targetVersion)) return false
  if (policy.pausedVersions.includes(targetVersion) || policy.pausedVersions.includes(currentVersion)) return false
  const rollout = Math.max(0, Math.min(100, Math.floor(policy.rolloutPercentage)))
  return deterministicRolloutBucket(machineId) < rollout
}

export async function fetchCliReleasePolicy(serverUrl: string): Promise<CliReleasePolicy> {
  const url = new URL('/api/releases/cli-policy', serverUrl)
  const response = await fetch(url, {
    headers: { Accept: 'application/json' },
    signal: AbortSignal.timeout(10_000),
  })
  if (!response.ok) throw new Error(`release policy returned ${response.status}`)
  const raw = await response.json() as Partial<CliReleasePolicy>
  return {
    automaticPatchEnabled: raw.automaticPatchEnabled === true,
    rolloutPercentage: typeof raw.rolloutPercentage === 'number' ? raw.rolloutPercentage : 0,
    pausedVersions: Array.isArray(raw.pausedVersions) ? raw.pausedVersions.filter((v): v is string => typeof v === 'string') : [],
    blockedVersions: Array.isArray(raw.blockedVersions) ? raw.blockedVersions.filter((v): v is string => typeof v === 'string') : [],
    blockedCurrentVersions: Array.isArray(raw.blockedCurrentVersions) ? raw.blockedCurrentVersions.filter((v): v is string => typeof v === 'string') : [],
    killSwitch: raw.killSwitch !== false,
    releaseLevel: raw.releaseLevel === 'required' || raw.releaseLevel === 'blocked'
      ? raw.releaseLevel
      : 'normal',
    maxIdleWaitMs: typeof raw.maxIdleWaitMs === 'number' && Number.isFinite(raw.maxIdleWaitMs)
      ? Math.max(0, Math.min(24 * 60 * 60_000, Math.floor(raw.maxIdleWaitMs)))
      : 30 * 60_000,
    ...(typeof raw.minimumSessionSyncProtocolVersion === 'number'
      ? { minimumSessionSyncProtocolVersion: raw.minimumSessionSyncProtocolVersion }
      : {}),
    ...(typeof raw.minimumDataEpoch === 'number' ? { minimumDataEpoch: raw.minimumDataEpoch } : {}),
    requiredCapabilities: Array.isArray(raw.requiredCapabilities)
      ? raw.requiredCapabilities.filter((v): v is string => typeof v === 'string')
      : [],
    externalUpdaterEnabled: raw.externalUpdaterEnabled === true,
    ...(typeof raw.minimumUpdaterProtocolVersion === 'number'
      ? { minimumUpdaterProtocolVersion: raw.minimumUpdaterProtocolVersion }
      : {}),
  }
}

export class AutoUpgradeScheduler {
  private policy: RuntimeAutoUpgradePolicy = 'none'
  private timer: ReturnType<typeof setTimeout> | null = null
  private started = false
  private upgradeInFlight = false

  constructor(private deps: AutoUpgradeSchedulerDeps) {}

  start(): void {
    if (this.started) return
    this.started = true
    this.arm(this.deps.initialDelayMs ?? 30_000)
  }

  stop(): void {
    this.started = false
    if (this.timer) (this.deps.clearTimeout ?? clearTimeout)(this.timer)
    this.timer = null
  }

  setPolicy(policy: RuntimeAutoUpgradePolicy): void {
    this.policy = policy
    if (!this.started) return
    if (!this.timer) this.arm(0)
  }

  getPolicy(): RuntimeAutoUpgradePolicy {
    return this.policy
  }

  async runOnce(): Promise<void> {
    if (this.upgradeInFlight) return

    const update = await (this.deps.checkForUpdate ?? checkForUpdate)(this.deps.currentVersion)
    if (!update.hasUpdate) return
    if ((this.deps.inCooldown ?? isUpgradeVersionInCooldown)(update.latest)) return

    let releasePolicy = DEFAULT_RELEASE_POLICY
    try {
      releasePolicy = await (this.deps.fetchReleasePolicy ?? (() => fetchCliReleasePolicy(this.deps.serverUrl)))()
    } catch {
      return // fail closed: a missing control-plane policy never permits an automatic install
    }
    if (releasePolicy.killSwitch) return
    if (!releasePolicy.externalUpdaterEnabled) return
    if (
      releasePolicy.blockedVersions.includes(update.latest) ||
      releasePolicy.pausedVersions.includes(update.latest) ||
      releasePolicy.pausedVersions.includes(update.current)
    ) return
    const level = releasePolicy.blockedCurrentVersions.includes(update.current)
      ? 'blocked'
      : releasePolicy.releaseLevel
    const incompatible =
      (releasePolicy.minimumSessionSyncProtocolVersion !== undefined &&
        (this.deps.sessionSyncProtocolVersion ?? 0) < releasePolicy.minimumSessionSyncProtocolVersion) ||
      (releasePolicy.minimumDataEpoch !== undefined &&
        (this.deps.dataEpoch ?? 0) < releasePolicy.minimumDataEpoch) ||
      releasePolicy.requiredCapabilities.some(
        (capability) => !(this.deps.advertisedCapabilities ?? []).includes(capability),
      ) ||
      (releasePolicy.minimumUpdaterProtocolVersion !== undefined &&
        (this.deps.updaterProtocolVersion ?? 0) < releasePolicy.minimumUpdaterProtocolVersion)
    const mandatory = level === 'required' || level === 'blocked' || incompatible
    if (!mandatory) {
      if (this.policy !== 'patch' || update.changeType !== 'patch') return
      if (!isAutomaticPatchAllowed(
        releasePolicy,
        this.deps.machineId,
        update.current,
        update.latest,
      )) return
    }
    const idle = this.deps.getIdleState()
    // Ordinary patches must never interrupt active work, regardless of elapsed time.
    if (!mandatory && !idle.idle) return

    this.upgradeInFlight = true
    try {
      await this.deps.startUpgrade(update.latest, mandatory)
    } finally {
      this.upgradeInFlight = false
    }
  }

  private nextIntervalMs(): number {
    // Draw fresh jitter for each poll so fleets do not stay synchronized.
    return this.deps.intervalMs ?? (5 * 60_000 + Math.floor((this.deps.random ?? Math.random)() * 10 * 60_000))
  }

  private arm(delayMs: number): void {
    if (!this.started || this.timer) return
    const setTimer = this.deps.setTimeout ?? setTimeout
    this.timer = setTimer(() => {
      this.timer = null
      void this.runOnce().catch(() => {}).finally(() => {
        if (this.started) {
          this.arm(this.nextIntervalMs())
        }
      })
    }, delayMs)
    this.timer.unref?.()
  }
}
