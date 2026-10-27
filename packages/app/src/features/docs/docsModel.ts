export type DocsNavItem = {
  key: string
  titleKey: string
}

export type DocsNavSection = {
  key: string
  titleKey: string
  items: DocsNavItem[]
}

export const DOC_SECTIONS: DocsNavSection[] = [
  {
    key: 'start',
    titleKey: 'docs_nav_start',
    items: [
      { key: 'desktop-install', titleKey: 'docs_desktop_install_title' },
      { key: 'cli-install', titleKey: 'docs_cli_install_title' },
      { key: 'login-pairing', titleKey: 'docs_login_pairing_title' },
      { key: 'mobile-app', titleKey: 'docs_mobile_app_title' },
      { key: 'first-message', titleKey: 'docs_first_message_title' },
      { key: 'membership-credits', titleKey: 'docs_membership_credits_title' },
    ],
  },
  {
    key: 'agents',
    titleKey: 'docs_nav_agents',
    items: [
      { key: 'codex', titleKey: 'docs_codex_title' },
      { key: 'claude-code', titleKey: 'docs_claude_code_title' },
      { key: 'other-agents', titleKey: 'docs_other_agents_title' },
      { key: 'custom-agent', titleKey: 'docs_custom_agent_title' },
    ],
  },
  {
    key: 'capabilities',
    titleKey: 'docs_nav_capabilities',
    items: [
      { key: 'files', titleKey: 'docs_files_title' },
      { key: 'projects-sessions', titleKey: 'docs_projects_sessions_title' },
      { key: 'skills', titleKey: 'docs_skills_title' },
      { key: 'multi-device', titleKey: 'docs_multi_device_title' },
      { key: 'status-sync', titleKey: 'docs_status_sync_title' },
      { key: 'machines', titleKey: 'docs_machine_management_title' },
    ],
  },
  {
    key: 'support',
    titleKey: 'docs_nav_support',
    items: [
      { key: 'troubleshooting', titleKey: 'docs_troubleshooting_title' },
      { key: 'customer-support', titleKey: 'docs_customer_support_title' },
    ],
  },
]

export const DESKTOP_STEPS = [
  ['docs_desktop_step1_title', 'docs_desktop_step1_desc'],
  ['docs_desktop_step2_title', 'docs_desktop_step2_desc'],
  ['docs_desktop_step3_title', 'docs_desktop_step3_desc'],
] as const

export const FIRST_MESSAGE_STEPS = [
  ['docs_first_step1_title', 'docs_first_step1_desc'],
  ['docs_first_step2_title', 'docs_first_step2_desc'],
  ['docs_first_step3_title', 'docs_first_step3_desc'],
  ['docs_first_step4_title', 'docs_first_step4_desc'],
] as const

export const LOGIN_PAIRING_STEPS = [
  ['docs_login_pairing_step_desktop_title', 'docs_login_pairing_step_desktop_desc'],
  ['docs_login_pairing_step_cli_title', 'docs_login_pairing_step_cli_desc'],
  ['docs_login_pairing_step_online_title', 'docs_login_pairing_step_online_desc'],
] as const

export const MEMBERSHIP_CREDIT_CARDS = [
  ['docs_membership_credit_plan_title', 'docs_membership_credit_plan_desc'],
  ['docs_membership_credit_wechat_title', 'docs_membership_credit_wechat_desc'],
  ['docs_membership_credit_where_title', 'docs_membership_credit_where_desc'],
] as const

export const CODEX_AGENT_STEPS = [
  ['docs_codex_step_install_title', 'docs_codex_step_install_desc'],
  ['docs_codex_step_machine_title', 'docs_codex_step_machine_desc'],
  ['docs_codex_step_run_title', 'docs_codex_step_run_desc'],
] as const

export const CLAUDE_CODE_AGENT_STEPS = [
  ['docs_claude_code_step_install_title', 'docs_claude_code_step_install_desc'],
  ['docs_claude_code_step_machine_title', 'docs_claude_code_step_machine_desc'],
  ['docs_claude_code_step_run_title', 'docs_claude_code_step_run_desc'],
] as const

export const OTHER_AGENT_CARDS = [
  ['docs_other_agents_card_supported_title', 'docs_other_agents_card_supported_desc'],
  ['docs_other_agents_card_local_title', 'docs_other_agents_card_local_desc'],
  ['docs_other_agents_card_refresh_title', 'docs_other_agents_card_refresh_desc'],
] as const

export const CUSTOM_AGENT_FLOW = `# 1) capabilities discovery
my-agent /caps
{"name":"My Agent","models":["demo"],"defaultModel":"demo","mode":"spawn","resume":true}

# 2) one user turn
echo "review this project" | my-agent /run --workdir /path/to/project --session sn-123 --model demo
{"state":"delta","text":"Received. I am checking the project.\\n"}
{"state":"tool-call","name":"list_dir","args":{"path":"."}}
{"state":"tool-result","name":"list_dir","result":"README.md src/ package.json"}
{"state":"delta","text":"README.md needs a Quick Start section."}
{"state":"final","agentSessionId":"native-session-123","usage":{"inputTokens":42,"outputTokens":128}}`

