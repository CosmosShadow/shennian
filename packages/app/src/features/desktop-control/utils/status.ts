// @arch docs/architecture/desktop/unified-desktop.md
// @test packages/app/src/__tests__/desktop-control-status.test.ts

import type { Machine } from '@shennian/wire'
import type { DaemonStatus, DesktopConnectorSource, DesktopPlatform } from '../types'

export type DesktopControlStateKey =
  | 'unavailable'
  | 'loading'
  | 'missing-connector'
  | 'setup-running'
  | 'connected'
  | 'unpaired'
  | 'incompatible'
  | 'unsupported-source'
  | 'service-running'
  | 'paused'
  | 'stopped'
  | 'error'

export type DesktopControlTone = 'neutral' | 'success' | 'warning' | 'error'

export type DesktopControlStatusOptions = {
  unavailable?: boolean
  connectorMissing?: boolean
  setupRunning?: boolean
  serverOnline?: boolean | null
  serverMachineKnown?: boolean
}

export function getDesktopControlStatusOptions(
  status: DaemonStatus | null | undefined,
  machines: Machine[],
  unavailable = false,
): DesktopControlStatusOptions {
  const localMachine = status?.machineId
    ? machines.find((machine) => machine.id === status.machineId)
    : undefined

  return {
    unavailable,
    serverOnline: localMachine?.online ?? null,
    serverMachineKnown: status?.machineId ? Boolean(localMachine) : false,
  }
}

export function getDesktopControlStateKey(
  status: DaemonStatus | null | undefined,
  options?: DesktopControlStatusOptions,
): DesktopControlStateKey {
  if (options?.setupRunning) return 'setup-running'
  if (options?.connectorMissing) return 'missing-connector'
  if (!status) return 'loading'
  if (
    status.launcher === 'desktop-managed' ||
    (status.running && status.launcher === 'unknown') ||
    status.error?.includes('unsupported_daemon_source') ||
    status.error?.includes('unknown launcher')
  )
    return 'unsupported-source'
  if (
    status.error?.includes('protocol is incompatible') ||
    status.error?.includes('does not support')
  )
    return 'incompatible'
  if (status.error) return 'error'
  if (status.paired === false) return 'unpaired'
  if (status.remoteAccessDisabled) return status.running && !status.stale ? 'error' : 'paused'
  if (options?.serverOnline === true) return 'connected'
  if (status.running && !status.stale) return 'service-running'
  if (status.stale) return 'stopped'
  return 'paused'
}

export function getDesktopControlLabel(
  status: DaemonStatus | null | undefined,
  options?: DesktopControlStatusOptions,
): string {
  if (options?.unavailable) return '未连接'

  switch (getDesktopControlStateKey(status, options)) {
    case 'connected':
      return '已在线'
    case 'setup-running':
      return '正在配置'
    case 'missing-connector':
      return '需要安装'
    case 'unpaired':
      return '需要配对'
    case 'incompatible':
      return 'Client 版本不兼容'
    case 'unsupported-source':
      return 'Client 来源不受支持'
    case 'service-running':
      return '服务运行中'
    case 'paused':
      return '已关闭'
    case 'stopped':
      return '未运行'
    case 'error':
      return '需要处理'
    case 'loading':
    default:
      return '检测中'
  }
}

export function getDesktopControlDescription(
  status: DaemonStatus | null | undefined,
  options?: DesktopControlStatusOptions,
): string {
  if (options?.unavailable) return '当前环境不支持管理本机 Client'
  if (options?.setupRunning) return '正在连接并配置独立 Shennian Client'
  if (options?.connectorMissing)
    return '尚未安装独立 Shennian Client。本机执行暂不可用，账号、群聊和远端机器功能仍可继续使用。'
  if (!status) return '正在检查这台电脑的连接状态…'
  const state = getDesktopControlStateKey(status, options)
  if (state === 'unsupported-source') {
    return '检测到历史或未知来源的 Client。Desktop 不会停止、接管或迁移它，请单独安装当前独立 Client。'
  }
  if (state === 'incompatible') {
    return '已安装的独立 Client 版本不兼容。请按 Client 自身的升级流程更新后重新检查。'
  }
  if (status.error) return status.error
  if (status.paired === false) return '这台电脑还没有绑定到当前账号。点击后会在后台自动完成配对。'
  if (status.remoteAccessDisabled) {
    return status.running && !status.stale
      ? getDesktopControlLabel(status, options)
      : '远程访问已关闭，手机和网页暂时不能连接这台电脑'
  }
  if (options?.serverOnline === true)
    return '服务器已确认这台电脑在线，手机和网页可以远程使用本机 Agent'
  if (status.running && !status.stale) {
    if (options?.serverMachineKnown === false) {
      return '本机服务正在运行，但还没有在服务器机器列表中确认这台电脑'
    }
    return '本机服务正在运行，但服务器尚未确认在线。可关闭后重新开启远程访问'
  }
  if (status.stale) return '本机服务未运行，可以重新开启远程访问'
  return '手机和网页暂时不能连接这台电脑'
}

export function getDesktopControlTone(
  status: DaemonStatus | null | undefined,
  options?: DesktopControlStatusOptions,
): DesktopControlTone {
  if (options?.unavailable || !status) return 'neutral'
  if (options?.setupRunning || options?.connectorMissing) return 'warning'
  const state = getDesktopControlStateKey(status, options)
  if (state === 'incompatible' || state === 'unsupported-source' || state === 'error')
    return 'error'
  if (status.remoteAccessDisabled) return status.running && !status.stale ? 'error' : 'warning'
  if (options?.serverOnline === true) return 'success'
  if (status.running && !status.stale) return 'success'
  return 'warning'
}

export function getDesktopConnectorSourceLabel(
  status: DaemonStatus | null | undefined,
  source: DesktopConnectorSource | null | undefined,
): string {
  const versionSuffix = status?.cliVersion ? ` · ${status.cliVersion}` : ''
  if (status?.launcher === 'desktop-managed') return `不受支持的旧版 Client${versionSuffix}`
  if (status?.launcher === 'global-cli') return `独立 Client${versionSuffix}`

  const kind = source?.kind ?? 'missing'

  switch (kind) {
    case 'global-cli':
      return `独立 Client${versionSuffix}`
    default:
      return status?.launcher === 'unknown' ? '未知来源 Client' : '未安装独立 Client'
  }
}

export function getPlatformLabel(platform: DesktopPlatform | null | undefined): string {
  switch (platform) {
    case 'darwin':
      return 'macOS'
    case 'win32':
      return 'Windows'
    case 'linux':
      return 'Linux'
    default:
      return '桌面端'
  }
}
