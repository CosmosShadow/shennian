// @arch docs/architecture/desktop/unified-desktop.md

export type DesktopPlatform = 'darwin' | 'linux' | 'win32'

export type DaemonStatus = {
  running: boolean
  pid: number | null
  stale: boolean
  remoteAccessDisabled?: boolean
  launcher?: 'desktop-managed' | 'global-cli' | 'unknown'
  platform: DesktopPlatform
  shennianDir: string
  pidFile: string
  logFile: string
  cliVersion?: string
  machineId?: string
  paired?: boolean
  serverUrl?: string
  error?: string
}

export type DesktopConnectorSource = {
  kind: 'global-cli' | 'missing'
  command?: string
}

export type DesktopSetupEvent =
  | { type: 'started'; runId: string; at: string }
  | { type: 'log'; runId: string; at: string; message: string }
  | { type: 'command'; runId: string; at: string; command: string }
  | { type: 'command-output'; runId: string; at: string; command: string; output: string }
  | { type: 'blocked'; runId: string; at: string; command: string; reason: string }
  | { type: 'completed'; runId: string; at: string; ok: boolean; error?: string }

export type DesktopSetupPersistence = {
  lastSucceededAt?: string
  lastFailedAt?: string
  lastError?: string
  retryAfter?: string
  bootstrapCompletedAt?: string
}

export type DesktopControllerState = {
  status: DaemonStatus
  refreshedAt: string
  appVersion?: string
  connectorSource?: DesktopConnectorSource
  setupRunning?: boolean
  setupLog?: DesktopSetupEvent[]
  setupState?: DesktopSetupPersistence
}

export type DesktopAgentStatus = {
  id: 'claude' | 'codex' | 'workbuddy' | 'gemini' | 'cursor' | 'opencode'
  name: string
  available: boolean
  detail?: string
}

export type DesktopWorkBuddyIntegrationStatus = {
  available: boolean
  state: 'unavailable' | 'not_installed' | 'enabled' | 'disabled' | 'conflict'
  installedVersion: string | null
  availableVersion: string | null
  needsUpdate: boolean
  consentRequired: boolean
  restartRequired: boolean
  errorCode?: string
}

export type DesktopWorkBuddyIntegrationResult = {
  ok: boolean
  status?: DesktopWorkBuddyIntegrationStatus
  errorCode?: string
}

export type ExportLogResult = {
  canceled: boolean
  canReveal?: boolean
}

export type DesktopUpdateState =
  | {
      status: 'idle' | 'checking' | 'not-available'
      currentVersion: string
      downloadUrl?: string
      message?: string
    }
  | {
      status: 'available'
      currentVersion: string
      version: string
      releaseName?: string
      releaseNotes?: string
      sizeBytes?: number
      downloadUrl?: string
      message?: string
    }
  | {
      status: 'downloading'
      currentVersion: string
      version?: string
      percent: number
      transferred?: number
      total?: number
      downloadUrl?: string
      message?: string
    }
  | {
      status: 'verifying'
      currentVersion: string
      version: string
      downloadUrl?: string
      message?: string
    }
  | {
      status: 'downloaded'
      currentVersion: string
      version: string
      releaseName?: string
      releaseNotes?: string
      sizeBytes?: number
      installOnExit?: boolean
      downloadUrl?: string
      message?: string
    }
  | {
      status: 'error'
      currentVersion: string
      downloadUrl?: string
      message: string
    }

export type DesktopBridgeResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: { code: string; message: string; retryable: boolean; action?: string } }

export type DesktopNotificationRequest = {
  kind: 'agent.attention' | 'room.message' | 'session.completed'
  title: string
  body: string
  target:
    | { kind: 'agent'; id: string }
    | { kind: 'machine'; id: string }
    | { kind: 'room'; id: string }
    | { kind: 'session'; id: string }
}

export type DesktopNotificationResult =
  | { status: 'shown'; route: string }
  | {
      status:
        | 'denied'
        | 'disabled'
        | 'duplicate'
        | 'failed'
        | 'unsafe-content'
        | 'unsafe-target'
        | 'unsupported'
    }

