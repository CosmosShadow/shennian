// @arch open-source/docs/shared-runtime.md
// @test src/__tests__/i18n-reasoning-effort.test.ts

export const enDocsPart2 = {
  redeem_loading: 'Accepting…',
  view_only_hint: 'This machine is view-only',
  tab_install_machine: 'Install Machine',
  tab_accept_invite: 'Accept Invite',
  accept_invite_desc: 'Paste the invite code shared by a colleague to access their machine',
  changelog_v010:
    'Initial release · Claude / Codex / Nian support, built-in file system, full HTTPS encryption.',
  secure_https_wss: 'HTTPS + WSS',
  secure_jwt: 'JWT Auth',
  secure_zero_port: 'Zero Port Exposure',
  status_connecting: 'Connecting…',
  status_syncing: 'Syncing…',
  network_offline: 'No internet connection',
  chat_empty_hint: 'Send a message to start',
  long_screenshot: 'Long Screenshot',
  long_screenshot_generating: 'Generating long screenshot…',
  long_screenshot_failed_title: 'Screenshot Failed',
  long_screenshot_failed_message:
    'This conversation could not be rendered as an image. Try again later.',
  manager_wecom_entry: 'WeCom Link',
  manager_wecom_title: 'WeCom Link',
  manager_wecom_description:
    'Choose one WeCom group for this conversation. When enabled, the conversation receives group messages and can reply when allowed.',
  manager_wecom_enabled: 'Listen to group',
  manager_wecom_can_reply: 'Allow replies',
  manager_wecom_conversation: 'WeCom group',
  manager_wecom_conversation_none: 'None by default. Expand to choose.',
  manager_wecom_conversation_bound: 'Already linked',
  manager_wecom_expand_to_choose: 'Expand “WeCom group” to choose a group.',
  manager_wecom_sync_conversations: 'Refresh groups',
  manager_wecom_conversations_empty:
    'No WeCom groups yet. Bind WeCom in Settings first, then refresh groups.',
  manager_wecom_unsupported_title: 'This agent does not support WeCom link yet',
  manager_wecom_unsupported_desc:
    '{{agent}} cannot be linked to a WeCom group yet. Supported now: Project Manager, Codex, Claude Code, and Nian.',
  manager_wecom_no_account_title: 'No WeCom account bound',
  manager_wecom_no_account_desc:
    'Bind WeCom by scanning the QR code in Settings. Then you can choose one WeCom group here.',
  manager_wecom_manage_account: 'Manage account',
  manager_wecom_offline_title: 'WeCom is offline',
  manager_wecom_offline_desc:
    'Scan the QR code to log in again before group message intake and replies can resume.',
  manager_wecom_system_prompt: 'Additional system prompt',
  manager_wecom_system_prompt_default:
    'External replies should feel like a real chat message: brief, summarized, and single-paragraph. Do not use Markdown, numbered lists, bullets, line breaks, or literal \\n. When an external user explicitly asks who you are, where you come from, who built you, or who provides technical support, answer with the user-defined name, company, or role first; when appropriate, you may briefly add: “technical support provided by Shennian (shennian.net)”. Do not promote this in normal business replies.',
  manager_wecom_system_prompt_placeholder:
    'Example: only answer questions related to the Shennian project; ignore unrelated chatter; acknowledge long-running work in one short sentence first.',
  manager_wecom_load_failed: 'Failed to load WeCom config',
  manager_wecom_save_failed: 'Failed to save WeCom link',
  manager_wecom_save_success: 'WeCom link updated',
  manager_channel_connected: 'Connected',
  manager_channel_not_connected: 'Not connected',
  wecom_settings_title: 'WeCom',
  wecom_settings_entry_hint: 'Account & groups',
  wecom_settings_entry_unbound: 'Not bound',
  wecom_settings_entry_online: 'Bound online',
  wecom_settings_entry_offline: 'Bound offline',
  wecom_settings_enterprise_only: 'This account cannot use this page.',
  wecom_settings_bind_title: 'WeCom account',
  wecom_settings_bind_desc:
    'Bind an account to fetch WeCom groups and connect group messages to selected conversations.',
  wecom_settings_area_label: 'Login region',
  wecom_settings_area_title: 'Choose login region',
  wecom_settings_area_auto: 'Auto recommended',
  wecom_settings_area_hint:
    'Recommended from your current network. Choose the region where you usually use WeCom so the login reminder looks natural and the account stays more stable.',
  wecom_settings_not_configured:
    'QiWe API is not configured on the server, so QR binding cannot start yet.',
  wecom_settings_start_bind: 'Bind WeCom',
  wecom_settings_relogin: 'Log in to WeCom again',
  wecom_settings_refresh_qr: 'Refresh QR code',
  wecom_settings_qr_expired_title: 'QR code expired',
  wecom_settings_qr_expired_desc:
    'The QR code is short-lived. Refresh it and scan again to log in.',
  wecom_settings_load_failed: 'Failed to load WeCom',
  wecom_settings_start_failed: 'Failed to start WeCom binding',
  wecom_settings_verify_code_title: 'Enter phone verification code',
  wecom_settings_verify_code_desc:
    'If WeCom shows a new-device login reminder on your phone, enter the 6-digit code shown there to finish login.',
  wecom_settings_verify_code_placeholder: '6-digit code',
  wecom_settings_verify_code_invalid: 'Enter the 6-digit code shown on your phone.',
  wecom_settings_verify_failed: 'Failed to verify code',
  wecom_settings_sync_failed: 'Failed to refresh WeCom groups',
  wecom_settings_unbind_failed: 'Failed to unbind WeCom',
  wecom_settings_unbind_confirm:
    'Unbind this WeCom account? Linked conversations will stop working.',
  wecom_settings_unbind: 'Unbind',
  wecom_settings_sync: 'Refresh',
  wecom_settings_unnamed_account: 'WeCom account',
  wecom_settings_status: 'Status',
  wecom_settings_conversations: 'WeCom groups',
  wecom_settings_groups: 'WeCom Groups',
  wecom_settings_bound_session: '{{title}}',
  wecom_settings_bound: 'Linked',
  wecom_settings_unbound: 'Not linked',
  wecom_settings_open_session: 'Open',
  wecom_settings_unbind_conversation: 'Unlink',
  wecom_settings_unbind_conversation_confirm:
    'Unlink “{{name}}” from the current conversation? This group will stop receiving and sending messages.',
  wecom_settings_unbind_conversation_failed: 'Failed to unlink WeCom group',
  wecom_settings_bind_help_title: 'How to bind a conversation',
  wecom_settings_bind_hint:
    'Open a conversation from the conversation list, tap “…” in the top-right, then choose “WeCom Link” to bind a group. One group can link to one conversation, and one conversation can link to one group.',
  wecom_settings_conversations_empty:
    'No WeCom groups yet. Log in with QR code, then refresh groups.',
  wecom_settings_danger_title: 'Account actions',
  wecom_settings_danger_desc:
    'After unbinding, linked conversations will stop receiving and sending WeCom messages.',
  wecom_status_pending: 'Pending',
  wecom_status_pending_login: 'Waiting for QR scan',
  wecom_status_online: 'Online',
  wecom_status_offline: 'Offline',
  wecom_status_expired: 'QR code expired',
  wecom_conversation_group: 'Group',
  wecom_conversation_dm: 'Contact',
  feishu_settings_title: 'Feishu',
  feishu_settings_entry_unbound: 'Not configured',
  feishu_settings_entry_configured: 'Configured',
  wechat_rpa_settings_entry_desktop: 'Local channel',
  wechat_rpa_settings_entry_need_desktop: 'Desktop required',
  wechat_rpa_settings_need_desktop_title: 'Desktop required',
  wechat_rpa_settings_need_desktop_desc:
    'Use the local WeChat channel from a computer with Shennian Desktop installed.',
  wechat_rpa_settings_need_session_title: 'Open a local session first',
  wechat_rpa_settings_need_session_desc:
    'The WeChat channel must be linked to a Shennian session running on this computer.',
  wechat_rpa_dashboard_title: 'Let Agents Use WeChat',
  wechat_rpa_dashboard_desc:
    'Agents operate WeChat on your computer like a person: read messages, find chats, and send replies. Start with a Mac or Windows machine where WeChat is signed in.',
  wechat_rpa_dashboard_usage_hint:
    'To connect a WeChat conversation to an Agent, open that Shennian conversation and use the top-right External Channels menu. This page is the machine status dashboard.',
  wechat_rpa_dashboard_machines: 'Machines Agents Can Use',
  wechat_rpa_dashboard_refresh: 'Refresh status',
  wechat_rpa_dashboard_helper_checking: 'Checking WeChat on this machine…',
  wechat_rpa_binding_recheck_helper: 'Re-check / repair Helper',
  wechat_rpa_dashboard_ready_count: 'Ready',
  wechat_rpa_dashboard_needs_setup_count: 'Needs setup',
  wechat_rpa_dashboard_supported_count: 'Supported',
  wechat_rpa_dashboard_entry_ready: '{{ready}} ready',
  wechat_rpa_dashboard_entry_needs_setup: 'Needs setup',
  wechat_rpa_dashboard_entry_supported: 'Waiting for report',
  wechat_rpa_dashboard_entry_unavailable: 'No capable machine',
  wechat_rpa_other_machines_title: '{{count}} other machine(s)',
  wechat_rpa_other_machines_hint:
    'These systems cannot let agents operate WeChat yet, so only online status is shown.',
  wechat_rpa_machine_status_ready: 'Ready',
  wechat_rpa_machine_status_needs_setup: 'Needs setup',
  wechat_rpa_machine_status_unsupported: 'Unsupported',
  wechat_rpa_machine_status_offline: 'Offline',
  wechat_rpa_machine_status_disabled: 'Disabled',
  wechat_rpa_machine_status_unknown: 'Unknown',
  wechat_rpa_machine_status_error: 'Error',
  wechat_rpa_machine_reason_ready:
    'This machine is ready, so agents can send and read messages through local WeChat.',
  wechat_rpa_machine_reason_disabled: 'Disabled on this machine.',
  wechat_rpa_machine_reason_offline: 'Machine is offline; local WeChat cannot be checked.',
  wechat_rpa_machine_reason_unsupported_os: 'This system cannot let agents operate WeChat yet.',
  wechat_rpa_machine_reason_not_reported:
    'Machine is online but has not reported whether WeChat is usable yet. Refresh later or upgrade the connector.',
  wechat_rpa_machine_reason_wechat_not_installed: 'WeChat was not detected.',
  wechat_rpa_machine_reason_wechat_not_running: 'No running WeChat window was detected.',
  wechat_rpa_machine_reason_permission_missing:
    'Screen Recording, Accessibility, or Automation permission is missing.',
  wechat_rpa_machine_reason_helper_not_ready:
    'The local Helper is missing or version-incompatible.',
  wechat_rpa_machine_reason_runtime_error:
    'The latest check could not confirm agent access to WeChat.',
  wechat_rpa_machine_reason_unknown: 'No clear status has been reported yet.',
  wechat_rpa_machine_action_ready: 'No action needed.',
  wechat_rpa_machine_action_disabled: 'Turn it back on to resume checks.',
  wechat_rpa_machine_action_offline: 'Bring this machine online, then refresh.',
  wechat_rpa_machine_action_unsupported_os:
    'Use a Mac or Windows machine where WeChat is signed in.',
  wechat_rpa_machine_action_not_reported:
    'Refresh later. If it keeps happening, upgrade or restart the connector.',
  wechat_rpa_machine_action_wechat_not_installed: 'Install WeChat and sign in on this machine.',
  wechat_rpa_machine_action_wechat_not_running: 'Open WeChat, keep it signed in, then refresh.',
  wechat_rpa_machine_action_permission_missing:
    'Grant Screen Recording, Accessibility, and Automation permissions in system settings.',
  wechat_rpa_machine_action_helper_not_ready:
    'Install or repair Helper here. No manual command-line install is required.',
  wechat_rpa_machine_action_runtime_error: 'Handle the recent error, then refresh status.',
  wechat_rpa_machine_action_unknown:
    'Refresh later. If it stays unknown, restart the local connector.',
  wechat_rpa_machine_current_status: 'Status',
  wechat_rpa_machine_suggested_action: 'Action',
  wechat_rpa_machine_runtime_settings: 'How agents use WeChat',
  wechat_rpa_machine_runtime_settings_hint: 'Controls how agents use WeChat on this machine',
  wechat_rpa_machine_last_checked: 'Last checked: {{time}}',
  wechat_rpa_machine_last_checked_label: 'Last checked',
  wechat_rpa_machine_not_checked: 'Not checked',
  feishu_settings_enterprise_only:
    'Feishu integration is an enterprise capability and is not available for this account.',
  feishu_settings_bind_title: 'Feishu custom app',
  feishu_settings_bind_desc:
    'Enter the App ID / App Secret from your Feishu custom app. Shennian receives Feishu events by callback and routes them to the linked conversation.',
  feishu_settings_display_name: 'Display name',
  feishu_settings_secret_placeholder: 'Leave blank to keep the current secret',
  feishu_settings_secret_configured: '•••••••• Configured',
  feishu_settings_callback_url: 'Event callback URL',
  feishu_settings_callback_copied: 'Callback URL copied',
  feishu_settings_setup_hint:
    'In Feishu Open Platform, choose event subscription callback mode, not long connection. Paste the URL above and subscribe to message receive events. See “Setup guide” for permissions.',
  feishu_settings_test_connection: 'Test connection',
  feishu_settings_test_success: 'Feishu connection works',
  feishu_settings_test_partial: 'Feishu connection needs permissions',
  feishu_settings_test_success_desc:
    'Bot detected: {{name}}. {{count}} conversations are readable now.',
  feishu_settings_test_failed: 'Feishu connection test failed',
  feishu_settings_help: 'Setup guide',
  feishu_help_title: 'How to configure Feishu',
  feishu_help_create_title: 'Create app and get credentials',
  feishu_help_create_1: 'Create an enterprise custom app in Feishu Open Platform.',
  feishu_help_create_2: 'Open “Credentials and basic info”, then copy App ID and App Secret.',
  feishu_help_create_3:
    'Paste App ID / App Secret into Shennian. The secret is not shown again after saving.',
  feishu_help_callback_title: 'Configure event callback',
  feishu_help_callback_1:
    'Save App ID / App Secret first, then copy the event callback URL. The URL includes accountId and the server validates Feishu app_id.',
  feishu_help_callback_2:
    'In Feishu event subscription, choose callback/request URL mode, not long connection.',
  feishu_help_callback_3: 'Subscribe to im.message.receive_v1, then publish or reinstall the app.',
  feishu_help_permissions_title: 'Grant permissions',
  feishu_help_permissions_1:
    'Enable bot capability so the bot can be added to groups or receive direct messages.',
  feishu_help_permissions_2:
    'In permission management, search and grant im: permissions for messaging, reading conversations, and reading/uploading images and files.',
  feishu_help_permissions_3: 'Publish or reinstall the app after permission changes.',
  feishu_help_test_title: 'Test send and receive',
  feishu_help_test_1:
    'Click “Test connection” to check credentials, bot info, conversation list, and sending permission.',
  feishu_help_test_2: 'Group test: add the bot to a group and @ it with a message.',
  feishu_help_test_3:
    'DM test: send a direct message to the bot. Direct messages do not require @, but the Feishu conversation must be linked in Shennian.',
  feishu_settings_groups: 'Feishu conversations',
  feishu_settings_groups_hint:
    'Refresh syncs groups and visible conversations. Group chats handle @bot messages by default; direct messages enter the linked conversation directly.',
  feishu_settings_conversations_empty:
    'No Feishu conversations yet. Add the bot to a group or DM it, grant conversation-list permission, then refresh.',
  feishu_settings_load_failed: 'Failed to load Feishu config',
  feishu_settings_save_failed: 'Failed to save Feishu config',
  feishu_settings_save_success: 'Feishu config saved',
  feishu_settings_sync_failed: 'Failed to refresh Feishu groups',
  feishu_settings_delete: 'Delete Feishu config',
  feishu_settings_delete_confirm:
    'Delete this Feishu app config? Linked conversations will stop working.',
  feishu_settings_delete_failed: 'Failed to delete Feishu config',
  feishu_settings_unbind_conversation: 'Unlink',
  feishu_settings_unbind_conversation_confirm: 'Unlink “{{name}}” from this conversation?',
  feishu_settings_unbind_conversation_failed: 'Failed to unlink Feishu group',
  feishu_status_configured: 'Configured',
  manager_external_entry: 'External Channels',
  manager_external_title: 'External Messages',
  manager_external_choose_conversation: 'Choose the group or direct chat on a full page.',
  manager_external_provider: 'Source',
  manager_external_provider_wecom: 'WeCom',
  manager_external_provider_feishu: 'Feishu',
  manager_external_provider_wechat_rpa: 'Use WeChat',
  manager_external_provider_wechat_rpa_short: 'WeChat',
  manager_external_enabled: 'Listen to conversation',
  manager_external_can_reply: 'Allow replies',
  manager_feishu_description:
    'Choose one Feishu group or direct chat for this conversation. Group chats handle @bot messages by default; direct messages enter the conversation directly.',
  manager_feishu_no_account_title: 'No Feishu app configured',
  manager_feishu_no_account_desc:
    'Configure a Feishu custom app in Settings, then add the bot to a group or DM it.',
  manager_feishu_conversation: 'Feishu conversation',
  manager_feishu_conversations_empty:
    'No Feishu conversations yet. Configure Feishu in Settings, add the bot to a group or DM it, then refresh.',
  manager_feishu_load_failed: 'Failed to load Feishu config',
  manager_feishu_save_failed: 'Failed to save Feishu link',
  manager_feishu_save_success: 'Feishu link updated',
  manager_external_listen_mode: 'Listen mode',
  manager_external_listen_mention_only: 'Only @bot',
  manager_external_listen_all_messages: 'All messages',
  manager_external_prompt_hint:
    'This is appended after the built-in external-channel guardrails. Use it only for business scope, naming, and special constraints.',
  manager_wechat_rpa_description:
    'Connect this Shennian session to WeChat on the same computer. The Agent uses WeChat like a person: it opens the named conversation, reads new messages, and replies when needed.',
  manager_wechat_rpa_unavailable_title: 'No available WeChat machine',
  manager_wechat_rpa_unavailable_desc:
    'Sign in to WeChat on a Mac or Windows computer and keep the Shennian connector online.',
  manager_wechat_rpa_machine: 'Current session computer',
  manager_wechat_rpa_session: 'Current Shennian session',
  manager_wechat_rpa_current_machine: 'Current session computer',
  manager_wechat_rpa_current_session: 'Current Shennian session',
  manager_wechat_rpa_no_current_machine_title: 'Current session computer not found',
  manager_wechat_rpa_no_current_machine_desc:
    'Make sure this Shennian session still exists and its computer is paired.',
  manager_wechat_rpa_no_session_title: 'Current Shennian session not found',
  manager_wechat_rpa_no_session_desc:
    'Open this page from a Shennian session: External channels → Use WeChat.',
  manager_wechat_rpa_current_machine_ready:
    'This computer is ready. The Agent can use WeChat on it.',
  manager_wechat_rpa_current_machine_unsupported:
    'The computer for this session cannot use WeChat. Start the session on a Mac or Windows computer that supports WeChat, then bind it again.',
  manager_wechat_rpa_current_machine_offline:
    'The computer for this session is offline, so its WeChat cannot be used right now.',
  manager_wechat_rpa_current_machine_disabled:
    'Use WeChat is turned off on this computer. Turn it on from the machine page first.',
  manager_wechat_rpa_current_machine_wechat_not_running:
    'This computer does not have a running, signed-in WeChat instance.',
  manager_wechat_rpa_current_machine_permission_missing:
    'This computer is missing Screen Recording, Accessibility, or Automation permission.',
  manager_wechat_rpa_current_machine_helper_not_ready:
    'The Helper on this computer is not ready yet.',
  manager_wechat_rpa_current_machine_not_ready:
    'This computer’s WeChat capability is not ready. Fix it from the Use WeChat machine page first.',
  manager_wechat_rpa_current_machine_unavailable_short: 'This computer cannot use WeChat right now',
  manager_wechat_rpa_machine_unavailable_title: 'This computer cannot use WeChat right now',
  manager_wechat_rpa_groups: 'WeChat conversation name',
  manager_wechat_rpa_groups_placeholder: 'For example: Alice / Family group / Client A',
  manager_wechat_rpa_groups_hint:
    'Enter the conversation name shown in WeChat’s left conversation list.',
  manager_wechat_rpa_conversation_required_title: 'WeChat conversation name required',
  manager_wechat_rpa_conversation_required_desc:
    'Enter the conversation name shown in WeChat’s left conversation list.',
  manager_wechat_rpa_conversation_required_inline: 'Enter one WeChat conversation name',
  manager_wechat_rpa_enabled: 'Enabled',
  manager_wechat_rpa_status_enabled:
    'Enabled. The Agent can use local WeChat for this conversation.',
  manager_wechat_rpa_status_pending_save: 'After saving, the Agent will start using local WeChat.',
  manager_wechat_rpa_status_disabled: 'This WeChat conversation is paused.',
  manager_wechat_rpa_status_unavailable: 'This computer cannot use WeChat right now.',
  manager_wechat_rpa_save_failed_title: 'Failed to save WeChat link',
  wechat_rpa_binding_machine_online: 'Online',
  wechat_rpa_binding_machine_offline: 'Offline',
  manager_wechat_rpa_connection_status: 'Needs attention',
  manager_wechat_rpa_group_blocked_title: 'WeChat conversation unavailable',
  manager_wechat_rpa_group_blocked_desc:
    'Personal WeChat RPA cannot bind these conversations yet: {{groups}}',
  manager_wechat_rpa_group_blocked_inline: 'Unavailable WeChat conversations: {{groups}}',
  manager_wechat_rpa_single_group_title: 'Only one WeChat conversation name can be bound',
  manager_wechat_rpa_single_group_desc:
    'Each Shennian conversation can currently soft-bind one WeChat conversation name. Keep one name before saving.',
  manager_wechat_rpa_single_group_inline:
    'This Shennian conversation can bind only one WeChat conversation',
  manager_wechat_rpa_enterprise_only_title: 'Pro or Team required',
  manager_wechat_rpa_enterprise_only_desc:
    'Use WeChat requires Pro / Team entitlements and available credits.',
  manager_wechat_rpa_pro_only_title: 'Pro or Team required',
  manager_wechat_rpa_pro_only_desc:
    'Use WeChat requires Pro / Team entitlements. Upgrade your plan or join an active Team first.',
  manager_wechat_rpa_credits_required_title: 'Credits required',
  manager_wechat_rpa_credits_required_desc:
    'Agent Use WeChat consumes credits. Buy a credit pack on Web or Desktop to continue.',
  manager_wechat_rpa_product_gate_title: 'Production enablement checks',
  manager_wechat_rpa_product_gate_mac: 'This stage supports macOS and Windows desktop WeChat.',
  manager_wechat_rpa_product_gate_enterprise:
    'Use WeChat requires Pro / Team entitlements and available credits.',
  manager_wechat_rpa_product_gate_same_machine:
    'Settings can be changed from Web or desktop; WeChat automation runs on the machine that owns this session.',
  manager_wechat_rpa_product_gate_local_files:
    'Attachments stay local; the server does not store original WeChat files.',
  manager_wechat_rpa_privacy_consent: 'I understand the data and privacy notice',
  manager_wechat_rpa_privacy_consent_hint:
    'When enabled, Shennian captures the local WeChat window to detect new messages. Server decisions are per-request and do not retain screenshots, crops, or original attachments.',
  manager_wechat_rpa_privacy_required_title: 'Privacy notice required',
  manager_wechat_rpa_privacy_required_desc:
    'Confirm the WeChat channel data and privacy notice before enabling listening.',
  manager_wechat_rpa_poll_interval: 'Poll interval (seconds)',
  manager_wechat_rpa_poll_interval_hint:
    'Default is 60 seconds. Allowed range is 30 to 300 seconds. The first scan only builds a baseline and does not ingest history.',
  manager_wechat_rpa_idle_seconds: 'Idle seconds',
  manager_wechat_rpa_policy: 'RPA policy',
  manager_wechat_rpa_force_foreground: 'Allow foregrounding WeChat',
  manager_wechat_rpa_force_foreground_hint:
    'Briefly brings WeChat forward only while the user is idle; off skips runs during user activity.',
  manager_wechat_rpa_self_nickname: 'Your WeChat nickname',
  manager_wechat_rpa_self_nickname_placeholder: 'For example: 李辰',
  manager_wechat_rpa_self_nickname_hint:
    'Used to detect whether group messages @ mention you. Separate multiple names with commas.',
  manager_wechat_rpa_permissions: 'WeChat permissions',
  manager_wechat_rpa_preflight: 'Preflight checks',
  manager_wechat_rpa_preflight_mac_only: 'macOS WeChat only.',
  manager_wechat_rpa_preflight_platform_unsupported: 'macOS or Windows desktop WeChat is required.',
  manager_wechat_rpa_preflight_enterprise_required: 'Pro / Team entitlement is required.',
  manager_wechat_rpa_preflight_pro_required: 'Pro / Team entitlement is required.',
  manager_wechat_rpa_preflight_credits_required:
    'Available credits are required. Buy a credit pack on Web or Desktop.',
  manager_wechat_rpa_preflight_privacy_consent_required:
    'Data and privacy notice must be confirmed.',
  manager_wechat_rpa_preflight_server_decision_unavailable:
    'Server decision capability must be available.',
  manager_wechat_rpa_preflight_same_machine_required:
    'WeChat and the Agent/session must be on the same machine.',
  manager_wechat_rpa_preflight_local_agent_unavailable: 'Local Agent is unavailable.',
  manager_wechat_rpa_preflight_helper_not_ready:
    'Platform helper or permission status is not ready.',
  manager_wechat_rpa_preflight_permission_screen_recording_missing:
    'Screen Recording permission is required.',
  manager_wechat_rpa_preflight_permission_accessibility_missing:
    'Accessibility permission is required.',
  manager_wechat_rpa_preflight_permission_automation_missing: 'Automation permission is required.',
  manager_wechat_rpa_preflight_wechat_not_running: 'WeChat is not running.',
  manager_wechat_rpa_preflight_wechat_window_unavailable: 'WeChat window is unavailable.',
  manager_wechat_rpa_preflight_wechat_window_unresponsive:
    'WeChat is not responding. Automation is paused. Restore or sign in to WeChat manually, then retry.',
  manager_wechat_rpa_preflight_wechat_recovery_failed:
    'WeChat needs manual recovery. Restart or sign in to WeChat, then retry.',
  manager_wechat_rpa_preflight_wechat_single_main_window_required:
    'WeChat window state needs confirmation. Keep WeChat visible and let Shennian re-check it visually.',
  manager_wechat_rpa_preflight_pending_server_decision:
    'Server decision is pending; waiting for the next retry.',
  manager_wechat_rpa_preflight_network_unavailable: 'Network is unavailable; waiting to retry.',
  manager_wechat_rpa_preflight_waiting_retry: 'Waiting for the next retry.',
  manager_wechat_rpa_preflight_unknown: 'Unknown check.',
  manager_wechat_rpa_request_screen_recording: 'Allow Screen Recording',
  manager_wechat_rpa_screen_recording_granted: 'Screen Recording permission is granted.',
  manager_wechat_rpa_screen_recording_opened_settings:
    'Allow Shennian to use Screen Recording in System Settings.',
  manager_wechat_rpa_screen_recording_failed_title: 'Could not request Screen Recording permission',
  manager_wechat_rpa_permission_screen_recording: 'Screen Recording',
  manager_wechat_rpa_permission_accessibility: 'Accessibility',
  manager_wechat_rpa_permission_automation: 'Automation',
  manager_wechat_rpa_permission_granted: 'Granted',
  manager_wechat_rpa_permission_denied: 'Denied',
  manager_wechat_rpa_permission_restricted: 'Restricted',
  manager_wechat_rpa_permission_not_determined: 'Not determined',
  manager_wechat_rpa_permission_unknown: 'Check needed',
  manager_wechat_rpa_download_attachments: 'Auto-download attachments',
  manager_wechat_rpa_download_attachments_hint:
    'When image, video, or file bubbles are detected, try downloading them locally so the Agent can read them.',
  manager_wechat_rpa_download_attachments_dir: 'Attachment save directory',
  manager_wechat_rpa_download_attachments_dir_placeholder:
    'Leave blank for .uploads/wechat-rpa/inbound',
  manager_wechat_rpa_runtime: 'Runtime status',
  manager_wechat_rpa_state: 'Current state',
  manager_wechat_rpa_state_idle_waiting: 'Waiting for idle',
  manager_wechat_rpa_state_syncing: 'Syncing',
  manager_wechat_rpa_state_interrupted: 'Interrupted by user',
  manager_wechat_rpa_state_retrying: 'Retrying pending replies',
  manager_wechat_rpa_state_cooldown: 'Cooling down',
  manager_wechat_rpa_last_run: 'Last poll',
  manager_wechat_rpa_last_message: 'Last message',
  manager_wechat_rpa_last_interrupted: 'Last interruption',
  manager_wechat_rpa_pending_replies: 'Pending replies',
  manager_wechat_rpa_last_error: 'Last error',
  manager_wechat_rpa_last_run_id: 'Last runId',
  manager_wechat_rpa_last_trace_summary: 'Last trace summary',
  manager_wechat_rpa_last_trace: 'Last trace',
  manager_wechat_rpa_recent_tasks: 'Recent task summaries',
  manager_wechat_rpa_sync_now: 'Sync now',
  manager_wechat_rpa_save_success: 'Personal WeChat channel updated',
  enterprise_service_title: 'Enterprise Service',
  enterprise_service_badge: 'Contact us',
  enterprise_service_enabled_badge: 'Enabled',
  enterprise_service_headline: 'A team workspace for AI Agents',
  enterprise_service_desc:
    'After enabling Team, you can invite members, assign machines, retain shared sessions, and view basic activity records and usage analytics.',
  enterprise_service_manager_agent_title: 'Agent Manager / Project Manager',
  enterprise_service_machine_sharing_title: 'Multi-machine and multi-account sharing',
  enterprise_service_wecom_title: 'WeCom integration',
  enterprise_service_support_title: 'Members and machine access',
  enterprise_service_support_desc:
    'Members join by invite code with no machine access by default. Admins assign machines and can revoke access when contractors or employees leave.',
  enterprise_service_rnd_title: 'Shared team sessions',
  enterprise_service_rnd_desc:
    'Sessions on shared machines are visible to assigned members, while other people’s conversations are read-only to prevent accidental operation.',
  enterprise_service_docs_title: 'Basic audit and analytics',
  enterprise_service_docs_desc:
    'See who did what, when, and which machine was involved, plus 7-day counts for events, active members, and active machines.',
  enterprise_service_contact_title: 'Contact enterprise support',
  enterprise_service_qr_hint:
    'Scan the WeChat QR code and tell us your business scenario. We will help evaluate and enable enterprise service.',
  enterprise_service_feature_machine_sharing:
    'Team is ¥199/month including 5 members, and includes Pro plus organization, machine assignment, team sessions, audit, and analytics.',
  enterprise_service_feature_manager_agent:
    'Agent Manager breaks down work like a project manager, dispatches Agents, and tracks multiple workstreams.',
  enterprise_service_feature_wecom: '',
  enterprise_service_feature_support:
    'We help configure members, machines, groups, Agents, and permissions around your workflow.',
  file_preview: 'File Preview',
  back_to_list: 'Back',
  download: 'Download',
  download_started: 'Started downloading {{name}}',
  download_started_browser:
    'Sent {{name}} to the browser download manager (location follows browser settings)',
  download_saved_to_selected_location: '{{name}} was saved to the selected location',
  download_saved_to_downloads: '{{name}} was saved to Downloads',
  download_opened_save_sheet: 'Opened the system save sheet for {{name}}',
  download_canceled: 'Canceled downloading {{name}}',
  download_failed: 'Download failed: {{name}}',
  download_failed_with_reason: 'Download failed: {{name}} ({{reason}})',
  creating_zip: 'Creating ZIP for {{name}}…',
  folder_download_failed: 'Folder download failed',
  folder_download_requires_update:
    'This machine needs a newer Shennian CLI to download folders as ZIP files.',
  download_markdown_format_title: 'Download Markdown',
  download_markdown_format_message: 'Choose how to download {{name}}.',
  download_markdown_format_prompt:
    'Export {{name}} as PDF? Choose Cancel to download the Markdown source.',
  download_markdown_source: 'Markdown source',
  export_pdf: 'Export PDF',
  exporting_pdf: 'Exporting PDF for {{name}}…',
  export_pdf_failed: 'PDF export failed',
  pdf_setup_required_title: 'PDF export needs setup',
  pdf_setup_required_message:
    '{{name}} needs a PDF export component on this machine. Shennian can download a managed Chromium browser without sudo, then retry.',
  pdf_setup_required_prompt:
    '{{name}} needs a PDF export component on this machine. Click OK to let Shennian download a managed Chromium browser and retry. Click Cancel to choose Markdown source.',
  pdf_setup_download_markdown_prompt: 'Download the Markdown source for {{name}} instead?',
  pdf_setup_auto_repair: 'Auto repair',
  pdf_setup_repairing: 'Installing PDF export component…',
  pdf_setup_repair_failed: 'Failed to install PDF export component',
  image_options: 'Image',
  view_image: 'View Full Image',
  image_saved_to_library: '{{name}} was saved to Photos',
  media_saved_to_library: 'Saved to Photos',
  media_save_permission_denied: 'Photos access is required to save images or videos',
  image_save_failed: 'Failed to save image: {{name}}',
  insert_ref: 'Insert @ref',
  file_ref_inserted: 'Referenced {{name}}',
  file_too_large_preview: 'File too large to preview ({{size}})',
  preview_not_supported: 'Cannot preview this file type',
  download_to_view: 'Download to view',
  html_preview: 'HTML Preview',
  source_code: 'Source Code',
  search_files: 'Search files…',
  file_ref_title: '@Reference File',
  lines_truncated: '(Truncated, showing first {{lines}} lines)',
  resources_notice: 'Note: Local resource references may not load',
  upload: 'Upload File',
  uploading_file: 'Uploading…',
  show_hidden_files: 'Show hidden files',
  hide_hidden_files: 'Hide hidden files',
  file_ai_improve: 'Improve',
  file_ai_formal: 'Formal',
  file_ai_shorter: 'Shorter',
  file_ai_longer: 'Expand',
  file_ai_translate_zh: 'To Chinese',
  file_ai_translate_en: 'To English',
  file_ai_summarize: 'Summarize',
  file_ai_sent: 'Sent AI edit for {{name}}',
  file_selection_quote: 'Quote',
  file_selection_quote_inserted: 'Inserted quote: {{name}}',
  edit_markdown: 'Edit Markdown',
  preview_mode: 'Preview',
  markdown_editing: 'Editing Markdown',
  file_saved: 'Saved {{name}}',
  file_save_failed: 'Failed to save file',
  onboarding_skip: 'Skip',
  onboarding_next: 'Continue',
  onboarding_start: 'Get Started',
  onboarding_website_hint: 'Need desktop, web, or the full setup guide?',
  onboarding_website_link: 'Visit website',
  onboarding_title_1: 'One Control Plane for All Your AI Agents',
  onboarding_desc_1:
    'Connect from phone, Web, or desktop and manage Claude Code, Codex, Cursor, OpenCode, Nian, and custom agents across machines',
  onboarding_title_2: 'One Command, Scan to Pair',
  onboarding_desc_2:
    'Install and run shennian on each machine, scan the QR code or paste the token — done in 30 seconds',
  onboarding_title_3: 'Secure, Real-time, Cross-platform',
  onboarding_desc_3:
    'End-to-end encrypted · Push notifications · iOS / Android / Web / Mac / Windows / Linux',
  nian_quota_exceeded: 'Nian daily quota is used up and will reset tomorrow.',
  docs_help_link: 'Documentation',
  privacy_title: 'Privacy Policy',
  privacy_updated: 'Last updated and effective: September 17, 2026',
  support_title: 'Support',
  support_subtitle: "Need help? We're here for you.",
  support_email_title: 'Email',
  support_github_title: 'GitHub Issues',
  support_github_desc: 'Report bugs or request features',
} as const
