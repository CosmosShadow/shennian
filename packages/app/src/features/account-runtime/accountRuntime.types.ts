// @arch docs/features/desktop-local-first-client.md#33-进程职责

import type {
  NianProject,
  NianSession,
  RelayConnectivitySnapshot,
  ResFrame,
} from '@shennian/wire'

export type SessionPageRequest = {
  limit?: number
  before?: number
}

export type SessionPageResult = {
  hasMore: boolean
  nextBefore?: number | null
}

/**
 * Native machine methods are deliberately closed. Desktop's narrower list below
 * excludes dispatch steps owned by main instead of opening a generic RPC tunnel.
 */
export const ACCOUNT_MACHINE_REQUEST_METHODS = [
  'fs.ls',
  'fs.read',
  'fs.rename',
  'fs.write',
  'fs.archive.zip',
  'fs.export.markdown-pdf',
  'fs.export.markdown-pdf.setup',
  'fs.transfer.start',
  'fs.transfer.chunk',
  'fs.transfer.finish',
  'fs.transfer.abort',
  'project.fs.open',
  'project.fs.list',
  'project.fs.read',
  'project.fs.close',
  'upgrade.start',
  'upgrade.set-policy',
  'agents.refresh',
  'agent.auth.start',
  'agent.external-sessions.list',
  'agent.external-sessions.import',
  'agent.permission.respond',
  'agent.session-options.get',
  'agent.workspace.validate',
  'machine.remote-access.pause',
  'models.refresh',
  'session.refresh',
  'room.agent.restart-managed',
  'room.agent.bind-managed',
  'session.tool.detail',
  'chat.enqueue',
  'chat.queue.get',
  'chat.queue.edit',
  'chat.queue.delete',
  'chat.queue.promote',
  'chat.abort',
  'session.message.status',
  'agent.capabilities.list',
] as const

export type AccountMachineRequestMethod = (typeof ACCOUNT_MACHINE_REQUEST_METHODS)[number]
export type DesktopAccountMachineRequestMethod = Exclude<AccountMachineRequestMethod, 'room.agent.bind-managed'>
export const DESKTOP_ACCOUNT_MACHINE_REQUEST_METHODS = ACCOUNT_MACHINE_REQUEST_METHODS.filter(
  (method): method is DesktopAccountMachineRequestMethod => method !== 'room.agent.bind-managed',
)

export const ACCOUNT_MACHINE_OPERATION_BY_METHOD: Record<
  DesktopAccountMachineRequestMethod,
  DesktopMachineOperation
> = {
  'fs.ls': 'machine.fs.list',
  'fs.read': 'machine.fs.read',
  'fs.rename': 'machine.fs.rename',
  'fs.write': 'machine.fs.write',
  'fs.archive.zip': 'machine.fs.archive',
  'fs.export.markdown-pdf': 'machine.fs.exportPdf',
  'fs.export.markdown-pdf.setup': 'machine.fs.exportPdfSetup',
  'fs.transfer.start': 'machine.transfer.start',
  'fs.transfer.chunk': 'machine.transfer.chunk',
  'fs.transfer.finish': 'machine.transfer.finish',
  'fs.transfer.abort': 'machine.transfer.abort',
  'project.fs.open': 'project.fs.open',
  'project.fs.list': 'project.fs.list',
  'project.fs.read': 'project.fs.read',
  'project.fs.close': 'project.fs.close',
  'upgrade.start': 'machine.upgrade.start',
  'upgrade.set-policy': 'machine.upgrade.setPolicy',
  'agents.refresh': 'machine.agents.refresh',
  'agent.auth.start': 'machine.agentAuth.start',
  'agent.external-sessions.list': 'machine.externalSessions.list',
  'agent.external-sessions.import': 'machine.externalSessions.import',
  'agent.permission.respond': 'machine.permission.respond',
  'agent.session-options.get': 'machine.sessionOptions.get',
  'agent.workspace.validate': 'machine.agentWorkspace.validate',
  'machine.remote-access.pause': 'machine.remoteAccess.pause',
  'models.refresh': 'machine.models.refresh',
  'session.refresh': 'machine.session.refresh',
  'room.agent.restart-managed': 'machine.managedSession.restart',
  'session.tool.detail': 'machine.sessionTool.detail',
  'chat.enqueue': 'machine.chat.enqueue',
  'chat.queue.get': 'machine.chat.queueGet',
  'chat.queue.edit': 'machine.chat.queueEdit',
  'chat.queue.delete': 'machine.chat.queueDelete',
  'chat.queue.promote': 'machine.chat.queuePromote',
  'chat.abort': 'machine.chat.abort',
  'session.message.status': 'machine.sessionMessage.status',
  'agent.capabilities.list': 'machine.agentCapabilities.list',
}

