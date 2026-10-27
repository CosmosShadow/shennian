// @arch docs/features/desktop-local-first-client.md#九自动更新规范
// @test packages/app/src/__tests__/desktop-update-safety.test.ts

import { getSessionLiveActivity } from '@shennian/shared'
import type { NianSession } from '@shennian/wire'

export function getActiveDesktopUpdateSessions(
  sessions: NianSession[],
  now = Date.now(),
): NianSession[] {
  return sessions.filter((session) => Boolean(getSessionLiveActivity(session, { now })))
}

export function getDesktopRestartImpactMessage(activeSessionCount: number): string {
  if (activeSessionCount <= 0) return ''
  return `仍有 ${activeSessionCount} 个 Agent 会话正在工作。重启会暂时关闭神念并中断当前界面连接，但不会主动停止后台 Agent。你可以选择稍后安装，继续当前工作。`
}
