// @arch docs/features/published-agent-direct-conversations.md

const labels = {
  zh: {
    agent_unavailable: '智能体不可用',
    agent_mode_unavailable: '此智能体模式尚不能对外执行',
    machine_unavailable: '电脑未配对',
    machine_offline: '电脑离线',
    runtime_unavailable: '运行 Agent 不可用或不支持当前执行模式',
    runtime_auth_unverified: '运行 Agent 登录状态未确认',
    runtime_protection_unverified: '运行时权限配置尚未验证',
    runtime_capability_gap: '运行时无法满足当前权限配置',
    runtime_permission_unconfirmed: '完整本机权限需要 Owner 对当前智能体权限配置确认',
  },
  en: {
    agent_unavailable: 'Agent unavailable',
    agent_mode_unavailable: 'This Agent mode cannot run publicly yet',
    machine_unavailable: 'Computer not paired',
    machine_offline: 'Computer offline',
    runtime_unavailable: 'Runtime unavailable or current execution mode unsupported',
    runtime_auth_unverified: 'Runtime sign-in status unverified',
    runtime_protection_unverified: 'Runtime permission configuration unverified',
    runtime_capability_gap: 'Runtime cannot satisfy the current permission policy',
    runtime_permission_unconfirmed: 'Owner must confirm full computer access for this Agent policy',
  },
} as const

export function publicationBlockerLabel(reason: string, language: string): string {
  const names = language.startsWith('zh') ? labels.zh : labels.en
  return names[reason as keyof typeof names] ?? reason
}
