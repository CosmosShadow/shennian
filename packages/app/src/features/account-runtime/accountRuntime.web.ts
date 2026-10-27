// @arch docs/features/desktop-local-first-client.md#33-进程职责

import type { RelayConnectivitySnapshot, ResFrame } from '@shennian/wire'
import {
  desktopAccountActions,
  getDesktopAccountRuntimeState,
  subscribeDesktopAccountRuntimeState,
} from '../desktop-control/useDesktopAccountSync'
import {
  DESKTOP_ACCOUNT_MACHINE_REQUEST_METHODS,
  ACCOUNT_MACHINE_OPERATION_BY_METHOD,
  type DesktopAccountMachineRequestMethod,
  type AccountMachineRequestOptions,
  type DesktopAccountRuntime,
  type SessionPageResult,
} from './accountRuntime.types'

const allowedMachineMethods = new Set<string>(DESKTOP_ACCOUNT_MACHINE_REQUEST_METHODS)

export const accountRuntime: DesktopAccountRuntime = {
  async loadProjectSessions(projectId, page) {
    return desktopAccountActions.loadProjectSessions(projectId, page) as Promise<SessionPageResult>
  },
  async persistSession(session) {
    await desktopAccountActions.persistSession(session)
  },
  async deleteSession(sessionId, cleanupPolicy) {
    await desktopAccountActions.deleteSession(sessionId, cleanupPolicy)
  },
  async updateSessionUserState(sessionId, userState) {
    await desktopAccountActions.updateSessionUserState(sessionId, userState)
  },
  async markSessionRead(sessionId, lastReadAt, readWatermark) {
    await desktopAccountActions.markSessionRead(sessionId, lastReadAt, readWatermark)
  },
  async deleteProject(projectId) {
    await desktopAccountActions.deleteProject(projectId)
  },
  async reconnect(source) {
    await desktopAccountActions.reconnect(source)
  },
  async observeMachine(machineId) {
    return desktopAccountActions.observeMachine(machineId)
  },
  async unobserveMachine(machineId) {
    await desktopAccountActions.unobserveMachine(machineId)
  },
  async requestMachine(machineId, method, params, options) {
    assertAllowedMethod(method)
    return desktopAccountActions.requestMachineOperation<ResFrame>(
      ACCOUNT_MACHINE_OPERATION_BY_METHOD[method],
      machineId,
      params,
      options,
    )
  },
  getConnectivitySnapshot() {
    return getDesktopAccountRuntimeState().status?.connectivity ?? null
  },
  subscribeConnectivity(listener) {
    let previous = getDesktopAccountRuntimeState().status?.connectivity ?? null
    return subscribeDesktopAccountRuntimeState(() => {
      const next = getDesktopAccountRuntimeState().status?.connectivity ?? null
      if (next === previous) return
      previous = next
      listener(next)
    })
  },
}

function assertAllowedMethod(method: DesktopAccountMachineRequestMethod): void {
  if (!allowedMachineMethods.has(method)) throw new Error('Machine request method is not allowed')
}

export type { DesktopAccountMachineRequestMethod as AccountMachineRequestMethod, AccountMachineRequestOptions }
export type { RelayConnectivitySnapshot }
