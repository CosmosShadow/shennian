export type MachinePermission = 'view' | 'use' | 'full' | 'admin'

/** `minor` is a legacy compatibility value; current daemons normalize it to `none`. */
export type AutoUpgradePolicy = 'none' | 'patch' | 'minor'

export type Machine = {
  id: string
  name: string
  os: string
  agentList: string[]
  /** Rich agent info with per-agent model lists (additive, backward-compatible) */
  agents?: import('./session.ts').AgentInfo[]
  paired: boolean
  online: boolean
  lastSeen: string
  region?: string
  /** CLI version currently running on this machine */
  cliVersion?: string
  /** Stable identity of the daemon data root. It is not the mobile installationId. */
  daemonInstallationId?: string
  /** Personal Session sync protocol understood by this daemon. */
  sessionSyncProtocolVersion?: import('./session-sync.ts').SessionSyncProtocolVersion
  /** Active personal Session data authority generation. */
  sessionSyncDataEpoch?: import('./session-sync.ts').SessionSyncDataEpoch
  /** Full capability set required by the hard-cutover personal Session protocol. */
  sessionSyncCapabilities?: import('./session-sync.ts').SessionSyncCapability[]
  /** External updater protocol advertised by the live daemon; absent means legacy engine. */
  updaterProtocolVersion?: number
  /** Auto-upgrade policy configured on this machine */
  autoUpgrade?: AutoUpgradePolicy
  /** Set only after the daemon durably disables remote access on the machine. */
  remoteAccessDisabledAt?: string | null
  /** Ownership role — absent means owner (backward-compatible) */
  role?: 'owner' | 'granted'
  /** Non-null only when role === 'granted' */
  permission?: MachinePermission
  /** Active redeemed grants created by the owner for this machine. */
  sharedCount?: number
  /** Nicknames used by the owner-only machine detail summary. */
  sharedWith?: string[]
  /** Unredeemed, active invitations created by this owner. */
  pendingShareCount?: number
  /** Agents on this machine that have a non-missing provider config. */
  configuredAgentCount?: number
  /** Present for machines shared by another user. */
  ownerName?: string | null
  ownerPhone?: string | null
  ownerEmail?: string | null
  /**
   * Machine-scoped WeChat RPA capability projection.
   * This is additive: old servers/daemons may omit it, and clients must treat
   * omission as "unknown / not reported yet".
   */
  wechatRpa?: MachineWeChatRpaCapability | null
}

export type MachineWeChatRpaCapability = {
  supported: boolean
  enabled: boolean
  status: 'ready' | 'needs_setup' | 'unavailable' | 'error' | 'unknown'
  reasonCode?:
    | 'ready'
    | 'disabled'
    | 'offline'
    | 'unsupported_os'
    | 'not_reported'
    | 'wechat_not_installed'
    | 'wechat_not_running'
    | 'permission_missing'
    | 'helper_not_ready'
    | 'runtime_error'
    | 'unknown'
  runtimeId?: string | null
  pollIntervalSeconds?: number | null
  foregroundPolicy?: 'work' | 'polite' | string | null
  helperVersion?: string | null
  clientRuntimeVersion?: string | null
  lastCheckedAt?: string | null
  lastSeenAt?: string | null
  lastError?: string | null
  checks?: {
    wechatAppDetected?: boolean | null
    accessibilityPermission?: string | null
    screenRecordingPermission?: string | null
    inputMonitoringPermission?: string | null
    automationPermission?: string | null
    helperReady?: boolean | null
  } | null
}

export type UpgradeEventPayload =
  | { state: 'checking';    machineId: string }
  | { state: 'downloading'; machineId: string; version: string; progress?: number }
  | { state: 'installing';  machineId: string; version: string }
  | { state: 'starting';    machineId: string; from: string; to: string; jobId?: string }
  | { state: 'recovering';  machineId: string; from: string; to: string; jobId?: string; activeRunCount?: number }
  | { state: 'healthy';     machineId: string; from: string; to: string; jobId?: string }
  | { state: 'restarting';  machineId: string; from: string; to: string }
  | { state: 'success';     machineId: string; from: string; to: string }
  | { state: 'failed';      machineId: string; error: string }
  | { state: 'rolledback';  machineId: string; to: string; reason: string }
  | { state: 'rolled_back'; machineId: string; to: string; reason: string; jobId?: string }
  | { state: 'interrupted_by_upgrade'; machineId: string; runCount: number; jobId?: string }
  | { state: 'recovery_failed'; machineId: string; runCount: number; error?: string; jobId?: string }

export type MachineGrant = {
  id: string
  granteeId: string | null
  granteeName: string | null
  /** @deprecated Kept optional for old-server compatibility; current UI never displays it. */
  granteePhone?: string | null
  granteeAvatar?: {
    version: string
    thumbUrl: string
    originalUrl: string
  } | null
  permission: MachinePermission
  expiresAt: string | null
  revokedAt: string | null
  createdAt: string
  redeemed: boolean
}