export type DesktopMachineOperation =
  | 'machine.fs.list'
  | 'machine.fs.read'
  | 'machine.fs.rename'
  | 'machine.fs.write'
  | 'machine.fs.archive'
  | 'machine.fs.exportPdf'
  | 'machine.fs.exportPdfSetup'
  | 'machine.transfer.start'
  | 'machine.transfer.chunk'
  | 'machine.transfer.finish'
  | 'machine.transfer.abort'
  | 'project.fs.open'
  | 'project.fs.list'
  | 'project.fs.read'
  | 'project.fs.close'
  | 'machine.upgrade.start'
  | 'machine.upgrade.setPolicy'
  | 'machine.agents.refresh'
  | 'machine.agentAuth.start'
  | 'machine.externalSessions.list'
  | 'machine.externalSessions.import'
  | 'machine.permission.respond'
  | 'machine.sessionOptions.get'
  | 'machine.agentWorkspace.validate'
  | 'machine.remoteAccess.pause'
  | 'machine.models.refresh'
  | 'machine.session.refresh'
  | 'machine.managedSession.restart'
  | 'machine.sessionTool.detail'
  | 'machine.chat.enqueue'
  | 'machine.chat.queueGet'
  | 'machine.chat.queueEdit'
  | 'machine.chat.queueDelete'
  | 'machine.chat.queuePromote'
  | 'machine.chat.abort'
  | 'machine.sessionMessage.status'
  | 'machine.agentCapabilities.list'

export type AccountMachineRequestOptions = {
  connectTimeoutMs?: number
  responseTimeoutMs?: number
  waitUntilReady?: boolean
}

export type AccountRuntime = {
  loadProjectSessions(projectId: string, page?: SessionPageRequest): Promise<SessionPageResult>
  persistSession(session: NianSession): Promise<void>
  deleteSession(sessionId: string, cleanupPolicy?: 'none' | 'auto'): Promise<void>
  updateSessionUserState(sessionId: string, userState: Record<string, unknown>): Promise<void>
  markSessionRead(
    sessionId: string,
    lastReadAt?: string,
    readWatermark?: Record<string, unknown>,
  ): Promise<void>
  deleteProject(projectId: string): Promise<void>
  persistProject(project: NianProject): Promise<void>
  reconnect(source?: 'manual' | 'watchdog' | 'foreground' | 'network-restored'): Promise<void>
  observeMachine(machineId: string): Promise<boolean>
  unobserveMachine(machineId: string): Promise<void>
  requestMachine(
    machineId: string,
    method: AccountMachineRequestMethod,
    params: Record<string, unknown>,
    options?: AccountMachineRequestOptions,
  ): Promise<ResFrame>
  getConnectivitySnapshot(): RelayConnectivitySnapshot | null
  subscribeConnectivity(listener: (snapshot: RelayConnectivitySnapshot | null) => void): () => void
}

/** Desktop has no renderer-side managed allocation/binding or project persistence. */
export type DesktopAccountRuntime = Omit<AccountRuntime, 'persistProject' | 'requestMachine'> & {
  requestMachine(machineId: string, method: DesktopAccountMachineRequestMethod,
    params: Record<string, unknown>, options?: AccountMachineRequestOptions): Promise<ResFrame>
}
