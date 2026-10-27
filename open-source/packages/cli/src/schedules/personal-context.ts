// @arch open-source/docs/cli-runtime.md
// @test src/__tests__/conversation-schedules.test.ts
import { randomBytes } from 'node:crypto'
const grants = new Map<string, { sessionId: string; expires: number }>()
export function issuePersonalScheduleContext(sessionId: string): string {
  const now = Date.now()
  for (const [key, grant] of grants) {
    if (grant.expires <= now) grants.delete(key)
    else if (grant.sessionId === sessionId) { grant.expires = now + 30 * 60000; return key }
  }
  const token = randomBytes(32).toString('base64url')
  grants.set(token, { sessionId, expires: now + 30 * 60000 })
  return token
}
export function resolvePersonalScheduleContext(value: unknown): string {
  const grant = typeof value === 'string' ? grants.get(value) : null
  if (!grant || grant.expires <= Date.now()) throw new Error('schedule_context_expired')
  return grant.sessionId
}
/** Appended to the steward's turn prompt only; ordinary personal conversations get no such grant. */
export const STEWARD_SCHEDULE_INSTRUCTIONS = '如用户要求安排稍后或定期工作，使用 shennian schedule --operation create --operation-id <稳定ID> --time-description <时间描述> --timezone <IANA时区> --prompt <工作内容> --execution-mode <main或worker>。创建时按用户意图确定：主 Agent 亲自执行用 main，独立后台工作用 worker；日记默认 worker。后台 Worker 结果直接标明来源通知用户，不额外启动主 Agent 转述；旧计划未设置时保留 main。支持每天09:00、每周一09:00、每月1日09:00、每隔24小时、30分钟后或ISO时间。查询用 --operation list；修改/暂停/恢复/删除用 update/pause/resume/delete，并带查询得到的 --id 和 --version。只在真实保存成功后用 say 做简短确认，不得口头承诺尚未保存成功的安排。该任务绑定在这台机器，不是这一次对话；机器离线时到点会跳过而不是等待或补跑。时间和工作内容分开，不在工作 Prompt 里重复创建定时任务。'
