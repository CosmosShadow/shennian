// @arch open-source/docs/cli-runtime.md
// @test src/__tests__/room-reply-notice.test.ts

import type { ActiveSession } from './types.js'

/**
 * A managed Agent's final text never reaches the Room by itself; it must call
 * `room send`. When every send of a Turn failed, the Room only sees silence and
 * the reason stays inside the Agent's private conversation. This turns such a
 * Turn into one Owner-visible line. An Agent that simply chose not to speak has
 * no failed send and is never reported.
 */

const REASONS: Record<string, string> = {
  managed_agent_restricted_room_unsupported: '该智能体使用了限制权限，暂不支持群聊，请在智能体设置中改用全部权限',
  managed_room_context_expired: '群权限已重置（神念重启或被新一轮取代），等下一次被群消息唤醒后会重新授权',
  managed_room_context_revoked: '该智能体已不再属于此群，或群绑定已变化',
  managed_room_context_invalid: '本机授权异常，请在神念中检查机器配对状态',
  managed_room_context_unavailable: '群上下文不可用，请确认神念正在运行且智能体仍在群里',
  managed_room_action_forbidden: '当前这一轮没有发送权限',
  machine_not_authorized: '本机尚未授权，请先在神念中完成配对',
  room_message_empty: '消息内容为空',
  room_write_forbidden: '该智能体没有此群的发言权限',
  server_unavailable: '无法连接神念服务，请检查网络',
}

export function describeRoomReplyFailure(code: string): string {
  return REASONS[code] ?? `发送失败（${code}）`
}

/** Returns the notice text when this Turn tried to send and none succeeded. */
export function roomReplyFailureNotice(session: Pick<ActiveSession, 'roomSendOutcome'>): string | null {
  const outcome = session.roomSendOutcome
  if (!outcome || outcome.successes > 0 || outcome.failureCodes.length === 0) return null
  const last = outcome.failureCodes[outcome.failureCodes.length - 1]!
  return `本轮未能在群里回复：${describeRoomReplyFailure(last)}。`
}