export type DesktopSystemSettingsSnapshot = {
  notification: {
    status: 'granted' | 'denied' | 'not-determined' | 'unknown' | 'unsupported'
    canOpenSettings: boolean
  }
  microphone: {
    status: 'granted' | 'denied' | 'not-determined' | 'unknown' | 'unsupported'
    canOpenSettings: boolean
  }
  shortcuts: Array<{
    id:
      | 'show-window'
      | 'open-settings'
      | 'toggle-sidebar'
      | 'check-updates'
      | 'export-log'
      | 'quit'
    accelerator: string
    status: 'available' | 'conflict' | 'unavailable'
  }>
}

export type DesktopWindowCloseBehavior = 'keep-running' | 'quit'
export type DesktopWindowBehaviorPreference = {
  closeBehavior: DesktopWindowCloseBehavior
}

export type DesktopBridge = {
  clipboard?: {
    writeText(text: string): Promise<boolean>
  }
  app?: {
    getInfo?(): Promise<
      DesktopBridgeResult<{
        version: string
        platform: DesktopPlatform
        isPackaged: boolean
      }>
    >
    getLatestCliVersion(): Promise<DesktopBridgeResult<{ version: string }>>
    openExternal?(input: { url: string }): Promise<DesktopBridgeResult<void>>
    setLanguage?(input: { language: 'zh' | 'en' }): Promise<DesktopBridgeResult<void>>
    subscribeCommands?(
      callback: (event: { command: 'open-settings' | 'toggle-sidebar' }) => void,
    ): () => void
  }
  notifications?: {
    getPreference(): Promise<DesktopBridgeResult<{ enabled: boolean; showBody: boolean }>>
    setPreference(input: { enabled: boolean; showBody: boolean }): Promise<DesktopBridgeResult<{ enabled: boolean; showBody: boolean }>>
    show(input: DesktopNotificationRequest): Promise<DesktopBridgeResult<DesktopNotificationResult>>
    subscribeNavigation(
      callback: (event: { revision: number; value: { route: string } }) => void,
    ): () => void
  }
  settings?: {
    getSystem(): Promise<DesktopBridgeResult<DesktopSystemSettingsSnapshot>>
    openSystem(input: { target: 'notifications' | 'microphone' }): Promise<DesktopBridgeResult<void>>
    getWindowBehavior(): Promise<DesktopBridgeResult<DesktopWindowBehaviorPreference>>
    setWindowBehavior(
      input: DesktopWindowBehaviorPreference,
    ): Promise<DesktopBridgeResult<DesktopWindowBehaviorPreference>>
  }
  updates: {
    getState(): Promise<DesktopBridgeResult<DesktopUpdateState>>
    check(): Promise<DesktopBridgeResult<DesktopUpdateState>>
    download(): Promise<DesktopBridgeResult<DesktopUpdateState>>
    installNow(): Promise<DesktopBridgeResult<void>>
    installOnQuit(): Promise<DesktopBridgeResult<void>>
    subscribe(
      callback: (event: { revision: number; value: DesktopUpdateState }) => void,
    ): () => void
  }
  getState(): Promise<DesktopControllerState>
  runLocalSetup?(): Promise<DaemonStatus>
  cancelLocalSetup?(): Promise<boolean>
  ensurePaired?(): Promise<DaemonStatus>
  startDaemon(): Promise<DaemonStatus>
  stopDaemon(): Promise<DaemonStatus>
  openWeb?(): Promise<void>
  openLog?(): Promise<ExportLogResult>
  revealLog?(): Promise<{ revealed: boolean }>
  tailLog?(lines?: number): Promise<string>
  getAgentStatuses?(): Promise<DesktopAgentStatus[]>
  getWorkBuddyIntegration?(): Promise<DesktopWorkBuddyIntegrationResult>
  onStateChange?(callback: (state: DesktopControllerState) => void): () => void
  onSetupEvent?(callback: (event: DesktopSetupEvent) => void): () => void
}

export type DesktopControlAvailability = {
  available: boolean
  bridge: DesktopBridge | null
}
