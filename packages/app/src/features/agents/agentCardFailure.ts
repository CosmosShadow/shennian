// @arch docs/features/published-agent-direct-conversations.md
// @test src/__tests__/agent-account-client-platform-errors.test.ts
import { ApiError } from '@shennian/shared/api'

const blockerMessages: Record<string, [string, string]> = {
  machine_offline: ['电脑离线，请启动神念 Client 并联网后重试。', 'The computer is offline. Start Shennian Client and reconnect, then retry.'],
  machine_unavailable: ['电脑未配对或已不可用，请检查电脑连接。', 'The computer is not paired or is unavailable. Check its connection.'],
  agent_unavailable: ['此 AI 已不可用，请返回 AI 列表检查。', 'This AI is unavailable. Check it in the AI list.'],
  agent_mode_unavailable: ['此 AI 的会话模式不支持对外对话。', 'This AI’s session mode does not support external conversations.'],
  runtime_unavailable: ['Client 未报告此 AI 所需的运行能力，请更新 Client 并检查 AI。', 'Client has not reported the required AI runtime. Update Client and check the AI.'],
  runtime_auth_unverified: ['AI 登录不可用，请在电脑上完成 AI 登录后重试。', 'AI sign-in is unavailable. Sign in to the AI on the computer, then retry.'],
  runtime_protection_unverified: ['AI 运行能力尚未验证，请更新 Client 并检查 AI。', 'The AI runtime has not been verified. Update Client and check the AI.'],
  runtime_permission_unconfirmed: ['AI 当前权限尚未确认，请进入 AI 设置，确认并保存运行权限后重试。', 'The AI’s current permissions are unconfirmed. Open AI settings, confirm and save its run permissions, then retry.'],
  runtime_capability_gap: ['此 AI 的运行环境不支持当前权限，请检查 AI 设置与 Client；不会自动放宽权限。', 'The AI runtime does not support its current permissions. Check AI settings and Client; permissions will not be relaxed automatically.'],
}

/** Read-only recovery: refresh versions, explain blockers, never replay consented writes. */
export async function recoverAgentCardFailure<T>(input: {
  error: unknown
  current: T
  zh: boolean
  activating: boolean
  readPublication(): Promise<{ publication: T | null }>
  readReadiness(): Promise<{ readiness: { blockers: string[]; activationAvailable?: boolean } }>
}): Promise<{ publication: T; message: string }> {
  const language = input.zh ? 0 : 1
  const choose = (zh: string, en: string) => input.zh ? zh : en
  const status = input.error instanceof ApiError ? input.error.status : null
  if (status === 401 || status === 403) return { publication: input.current,
    message: choose('登录或访问权限不可用，请重新登录并检查账号权限。', 'Sign-in or access is unavailable. Sign in again and check account access.') }
  let publication = input.current
  let refreshed = false
  // A failed response may follow a successful write; also recover stale CAS versions.
  try {
    const result = await input.readPublication()
    if (result.publication) { publication = result.publication; refreshed = true }
  } catch { /* Keep the last known state; never pretend a refresh succeeded. */ }
  if (input.activating && status === 409) {
    try {
      const { readiness } = await input.readReadiness()
      const messages = [...new Set(readiness.blockers)]
        .map((blocker) => blockerMessages[blocker]?.[language]).filter(Boolean)
      if (readiness.activationAvailable !== true && messages.length) return { publication, message: messages.join(' ') }
    } catch { /* Older/unreachable servers may not provide readiness. */ }
  }
  return { publication, message: status === 409
    ? refreshed
      ? choose('设置已变化，已刷新当前状态。请核对后重试。', 'Settings changed. The current state has been refreshed; review it and retry.')
      : choose('设置已变化，但刷新失败。请刷新名片后重试。', 'Settings changed, but refresh failed. Refresh the card before retrying.')
    : choose('无法确认设置是否保存，请检查网络并刷新名片后重试。', 'Could not confirm whether settings were saved. Check the network and refresh the card before retrying.') }
}
