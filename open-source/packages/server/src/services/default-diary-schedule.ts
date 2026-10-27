// @arch open-source/docs/server-runtime.md
// @test src/__tests__/conversation-schedules.test.ts
import { createHash } from 'node:crypto'
import { prisma } from '../lib/prisma.js'
import { primaryMachine } from './personal-workspace/primary-machine.js'
import { createMachineSchedule, scheduleView } from './conversation-schedules.js'

export const DEFAULT_DIARY_PROMPT =
  '总结当天并更新日记。根据今天已有的记录和文档完成总结。先运行 shennian steward paths 确认已配置的工作区和日记目录，再按工作区 AGENTS.md 及 index.md 中的资料入口按需读取当天相关记录；不要扫描无关目录。按本任务保存的时区确定当天日期，日记保存为已配置日记目录下的 YYYY/YYYY-MM-DD.md，一天一篇。保留已有内容，补充有依据的活动、进展和待办，不编造事实，不重复追加相同内容。没有记录时如实说明，未配置日记目录时报告需要配置，不自行选址。完成写入并读回核对后，向用户简短报告结果，使用 Markdown 链接 [查看日记](shennian://diary/YYYY-MM-DD)，将日期替换为实际记录日期；不要让手机用户复制电脑绝对路径。失败则明确报告原因，不声称已写入。'
/** One default per account. A deleted/paused default stays deleted/paused, even after switching primary machines. */
export async function ensureDefaultDiarySchedule(userId: string, timezone: string) {
  const key = createHash('sha256')
    .update(JSON.stringify([userId, 'default-diary-v1']))
    .digest('hex')
  const prior = await prisma.conversationSchedule.findUnique({ where: { operationKey: key } })
  if (prior) return scheduleView(prior)
  const primary = await primaryMachine(userId)
  if (!primary.machine) throw new Error('personal_primary_not_configured')
  return createMachineSchedule(
    userId,
    primary.machine.id,
    {
      operationId: 'default-diary-v1',
      executionMode: 'worker',
      prompt: `${DEFAULT_DIARY_PROMPT} 本任务时区：${timezone}。`,
      timeDescription: '每天23:00',
      timezone,
    },
    key,
  )
}
