// @arch open-source/docs/cli-runtime.md
// @test src/__tests__/personal-reminder-command.test.ts
import { DaemonIpcError } from '../daemon-ipc/protocol.js'

/** Reminders have one trigger. Preserve explicit intervals in their visible content,
 * without pretending the existing wire format has a separate calendar end time. */
export function reminderRequestArgs(args: Record<string, unknown>) {
  if (!['create', 'update'].includes(String(args.operation)) || typeof args.when !== 'string') return args
  const iso = '(\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}(?::\\d{2}(?:\\.\\d{1,3})?)?(?:Z|[+-]\\d{2}:\\d{2}))'
  const range = args.when.trim().match(new RegExp(`^${iso}\\s*(?:至|到|/|–|—)\\s*${iso}$`, 'i'))
  if (!range) return args
  const [, start, end] = range
  if (!Number.isFinite(Date.parse(start!)) || !Number.isFinite(Date.parse(end!)) || Date.parse(end!) <= Date.parse(start!))
    throw new DaemonIpcError('invalid_reminder_interval', '日程结束时间必须晚于开始时间；请核对后再保存。')
  if (typeof args.content !== 'string' || !args.content.trim())
    throw new DaemonIpcError('invalid_reminder_content', '请提供日程内容。')
  const content = `${args.content.trim()}（${start} 至 ${end}）`
  if (content.length > 2000) throw new DaemonIpcError('invalid_reminder_content', '日程内容过长，请缩短后再保存。')
  return { ...args, when: start, content }
}

// Fixed product errors only; never echo arbitrary HTTP/provider details across IPC.
const reminderErrors: Record<string, string> = {
  invalid_text: '日程内容或时间格式不正确，请核对后再保存。',
  invalid_reminder_time: '提醒时间必须在将来，请重新确认时间。',
  invalid_revision: '请先查询日程，使用最新 revision 修改。',
  revision_conflict: '日程已变化，请重新查询后再修改，不要重复创建。',
  not_found: '日程不存在，请重新查询。',
  reminders_unavailable: '日程服务暂不可用；尚未确认保存，请先查询再重试。',
  schedule_session_unavailable: '个人助手会话不可用，请重新连接主电脑。',
}

export async function executeServerReminder(input: {
  serverUrl: string
  machineToken: string
  sessionId: string
  args: Record<string, unknown>
}) {
  const { context: _context, sessionId: _sessionId, ...args } = input.args
  try {
    const result = await fetch(`${input.serverUrl.replace(/\/$/, '')}/api/personal-reminders/agent`, {
      method: 'POST',
      headers: { authorization: `Bearer ${input.machineToken}`, 'content-type': 'application/json' },
      body: JSON.stringify({ ...reminderRequestArgs(args), sessionId: input.sessionId }),
      signal: AbortSignal.timeout(25000),
    })
    const data = (await result.json()) as { error?: string }
    if (!result.ok) {
      const code = typeof data.error === 'string' && Object.hasOwn(reminderErrors, data.error) ? data.error : 'reminders_unavailable'
      throw new DaemonIpcError(code, `${code}: ${reminderErrors[code]}`)
    }
    return data
  } catch (error) {
    if (error instanceof DaemonIpcError) throw error
    throw new DaemonIpcError('reminders_unavailable', reminderErrors.reminders_unavailable!)
  }
}
export const STEWARD_REMINDER_INSTRUCTIONS =
  '手机日程/提醒使用 shennian reminder，与让 AI 定时工作的 schedule 分开。先用 --operation preview --text <自然语言> --timezone <用户IANA时区> 解析。日程也可以是无时间的备忘待办：用户只说“充值阿里云”等事项时直接添加，不追问提醒时间，不虚构时间；preview 返回 when 为空字符串时，create 省略 --when，保存后只确认加入待办，不声称会推送提醒。仅在用户明确要求定时提醒且时间表述存在歧义时询问。当前日程只有一个提醒触发时间；用户指定起止时段时，--when 只填开始时间，将完整起止时段保留在 --content，并明确按开始时间提醒，不宣称已保存独立结束时间字段。不要把两个时间拼到 --when。保存用 --operation create --id <稳定UUID，同一次操作重试不变> --content <内容> [--when <解析出的时间或规则>] --timezone <时区>。查询用 --operation list，可带 --before <nextBefore> 翻页；精确修改用 update 并带 --id --revision --content --timezone；保留原时间时带原 --when，用户要求移除时间时省略 --when，不能在仅修改内容时误清除原时间；完成/恢复/删除用 complete/restore/delete 并带 --id --revision。不要编造成功；只有命令真实保存成功后才 say 确认。参数错误先纠正参数，不原样循环重试；超时或未知保存状态先 list 核对稳定 ID，避免重复。错误不等于成功，旧 Client 或服务不支持时直说需要更新。用户在日程页输入的添加请求默认是手机日程，不创建 AI 工作任务。'
