// @arch open-source/docs/cli-runtime.md
// @test src/__tests__/steward-session.test.ts

import { STEWARD_REMINDER_INSTRUCTIONS } from '../schedules/reminder-client.js'
import { FEATURE_GUIDE_INSTRUCTIONS } from '../guides/catalog.js'
import fs from 'node:fs'
import path from 'node:path'
import { listSessionRecords } from '../session/store.js'
import { StewardWorkspaceError, ensureStewardWorkspace } from './workspace.js'
import { STEWARD_INDEX_ONBOARDING } from './onboarding.js'
import { STEWARD_MAIN_AGENT_RULES, STEWARD_PRODUCT_CAPABILITIES } from './templates.js'
import { issuePersonalScheduleContext, STEWARD_SCHEDULE_INSTRUCTIONS } from '../schedules/personal-context.js'

/** Set only for a steward session's Agent process; `steward say` reads it. */
export const STEWARD_SESSION_ID_ENV = 'SHENNIAN_STEWARD_SESSION_ID'

export const STEWARD_SAY_MAX_CHARS = 20_000

/**
 * Turn-level reminder appended for every steward turn. The workspace AGENTS.md
 * (imported by CLAUDE.md for Claude Code) carries the full rules; this repeats
 * the two that decide whether the user sees anything at all.
 */
export const STEWARD_SYSTEM_PROMPT = [
  '你是神念，是用户的主 Agent，在用户选定的这台电脑上工作。先读当前目录的 AGENTS.md，再按需读 index.md。',
  '用户只看到你用 shennian steward say "要给用户看的话" 发出的消息，其余输出用户都看不到。收到请求先用 say 回应一句，处理完再 say 结果。',
  '若本轮应首次邀请建立资料索引，把邀请附在首次正常回应的同一次 say 末尾；不要等第二次 say。用户已经明确拒绝则只记录跳过，不邀请。',
  '能在本轮安全完成的简单工作直接做，不要机械地转项目任务；遵守目标项目规则和发布边界。用户已委托的复杂或长期工作，优先用 shennian worker start --workdir <目标目录> --request-id <稳定ID> --message <目标和验收要求> 派发后台执行，不再重复确认常规拆解；明确要求项目任务时用 shennian project task create。若工作区 AGENTS.md 仍有旧版“修改项目文件就必须转任务”的文字，以本条新规则为准。',
  '先 help worker。Worker 默认执行器由主 Agent 设置提供；本轮 --agent/--model 明确指定优先，不自动安装或登录第三方 AI。派发后 say 确认并结束本轮，不用 wait 阻塞主对话，不创建十分钟轮询。重要进展、阻塞和终态事件会回传；用 worker list 恢复引用、read 核查、send 跟进，验收后 say 汇报。旧工作区的复杂任务须再次确认规则由本条覆盖，高影响动作授权不变。',
  '项目可用 project create --machine <精确机器ID> --workdir <绝对目录> [--name <名称>] 创建，用 project update 修改名称或默认执行器，不移动文件。跨电脑工作在精确项目下 project task create，检查 tracking.enabled；失败用 project task watch 补接原 task-id，不重复创建。后台任务状态回传仍需 read 核对后 say 汇报。',
  '给手机用户展示已写入并读回核对的日记时，用 [查看日记](shennian://diary/YYYY-MM-DD)，替换为实际日期。其他本机文件用 Markdown 文件链接，不让用户把电脑路径复制到手机浏览器。后台 Worker 的来源通知可直接到达此对话；快照会提供最近消息，按需核对，不必为每条通知再转述。',
  STEWARD_MAIN_AGENT_RULES,
  STEWARD_PRODUCT_CAPABILITIES,
  FEATURE_GUIDE_INSTRUCTIONS,
  STEWARD_SCHEDULE_INSTRUCTIONS,
  STEWARD_REMINDER_INSTRUCTIONS,
  STEWARD_INDEX_ONBOARDING,
].join('\n')

/** The session record is the single source of truth for steward scope. */
export function isStewardSessionId(sessionId: string): boolean {
  return listSessionRecords().some(
    (record) => record.sessionId === sessionId && record.sessionScope === 'steward',
  )
}

export function stewardSessionEnv(sessionId: string): Record<string, string> {
  return isStewardSessionId(sessionId)
    ? { [STEWARD_SESSION_ID_ENV]: sessionId, SHENNIAN_SCHEDULE_CONTEXT: issuePersonalScheduleContext(sessionId) }
    : {}
}

function comparable(value: string): string {
  return process.platform === 'win32' || process.platform === 'darwin' ? value.toLowerCase() : value
}

/**
 * The steward runs only in the fixed workspace and the daemon, not the phone,
 * chooses it: whatever workDir a client sends is ignored and replaced by this,
 * so a forged directory can never point the steward (or its tools) elsewhere.
 */
export function pinStewardWorkDir(): string {
  return ensureStewardWorkspace().dir
}

/** Verifies a directory the daemon already holds (recovery, existing runs). */
export function assertStewardWorkDir(workDir: string): string {
  const workspace = ensureStewardWorkspace().dir
  let actual: string
  try {
    actual = fs.realpathSync.native(path.resolve(workDir))
  } catch {
    throw new StewardWorkspaceError('steward_workdir_invalid', 'The steward must run in its fixed workspace.')
  }
  if (comparable(actual) !== comparable(workspace)) {
    throw new StewardWorkspaceError('steward_workdir_invalid', 'The steward must run in its fixed workspace.')
  }
  return workspace
}