export const CUSTOM_AGENT_MINIMAL_NODE = `#!/usr/bin/env node
const command = process.argv[2]

if (command === '/caps') {
  console.log(JSON.stringify({
    name: 'My Agent',
    models: ['demo'],
    defaultModel: 'demo',
    mode: 'spawn',
    resume: true,
    version: '1.0.0'
  }))
  process.exit(0)
}

if (command === '/run') {
  const input = await new Promise((resolve) => {
    let text = ''
    process.stdin.setEncoding('utf8')
    process.stdin.on('data', (chunk) => (text += chunk))
    process.stdin.on('end', () => resolve(text.trim()))
  })

  console.log(JSON.stringify({ state: 'delta', text: '收到：' + input + '\\n' }))
  console.log(JSON.stringify({ state: 'final', agentSessionId: 'demo-session' }))
  process.exit(0)
}

console.error('unknown command: ' + command)
process.exit(1)`

export const CUSTOM_AGENT_REGISTER = `chmod +x /absolute/path/my-agent.js
shennian agent add my-agent --command "node /absolute/path/my-agent.js"
shennian agent list
shennian stop && shennian start`

export const CUSTOM_AGENT_EVENT_TABLE = [
  ['delta', 'docs_custom_agent_event_delta'],
  ['final', 'docs_custom_agent_event_final'],
  ['error', 'docs_custom_agent_event_error'],
  ['tool-call', 'docs_custom_agent_event_tool_call'],
  ['tool-result', 'docs_custom_agent_event_tool_result'],
] as const

export const CUSTOM_AGENT_BOUNDARIES = [
  'docs_custom_agent_boundary_start',
  'docs_custom_agent_boundary_notify',
  'docs_custom_agent_boundary_internal',
] as const

export const CLI_COMMANDS = [
  ['shennian', 'docs_cmd_smart_start'],
  ['shennian pair', 'docs_cmd_pair'],
  ['shennian start', 'docs_cmd_start'],
  ['shennian stop', 'docs_cmd_stop'],
  ['shennian status', 'docs_cmd_status'],
  ['shennian logs -n 100', 'docs_cmd_logs'],
  ['shennian upgrade', 'docs_cmd_upgrade'],
] as const

export const AGENT_OVERVIEW_CARDS = [
  ['docs_codex_title', 'docs_codex_desc'],
  ['docs_claude_code_title', 'docs_claude_code_desc'],
] as const

export const CAPABILITY_CARDS = [
  ['docs_files_title', 'docs_files_intro'],
  ['docs_projects_sessions_title', 'docs_projects_sessions_desc'],
  ['docs_skills_title', 'docs_skills_desc'],
  ['docs_multi_device_title', 'docs_multi_device_desc'],
  ['docs_status_sync_title', 'docs_status_sync_desc'],
  ['docs_machine_management_title', 'docs_machine_management_desc'],
] as const

export const PROJECT_SESSION_CARDS = [
  ['docs_projects_sessions_card_workdir_title', 'docs_projects_sessions_card_workdir_desc'],
  ['docs_projects_sessions_card_session_title', 'docs_projects_sessions_card_session_desc'],
  ['docs_projects_sessions_card_context_title', 'docs_projects_sessions_card_context_desc'],
] as const

export const SKILL_CARDS = [
  ['docs_skills_card_install_title', 'docs_skills_card_install_desc'],
  ['docs_skills_card_call_title', 'docs_skills_card_call_desc'],
  ['docs_skills_card_repair_title', 'docs_skills_card_repair_desc'],
] as const

export const STATUS_SYNC_CARDS = [
  ['docs_status_sync_card_connection_title', 'docs_status_sync_card_connection_desc'],
  ['docs_status_sync_card_progress_title', 'docs_status_sync_card_progress_desc'],
  ['docs_status_sync_card_errors_title', 'docs_status_sync_card_errors_desc'],
] as const

export const MACHINE_MANAGEMENT_CARDS = [
  ['docs_machine_card_status_title', 'docs_machine_card_status_desc'],
  ['docs_machine_card_agents_title', 'docs_machine_card_agents_desc'],
  ['docs_machine_card_share_title', 'docs_machine_card_share_desc'],
] as const

export const SUPPORT_CARDS = [
  ['docs_fix_offline_title', 'docs_fix_offline_desc'],
  ['docs_fix_agent_title', 'docs_fix_agent_desc'],
  ['docs_fix_upgrade_title', 'docs_fix_upgrade_desc'],
] as const
