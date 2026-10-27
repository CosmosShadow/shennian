// @arch open-source/docs/shared-runtime.md
// @test src/__tests__/i18n-reasoning-effort.test.ts

export const enDocsPart1 = {
  docs_page_title: 'Documentation',
  docs_quickstart: 'Quick Start',
  docs_install: 'Installation',
  docs_pairing: 'Pairing Devices',
  docs_first_msg: 'Send Your First Message',
  docs_cli_ref: 'CLI Reference',
  docs_custom_agent: 'Custom Agent Integration',
  docs_changelog: 'Changelog',
  docs_coming_soon: 'Documentation is being written. Check back soon.',
  docs_back_home: 'Back to Home',
  docs_nav_start: 'Start',
  docs_nav_daily: 'Daily Use',
  docs_nav_agents: 'Use Agents',
  docs_nav_capabilities: 'Core Capabilities',
  docs_nav_wechat: 'Agent Uses WeChat',
  docs_nav_support: 'Troubleshooting',
  docs_nav_advanced: 'Advanced',
  docs_overview_badge: 'For everyday users',
  docs_overview_title: 'Connect your first computer with Shennian',
  docs_overview_intro:
    'Install the desktop app and sign in. Shennian checks and prepares the local service automatically. Once ready, you can pick this computer from your phone, browser, or desktop app and control Claude Code, Codex, OpenCode, Nian, and other Agents.',
  docs_download_desktop: 'Download desktop app',
  docs_desktop_image_alt: 'Shennian desktop console screenshot',
  docs_desktop_install_title: 'Desktop install',
  docs_desktop_install_intro:
    'Use the desktop app for ordinary computers. Download the installer for your system from shennian.net, open it, and sign in. The desktop app adds this computer to your account and checks the Shennian Client, background connection, Node.js runtime, and common Agent CLIs.',
  docs_desktop_title: 'Install and auto-configure',
  docs_desktop_intro:
    'For most users, the desktop app is the default path. After you sign in, it adds this computer to your account and checks the Shennian Client, background connection, and common Agent CLIs. If something is missing, it moves into the automatic setup flow so you do not have to live in a terminal.',
  docs_method_desktop_title: 'Desktop app',
  docs_method_desktop_desc:
    'Best for Mac, Windows, and Linux desktops. Use .deb or AppImage on graphical Linux; use the CLI for servers, SSH boxes, and headless machines.',
  docs_method_cli_title: 'Command line',
  docs_method_cli_desc:
    'Best for servers, NAS boxes, headless machines, and developers who want to manage the daemon themselves.',
  docs_method_ai_title: 'Ask an AI to install it',
  docs_method_ai_desc:
    'Send the install guide link to Claude, Codex, or Cursor and let it install the CLI and check your computer before pairing.',
  docs_desktop_step1_title: 'Download and open the desktop app',
  docs_desktop_step1_desc:
    'Install Shennian from the website, open it, and sign in. Phone, Web, and desktop all use the same account.',
  docs_desktop_step2_title: 'Wait for automatic setup',
  docs_desktop_step2_desc:
    'The desktop app checks the local Shennian Client, background connection, Node.js runtime, and common Agent clients such as Claude Code, Codex, and OpenCode.',
  docs_desktop_step3_title: 'Use it from any device',
  docs_desktop_step3_desc:
    'When setup is done, the computer appears in your machine list. Pick it from your phone, browser, or desktop app, launch an Agent, and send a task.',
  docs_desktop_tip:
    'Servers and pure command-line machines still use CLI pairing. Desktop auto-setup is mainly for everyday computers.',
  docs_cli_install_title: 'Command-line install',
  docs_cli_install_intro:
    'Use the CLI for servers, NAS devices, SSH boxes, and headless machines. It requires Node.js 18 or later. After installation, run shennian to scan or paste a pairing token and start the background daemon.',
  docs_login_pairing_title: 'Sign-in and pairing',
  docs_login_pairing_desc:
    'Phone, Web, and desktop use the same account. Desktop machines join by signing in; CLI machines join by scanning a QR code or pasting a token. Pair once, then the daemon reconnects automatically.',
  docs_login_pairing_step_desktop_title: 'Sign in on desktop',
  docs_login_pairing_step_desktop_desc:
    'Open Shennian Desktop on the target computer and sign in. Phone, Web, and desktop clients on the same account will see this machine.',
  docs_login_pairing_step_cli_title: 'Pair a CLI machine',
  docs_login_pairing_step_cli_desc:
    'Run shennian on the target machine to get a QR code and an sn- pairing token, then scan or paste it from the phone app or Web.',
  docs_login_pairing_step_online_title: 'Confirm it is online',
  docs_login_pairing_step_online_desc:
    'When the machine is online, you can choose it from any device, start Agents, resume sessions, and browse files.',
  docs_login_pairing_tip:
    'Run shennian pair again only after the machine was removed, the token expired, or the account changed. For daily troubleshooting, start with shennian status and logs.',
  docs_mobile_app_title: 'Phone App / Web control',
  docs_mobile_app_desc:
    'Once a computer is online, you can control the same Agent session from phone, browser, or desktop. The Agent still runs on the original computer; Shennian syncs the session, status, files, and actions to the current device.',
  docs_mobile_app_image_alt: 'Shennian session list screenshot',
  docs_mobile_app_card_title: 'Sessions follow your account',
  docs_mobile_app_card_desc:
    'The Agent still runs on the original computer; Shennian connects phone, browser, and desktop to the same control surface.',
  docs_first_message_title: 'Send your first message',
  docs_first_message_intro:
    'Daily use comes down to three actions: choose a machine, choose an Agent, and send a message. Confirm the working directory and type the task like a chat message; output, tool calls, and progress stream back into Shennian.',
  docs_machines_image_alt: 'Shennian machine list screenshot',
  docs_machines_title: 'Choose an online machine',
  docs_machines_short:
    'The machine list shows status, operating system, version, and available Agents for each computer. Choose the machine first, then decide who should do the work.',
  docs_first_step1_title: 'Choose a machine',
  docs_first_step1_desc:
    'Open My Machines and pick an online computer. After desktop auto-setup completes, it appears here automatically.',
  docs_first_step2_title: 'Choose an Agent',
  docs_first_step2_desc:
    'Pick Claude Code, Codex, OpenCode, Nian, or another connected Agent, then confirm the working directory.',
  docs_first_step3_title: 'Send a message',
  docs_first_step3_desc:
    'Type the task like a chat message. Agent output, tool calls, and progress stream back into Shennian.',
  docs_first_step4_title: 'Take over anytime',
  docs_first_step4_desc:
    'When you leave your desk, continue from your phone: add instructions, review results, and download files while the task keeps running on the original computer.',
  docs_membership_credits_title: 'Plans and credits',
  docs_membership_credits_desc:
    'Basic installation, pairing, and remote control can be completed first. Some capabilities check plan and credit status, such as Agent Uses WeChat, which requires Pro / Team entitlement and available credits.',
  docs_membership_credit_plan_title: 'Check your plan',
  docs_membership_credit_plan_desc:
    'Profile → Billing shows your current plan, available credits, and purchase options.',
  docs_membership_credit_wechat_title: 'WeChat requires entitlement',
  docs_membership_credit_wechat_desc:
    'The Use WeChat machine dashboard checks account conditions. If it asks for Pro / Team or more credits, handle billing first.',
  docs_membership_credit_where_title: 'Team and organization access',
  docs_membership_credit_where_desc:
    'Team, organization, and machine-permission entries live under Profile → Space and permissions for shared-machine management.',
  docs_membership_credits_tip:
    'Credits are used by consumption-based capabilities such as multimodal recognition, structured reads, and external-message send confirmation. Ordinary remote control is not billed per message.',
  docs_machines_intro:
    'Machines are the first layer of Shennian. Put your office computer, home computer, servers, and shared machines in one list so you always know what is online and which Agents are available.',
  docs_chat_image_alt: 'Shennian mobile chat screenshot',
  docs_chat_title: 'One chat surface for different Agents',
  docs_chat_desc:
    'The same conversation view shows replies, progress, and tool calls. You can ask the Agent to continue, add context, or switch to files to inspect the result.',
  docs_nian_title: 'Use built-in Agent Nian',
  docs_nian_desc:
    'Nian is Shennian’s built-in Agent. It does not require a third-party local CLI and is useful for quick questions, content cleanup, lightweight tasks, and install guidance.',
  docs_nian_image_alt: 'Shennian Nian conversation screenshot',
  docs_nian_card_title: 'No extra CLI required',
  docs_nian_card_desc:
    'After signing in, you can use the built-in Agent immediately for first-time experience and lightweight daily work.',
  docs_codex_title: 'Use Codex',
  docs_codex_desc:
    'Codex is useful for code edits, project understanding, test fixes, and engineering tasks. Shennian syncs Codex output, tool calls, and progress from the original computer to phone, Web, and desktop.',
  docs_codex_step_install_title: 'Prepare Codex CLI on the target computer',
  docs_codex_step_install_desc:
    'Install and sign in to Codex using its official flow, then confirm that codex runs directly in the local terminal.',
  docs_codex_step_machine_title: 'Choose an online machine in Shennian',
  docs_codex_step_machine_desc:
    'Once the machine is online, Shennian detects available Agents and models. Choose Codex and confirm the working directory.',
  docs_codex_step_run_title: 'Send engineering work',
  docs_codex_step_run_desc:
    'Describe the edit, investigation, or test task like a chat message. The task still runs on the original computer while you follow it from any device.',
  docs_codex_tip:
    'If Codex does not appear in Shennian, first confirm that codex runs in the target computer terminal, then refresh the Agent list or restart the daemon.',
  docs_claude_code_title: 'Use Claude Code',
  docs_claude_code_desc:
    'Claude Code is useful for long-context code understanding, cross-file changes, and local project collaboration. Install and sign in to Claude Code on the target computer first.',
  docs_claude_code_step_install_title: 'Prepare Claude Code on the target computer',
  docs_claude_code_step_install_desc:
    'Confirm that claude runs directly in the local terminal and that sign-in, model choice, and upstream account setup are complete.',
  docs_claude_code_step_machine_title: 'Choose machine and workdir',
  docs_claude_code_step_machine_desc:
    'In Shennian, choose an online machine and Claude Code, then set the project working directory to start a session.',
  docs_claude_code_step_run_title: 'Continue from any device',
  docs_claude_code_step_run_desc:
    'Later you can ask follow-ups, add requirements, or inspect files from phone while Claude Code keeps working on the original computer.',
  docs_claude_code_tip:
    'Claude Code installation, sign-in, and account authorization remain owned by the local CLI. Shennian controls the session surface and multi-device sync.',
  docs_other_agents_title: 'Other Agents',
  docs_other_agents_desc:
    'OpenCode, Cursor Agent, and similar local Agents can connect through the same Shennian entry. Their install, sign-in, and authorization still follow their own CLI rules.',
  docs_other_agents_card_supported_title: 'One entry point',
  docs_other_agents_card_supported_desc:
    'Shennian detects commands, shows available entries, and syncs sessions to phone, Web, and desktop.',
  docs_other_agents_card_local_title: 'Make it run locally first',
  docs_other_agents_card_local_desc:
    'If an Agent is missing from the list, first confirm that it can run independently in the target computer terminal.',
  docs_other_agents_card_refresh_title: 'Refresh detection',
  docs_other_agents_card_refresh_desc:
    'After installing a new Agent, refresh the Agent list or restart the daemon so Shennian can detect commands and models again.',
  docs_agent_module_pending:
    'This chapter is currently a module placeholder. Installation, sign-in, model choice, and common failure handling will be filled in later.',
  docs_custom_agent_arch_tip:
    'This chapter will keep the onboarding steps and minimal protocol; long code examples will move to a dedicated custom-Agent page so the main docs stay readable.',
  docs_wechat_title: 'Agent Uses WeChat',
  docs_wechat_overview_title: 'Overview',
  docs_wechat_intro:
    'Agent Uses WeChat lets an Agent in Shennian use WeChat on your computer. It mainly does two things: send messages to a specific WeChat conversation and receive new messages from that conversation. WeChat still runs locally, and Shennian does not host your WeChat account.',
  docs_wechat_prereq_title: 'Prerequisites',
  docs_wechat_req_install_title: 'Desktop app or CLI installed',
  docs_wechat_req_install_desc:
    'Use Shennian Desktop for ordinary computers, or Shennian CLI for developer machines. The machine must be signed in or paired and stay online.',
  docs_wechat_req_local_title: 'WeChat and Agent on one machine',
  docs_wechat_req_local_desc:
    'Current support is for Mac or Windows desktop WeChat. WeChat, the Shennian connector, and the bound Agent session must run on the same machine.',
  docs_wechat_req_helper_title: 'Mac Helper permissions',
  docs_wechat_req_helper_desc:
    'On macOS, open Agent Uses WeChat from Shennian Desktop to install or repair Helper and grant Screen Recording, Accessibility, Automation, and related system permissions.',
  docs_wechat_req_account_title: 'Pro / Team and credits',
  docs_wechat_req_account_desc:
    'Agent Uses WeChat is an external-message capability. Your account needs Pro / Team entitlement and available credits for visual recognition, structured reads, and send confirmation.',
  docs_wechat_safety_title: 'Principles and safety',
  docs_wechat_safety_desc:
    'Shennian has Computer Use capability: it uses a multimodal model to understand the computer screen and operate WeChat like a person, such as opening a target conversation, reading visible messages, typing, and sending replies.',
  docs_wechat_safety_computer_use_title: 'Computer Use',
  docs_wechat_safety_computer_use_desc:
    'It uses local screen understanding, screenshots, clicks, typing, and clipboard actions. The actions happen on your computer.',
  docs_wechat_safety_capability_title: 'Visible read and write only',
  docs_wechat_safety_capability_desc:
    'The core capability is sending to a named WeChat conversation and receiving new visible messages from that same conversation.',
  docs_wechat_safety_no_low_level_title: 'No low-level sensitive parsing',
  docs_wechat_safety_no_low_level_desc:
    'Shennian does not parse WeChat transport, protocol, database, or other sensitive internals, does not inject into WeChat, and does not bypass the WeChat client.',
  docs_wechat_safety_no_storage_title: 'No WeChat message storage',
  docs_wechat_safety_no_storage_desc:
    'Shennian does not store WeChat messages as cloud chat records and does not upload your WeChat history as a backup.',
  docs_wechat_safety_cursor_tip:
    'When a Shennian conversation is bound, Shennian records only the last few messages as a cursor marker to know what has already been seen and where to continue next. This marker is not a full chat history.',
  docs_wechat_step_session_title: 'Open the Shennian Agent conversation',
  docs_wechat_step_session_desc:
    'Start Claude Code, Codex, OpenCode, Nian, or a custom Agent on the prepared machine, then open the corresponding Shennian conversation.',
  docs_wechat_step_channel_title: 'Open the Use WeChat binding page',
  docs_wechat_step_channel_desc:
    'From the conversation header, open External Messages or External Channels, then choose Use WeChat. This binds the current Shennian conversation.',
  docs_wechat_step_conversation_title: 'Enter the WeChat conversation name',
  docs_wechat_step_conversation_desc:
    'Enter the contact or group name exactly as it appears in WeChat’s left conversation list, turn Enabled on, and save. One Shennian Agent conversation binds to one WeChat conversation name.',
  docs_wechat_step_agent_title: 'Let new messages enter the Agent',
  docs_wechat_step_agent_desc:
    'After binding, Shennian checks that local WeChat conversation on a schedule. New messages enter the linked Shennian session, and Agent replies go back to the same WeChat conversation.',
  docs_wechat_cli_title: 'Agent Uses WeChat CLI',
  docs_wechat_cli_desc:
    '`shennian wechat` is the command entry for Agents to use local WeChat. Start with doctor. read / write default to human- and Agent-readable output; add JSON only for scripts.',
  docs_wechat_skill_install_title: 'Install the Skill for external Agents',
  docs_wechat_skill_install_desc:
    'To let Codex, Claude Code, PolyCode, or another Skill-capable Agent use this WeChat capability directly, send it the text below and ask it to install the Skill using its own Skill mechanism.',
  docs_wechat_cli_tip:
    'Run read only when the user explicitly asks to read a specific WeChat conversation. Before sending, confirm the exact destination and content. Shennian does not host your WeChat account or bypass the WeChat client.',
  docs_wechat_binding_title: 'Bind Shennian and WeChat conversations',
  docs_wechat_binding_desc:
    'The CLI is good for one-off reads and writes. Binding is for ongoing work with a WeChat contact or group: new WeChat messages enter the linked Shennian Agent conversation, and Agent replies return to that same WeChat conversation.',
  docs_wechat_binding_tip:
    'The first scan after binding only establishes a baseline; it does not ingest history into the Agent. Later scans deliver only new messages. Cross-machine binding and cloud-hosted personal WeChat are not current goals.',
  docs_wechat_daily_title: 'Daily use',
  docs_wechat_daily_desc:
    'After binding, keep this machine online and WeChat signed in. You can continue talking to the Agent from phone, Web, or desktop, while actual WeChat reads and writes still happen on the bound computer. If unavailable, run shennian wechat doctor or open Settings → Agent Uses WeChat / Use WeChat to inspect machine status.',
  docs_enterprise_wecom_title: 'Managed WeCom groups',
  docs_enterprise_wecom_intro:
    'Managed WeCom groups are an external-message capability for enabled customers: bind your own WeCom account in Shennian, then connect one WeCom group to one Shennian Agent session. When someone @mentions the hosted WeCom account in the group, the message enters that Agent; when the Agent needs to reply, it sends back to the same bound group.',
  docs_enterprise_wecom_prereq_title: 'Entitlements and prerequisites',
  docs_enterprise_wecom_req_entitlement_title: 'Hidden managed_wecom entitlement required',
  docs_enterprise_wecom_req_entitlement_desc:
    'The entry appears only for accounts manually enabled with managed_wecom. Pro, Team, or a generic enterprise tier does not necessarily include this hidden capability.',
  docs_enterprise_wecom_req_manager_title: 'A supported external-channel Agent session',
  docs_enterprise_wecom_req_manager_desc:
    'Group binding is attached to a specific Shennian session. Use Manager / Nian / Codex / Claude Code or another session that supports external-channel instructions and send commands.',
  docs_enterprise_wecom_req_account_title: 'A WeCom account that can scan in',
  docs_enterprise_wecom_req_account_desc:
    'Scan with your own WeCom mobile app. The first version allows one hosted WeCom account per Shennian account; re-scan if it goes offline or expires.',
  docs_enterprise_wecom_entry_title: 'Entry and group binding',
  docs_enterprise_wecom_entry_desc:
    'Bind the WeCom account from Profile first, then open the target Agent session and configure External messages from the session header.',
  docs_enterprise_wecom_step_profile_title: 'Profile → WeCom',
  docs_enterprise_wecom_step_profile_desc:
    'Sign in to Shennian Web/App and open Profile. With managed_wecom enabled, the WeCom entry is visible; otherwise the page says it is for enterprise customers.',
  docs_enterprise_wecom_step_qr_title: 'Choose area and scan',
  docs_enterprise_wecom_step_qr_desc:
    'Choose your common login area, start binding or re-login, and scan with WeCom mobile. If WeCom shows a 6-digit verification code, enter it back in Shennian.',
  docs_enterprise_wecom_step_sync_title: 'Sync group conversations',
  docs_enterprise_wecom_step_sync_desc:
    'After the account becomes online, sync conversations. The page shows bindable WeCom groups; if a new group is missing, confirm the account is in it and refresh sync.',
  docs_enterprise_wecom_step_session_title: 'Agent session → External messages',
  docs_enterprise_wecom_step_session_desc:
    'Open the Agent session that should handle the group, click the External messages entry in the header, choose WeCom, then pick the synced group.',
  docs_enterprise_wecom_step_save_title: 'Set listen/reply and save',
  docs_enterprise_wecom_step_save_desc:
    'The default is mention-only; you can switch to all messages. Confirm Allow reply and the custom constraints before saving. One Shennian session currently binds one WeCom group.',
  docs_enterprise_wecom_config_title: 'WeCom app, bot, credentials, and callback',
  docs_enterprise_wecom_config_desc:
    'Users do not create a WeCom custom app, group bot, Secret, Token, Webhook, or callback URL in the current implementation. Shennian Server and the QiWe hosting layer manage them.',
  docs_enterprise_wecom_config_no_app_title: 'No user-created app or bot',
  docs_enterprise_wecom_config_no_app_desc:
    'The implemented flow hosts a scanned-in WeCom account; it is not a WeCom admin-console app or group-bot webhook setup.',
  docs_enterprise_wecom_config_callback_title: 'Server-managed credentials and callback',
  docs_enterprise_wecom_config_callback_desc:
    'QiWe API tokens, device guid, and callback secrets stay on Shennian Server. Clients and daemons never hold platform secrets; the server sets callbacks automatically.',
  docs_enterprise_wecom_config_area_title: 'Area improves scan stability',
  docs_enterprise_wecom_config_area_desc:
    'Shennian recommends an area from your request IP and lets you override it to the normal WeCom login area, reducing unusual new-device prompts.',
  docs_enterprise_wecom_behavior_title: 'How group messages trigger and reply',
  docs_enterprise_wecom_behavior_trigger_title: 'Default: @mention the hosted account',
  docs_enterprise_wecom_behavior_trigger_desc:
    'Group chats default to listenMode=mention_only: ordinary messages are kept as short-lived server context; when someone @mentions the hosted WeCom account, Shennian sends the relevant context to the bound Agent.',
  docs_enterprise_wecom_behavior_reply_title: 'Agent replies through the binding',
  docs_enterprise_wecom_behavior_reply_desc:
    'The Agent does not need group IDs. Regular Agents use shennian external send; Manager uses shennian manager external send. The server routes by the current Shennian session binding. Turn Allow reply off to receive only.',
  docs_enterprise_wecom_behavior_media_title: 'Text first, media as attachments',
  docs_enterprise_wecom_behavior_media_desc:
    'Inbound images, files, videos, and audio are delivered as short-lived attachments into the local workdir. Replies are text by default; send-image/send-file are used only when explicitly needed.',
  docs_enterprise_wecom_behavior_tip:
    'Binding does not dump old group history into the Agent. It only affects future triggered messages. Use all-messages mode only for low-noise dedicated groups; use mention-only for customer groups.',
  docs_enterprise_wecom_unbind_title: 'Unbind, pause, and re-scan',
  docs_enterprise_wecom_unbind_desc:
    'Turn off Enabled or delete the binding in the session External messages page to stop that group from entering the session. In Profile → WeCom, bound groups can open their session or remove the group binding. The bottom Unbind action removes the hosted WeCom account and its bindings. If the account is offline, expired, or revoked, use Re-login / Refresh QR to scan again.',
  docs_enterprise_wecom_safety_title: 'Permissions and safety',
  docs_enterprise_wecom_safety_entitlement_title: 'Server-side entitlement checks',
  docs_enterprise_wecom_safety_entitlement_desc:
    'Account binding, conversation sync, group binding, and send APIs all require managed_wecom; Manager binding also requires external-message/Manager capability. Old clients or direct API calls cannot bypass this.',
  docs_enterprise_wecom_safety_scope_title: 'Minimum binding scope',
  docs_enterprise_wecom_safety_scope_desc:
    'One binding connects one Shennian session to one WeCom group. Replies go to that group; Agents cannot choose arbitrary groups or see platform secrets.',
  docs_enterprise_wecom_safety_unbind_title: 'Can be disabled anytime',
  docs_enterprise_wecom_safety_unbind_desc:
    'You can disable one session binding, turn off replies, or unbind the entire WeCom account. External-message cache and short-lived attachments are cleaned by server policy.',
  docs_enterprise_wecom_trouble_title: 'Troubleshooting',
  docs_enterprise_wecom_trouble_no_entry_title: 'No WeCom entry',
  docs_enterprise_wecom_trouble_no_entry_desc:
    'Check that the signed-in account has managed_wecom. Pro/Team without this hidden entitlement still does not show the entry.',
  docs_enterprise_wecom_trouble_qr_title: 'QR expired or account stays offline',
  docs_enterprise_wecom_trouble_qr_desc:
    'Refresh QR / re-login and confirm on WeCom mobile. If a 6-digit code appears, enter it in Shennian. Try the usual login area if needed.',
  docs_enterprise_wecom_trouble_empty_title: 'No groups after sync',
  docs_enterprise_wecom_trouble_empty_desc:
    'Confirm the hosted account is in the target external group, then sync again. The current page primarily lists group conversations; direct messages are not the default target.',
  docs_enterprise_wecom_trouble_no_trigger_title: 'Group messages do not wake the Agent',
  docs_enterprise_wecom_trouble_no_trigger_desc:
    'Default mode requires @mentioning the hosted WeCom account. Also check that External messages are enabled, the correct group is selected, the account is online, and the bound machine/session can receive work.',
  docs_enterprise_wecom_trouble_no_reply_title: 'Agent received but did not reply to group',
  docs_enterprise_wecom_trouble_no_reply_desc:
    'Check Allow reply. The Agent must use shennian external send or shennian manager external send, not just a normal Shennian chat reply.',
  docs_files_title: 'Files and attachments',
  docs_files_intro:
    'Shennian keeps local project files, uploaded attachments, and Agent-generated results in one control surface. From a session, you can enter the workdir, search files, preview text, images, and HTML, download a file or folder ZIP, and upload screenshots or documents from your phone.',
  docs_files_image_alt: 'Shennian file browser screenshot',
  docs_files_card_title: 'Give file context to the Agent',
  docs_files_card_desc:
    'When an Agent needs a file, reference it with @ in the conversation. Markdown files can also be previewed, edited, and exported as source or PDF.',
  docs_projects_sessions_title: 'Projects and sessions',
  docs_projects_sessions_desc:
    'In Shennian, a project is primarily carried by the working directory. Choose the directory when launching an Agent; later messages, attachments, and file browsing revolve around it.',
  docs_projects_sessions_card_workdir_title: 'Workdir carries the project',
  docs_projects_sessions_card_workdir_desc:
    'After choosing a directory, Agent file access, attachment references, and result downloads use that local context.',
  docs_projects_sessions_card_session_title: 'A session records one workflow',
  docs_projects_sessions_card_session_desc:
    'A session records the machine, Agent, model, workdir, messages, tool calls, and result files for one workflow.',
  docs_projects_sessions_card_context_title: 'Resume and isolate',
  docs_projects_sessions_card_context_desc:
    'Resume context from the session list. Switching Agents creates a new session so different Agent contexts do not pollute each other.',
  docs_skills_title: 'Native Agent capabilities',
  docs_skills_desc:
    'Shennian only projects native skills and plugin skills already installed in Codex, Claude Code, or WorkBuddy. It does not run its own marketplace.',
  docs_skills_card_install_title: 'Managed by the Agent',
  docs_skills_card_install_desc:
    'Install, upgrade, and approve permissions in the native Agent. Shennian does not download, repair, or host capability bundles.',
  docs_skills_card_call_title: 'Insert a remote invocation',
  docs_skills_card_call_desc:
    'Choose Agent Capabilities from the chat plus menu. Shennian inserts the native `$skill` or `/skill` call into the draft for review.',
  docs_skills_card_repair_title: 'Initial support',
  docs_skills_card_repair_desc:
    'The first release supports Codex, Claude Code, and WorkBuddy. Other Agents keep ordinary chat without the picker.',
  docs_skills_arch_tip:
    'Shennian relays only names, descriptions, sources, and native invocation strings—not skill bodies, scripts, or absolute local paths.',
  docs_multi_device_title: 'Multi-device control',
  docs_multi_device_desc:
    'Phone, Web, and desktop use the same account. Once the computer is online, you can open the same session from any device to add instructions, review Agent output, inspect files, and download results.',
  docs_multi_device_image_alt: 'Shennian sharing and multi-device screenshot',
  docs_multi_device_card_title: 'Keep going away from the computer',
  docs_multi_device_card_desc:
    'The Agent does not move to the phone; the task still runs on the original computer while you switch control surfaces.',
  docs_status_sync_title: 'Notifications and status sync',
  docs_status_sync_desc:
    'Shennian syncs connection state, message state, Agent progress, and file-operation results, helping you tell whether an issue is in the network, daemon, or Agent itself.',
  docs_status_sync_card_connection_title: 'Connection state',
  docs_status_sync_card_connection_desc:
    'The UI can show connecting, receiving, sending, network error, CLI unreachable, and related states.',
  docs_status_sync_card_progress_title: 'Execution progress',
  docs_status_sync_card_progress_desc:
    'Agent output, tool calls, queued work, and file-operation results stream back to the current device.',
  docs_status_sync_card_errors_title: 'Error location',
  docs_status_sync_card_errors_desc:
    'When an Agent errors, permissions are missing, or an external capability is unavailable, start with the page state and the relevant troubleshooting command.',
  docs_status_sync_tip:
    'In product copy, this can be understood as realtime status sync. In the custom Agent protocol, notify is still reserved for future use and should not be treated as an open proactive notification API.',
  docs_machine_management_title: 'Machine management',
  docs_machine_management_desc:
    'Machines are the first layer of Shennian. The machine list shows each computer’s online state, system, version, available Agents, and sharing markers; machine details handle rename, unbind, re-pair, Agent refresh, and model-list refresh.',
  docs_machine_card_status_title: 'Status and version',
  docs_machine_card_status_desc:
    'Quickly tell whether a machine is online, whether the connector needs an upgrade, and whether the system supports a capability.',
  docs_machine_card_agents_title: 'Agent and model discovery',
  docs_machine_card_agents_desc:
    'Refresh installed Agents, model lists, and workdir entries so every machine shows its real local capability.',
  docs_machine_card_share_title: 'Shared access',
  docs_machine_card_share_desc:
    'Accept shared machines through an invite code or QR code, then collaborate with view-only, can-use, full-control, or admin permissions.',
  docs_advanced_badge: 'Developers and servers',
  docs_cli_title: 'CLI install',
  docs_cli_intro2:
    'Use the CLI for servers, NAS devices, and headless environments. It requires Node.js 18 or later.',
  docs_troubleshooting_title: 'Troubleshooting',
  docs_troubleshooting_intro2:
    'For ordinary computers, start with the desktop auto-setup state. For CLI machines, check the daemon first and re-pair only when needed.',
  docs_fix_offline_title: 'Machine is offline',
  docs_fix_offline_desc:
    'Confirm that the desktop app or CLI daemon is running and the current network can reach shennian.net.',
  docs_fix_agent_title: 'Agent is unavailable',
  docs_fix_agent_desc:
    'Confirm the corresponding Claude Code, Codex, OpenCode, or other Agent client is installed and initialized.',
  docs_fix_repair_title: 'Pair again',
  docs_fix_repair_desc:
    'Re-pair after the machine was removed, the token expired, or the account changed. In normal use, you do not need to scan repeatedly.',
  docs_fix_upgrade_title: 'Upgrade failed',
  docs_fix_upgrade_desc:
    'If Shennian keeps failing to upgrade, remove the global npm package first, then install the latest release again.',
  docs_fix_wechat_title: 'Agent Uses WeChat unavailable',
  docs_fix_wechat_desc:
    'Run shennian wechat doctor, or check Helper, permissions, WeChat sign-in, entitlement, and credits from the Use WeChat machine dashboard.',
  docs_customer_support_title: 'Human support',
  docs_customer_support_desc:
    'Scan the QR code to add Shennian enterprise WeChat support. Send your issue screenshot, machine status, and visible error.',
  docs_customer_support_qr_title: 'Enterprise WeChat support',
  docs_customer_support_qr_desc:
    'For installation, pairing, Agent sign-in, or Agent Uses WeChat troubleshooting, scan to contact human support.',
  docs_customer_support_qr_alt: 'Shennian enterprise WeChat support QR code',
  docs_customer_support_cta: 'Open support',
  docs_custom_agent_title: 'Custom Agent integration',
  docs_custom_agent_intro2:
    'Custom Agent integration is the stable developer-facing protocol. Implement a local command, and Shennian turns phone/browser messages into stdin while streaming JSON Lines from stdout back to every client. Your Agent does not need to speak WebSocket, HTTP, or database protocols.',
  docs_custom_agent_card_caps_title: '1. Declare capabilities',
  docs_custom_agent_card_caps_desc:
    'Implement /caps to return the display name, model list, spawn mode, and whether resume is supported. Shennian uses this to render the Agent and model picker.',
  docs_custom_agent_card_run_title: '2. Receive one turn',
  docs_custom_agent_card_run_desc:
    'Implement /run and read the user message from stdin. The CLI passes --workdir, --session, --model, --resume, and attachment paths when available.',
  docs_custom_agent_card_events_title: '3. Stream events',
  docs_custom_agent_card_events_desc:
    'Write one JSON object per line to stdout. Emit delta or tool-call early so users see progress, then final to complete the turn.',
  docs_custom_agent_flow_title: 'Complete data flow',
  docs_custom_agent_flow_desc:
    'A minimal Agent has only two entry points: /caps for discovery and /run for one user message. The JSONL below is the public format Shennian expects to read.',
  docs_custom_agent_events_title: 'Public event format',
  docs_custom_agent_events_desc:
    'These state values are the stable v1 output protocol for custom Agents. Shennian fills internal runId / seq values and syncs the stream to phone, browser, and desktop clients.',
  docs_custom_agent_event_delta:
    'Streaming text chunk. Use it for normal replies, or add thinking:true to render reasoning content.',
  docs_custom_agent_event_final:
    'Turn complete. Every successful reply must end with final, optionally including usage and agentSessionId.',
  docs_custom_agent_event_error: 'Turn failed and ended. The message is shown to the user.',
  docs_custom_agent_event_tool_call:
    'Show a local tool invocation. The Agent runs the tool itself; Shennian only renders progress.',
  docs_custom_agent_event_tool_result:
    'Show a local tool result, useful for directory listing, file reads, searches, and progress replay.',
  docs_custom_agent_first_event_tip:
    'The recommended first valid event is delta, for example {"state":"delta","text":"Received. Starting now.\\n"}. start / init are Shennian internal normalization events, and notify is reserved for future proactive messages; do not use them as v1 success signals.',
  docs_custom_agent_resume_title: 'Session resume',
  docs_custom_agent_resume_desc:
    'If /caps returns resume:true, the Agent may include its own agentSessionId in final. Shennian passes that value back through --resume on the next turn; the Agent owns context persistence.',
  docs_custom_agent_attachments_title: 'Attachments and workdir',
  docs_custom_agent_attachments_desc:
    'Shennian passes user-selected files as local absolute paths through --attachment and passes --workdir for the target project. Your Agent can read project files, images, PDFs, and other assets like any CLI.',
  docs_custom_agent_boundaries_title: 'Internal formats not to depend on',
  docs_custom_agent_boundary_start:
    'Do not output start / init as custom Agent success signals; they are Shennian internal events.',
  docs_custom_agent_boundary_notify:
    'notify is reserved for future proactive messages. In current spawn mode, do not use it to complete a reply.',
  docs_custom_agent_boundary_internal:
    'Do not depend on Relay frames, database tables, built-in Claude / Codex adapter private parsers, or the full internal structure of ~/.shennian/config.json.',
  docs_install_intro:
    'Requires Node.js 18 or later. Choose either method below — first-time setup takes about 2 minutes.',
  docs_install_opt_npx: 'Install globally (one-time setup)',
  docs_install_opt_global: 'Install globally, then run directly (recommended for auto-start)',
  docs_pairing_intro:
    'Pairing is a one-time step. Once paired, the connection persists automatically. The whole process takes under 30 seconds.',
  docs_pairing_step1_title: 'Run the CLI on the target machine',
  docs_pairing_step1_desc:
    'Run npm install -g shennian@latest, then run shennian. The CLI registers with the relay server and prints a QR code and pairing token.',
  docs_pairing_step2_title: 'Open the Shennian app',
  docs_pairing_step2_desc:
    'On your phone, open Shennian, go to "Settings" and tap "Scan", or go to "My Machines" and tap "Add Machine".',
  docs_pairing_step3_title: 'Scan or paste the token',
  docs_pairing_step3_desc:
    'Scan the QR code shown in the terminal, or choose "Paste Token" and enter the sn-... code.',
  docs_pairing_step4_title: 'Done',
  docs_pairing_step4_desc:
    'The machine appears in your app as "Online". Next time the CLI starts, it reconnects automatically — no re-pairing needed.',
  docs_pairing_tip:
    'Tip: If the token expires or the machine is reset, tap "Re-pair" in the machine detail screen to generate a new one.',
  docs_first_msg_intro:
    'Once a machine is paired and online, select it in the app, launch an Agent, and start chatting.',
  docs_first_msg_step1_title: 'Select a machine',
  docs_first_msg_step1_desc:
    'Switch to the Machines tab at the bottom of the app, then tap any machine marked as "Online".',
  docs_first_msg_step2_title: 'Choose an Agent',
  docs_first_msg_step2_desc:
    'Pick an Agent from the list (Claude, Codex, Cursor, OpenCode, or Nian) and set the working directory for the session.',
  docs_first_msg_step3_title: 'Launch the Agent',
  docs_first_msg_step3_desc:
    'Tap "Launch" and wait for the Agent to become ready (usually 3–5 seconds).',
  docs_first_msg_step4_title: 'Send a message',
  docs_first_msg_step4_desc:
    "Type your message and tap Send. The Agent's response streams back to the conversation in real time.",
  docs_first_msg_tip: 'Tap the 📎 icon in the input bar to attach local files as context.',
  docs_cli_intro:
    'These are the user-facing commands you need for daily use, troubleshooting, upgrades, and custom Agent integration.',
  docs_cli_commands_title: 'Commands',
  docs_cli_flags_title: 'Flags',
  docs_troubleshooting: 'Troubleshooting',
  docs_supported_agents_title: 'Built-in Agents',
  docs_cli_flag_name_desc: 'Machine display name (default: hostname)',
  docs_cli_flag_api_desc: 'Override the server URL for this command',
  docs_cli_flag_version_desc: 'Print version and exit',
  docs_cli_note:
    'Region, pairing, and custom Agent settings are saved locally. Most users do not need environment variables.',
  docs_cmd_smart_start: 'Pair when needed, then start the background daemon.',
  docs_cmd_pair: 'Pair this computer again with a fresh QR code or token.',
  docs_cmd_start: 'Start the background service and enable auto-start.',
  docs_cmd_stop: 'Stop the background service and disable remote access.',
  docs_cmd_status: 'Show whether the background service is online and where logs are stored.',
  docs_cmd_logs: 'Print recent background service logs for debugging.',
  docs_cmd_config: 'Show local configuration such as region and machine id.',
  docs_cmd_config_server: 'Switch between China and global relay regions, then stop and start.',
  docs_cmd_upgrade: 'Upgrade the CLI to the latest npm release.',
  docs_cmd_agent_add: 'Register a custom Agent command after probing its capabilities.',
  docs_cmd_agent_list: 'List registered custom Agents.',
  docs_cmd_agent_remove: 'Remove a custom Agent from this machine.',
  docs_troubleshooting_intro:
    'If the app cannot reach your computer, diagnose the daemon first, then re-pair only if needed.',
  docs_troubleshooting_step1_title: 'Check status',
  docs_troubleshooting_step1_desc:
    'Run shennian status to confirm whether the local background service is running.',
  docs_troubleshooting_step2_title: 'Restart the daemon',
  docs_troubleshooting_step2_desc:
    'Run shennian stop && shennian start. It keeps your pairing and region configuration unchanged.',
  docs_troubleshooting_step3_title: 'Re-pair when credentials changed',
  docs_troubleshooting_step3_desc:
    'Run shennian pair if the machine was reset, removed from the app, or the token expired.',
  docs_troubleshooting_step4_title: 'Check Agent CLIs',
  docs_troubleshooting_step4_desc:
    'Install the CLI you want to control, such as claude, codex, cursor agent, or opencode.',
  docs_restart_warning:
    'Restarting the daemon disconnects the app from this computer for a few seconds and may interrupt active local Agent sessions.',
  docs_custom_agent_intro:
    'A custom Agent is just a local command. It declares capabilities with /caps, accepts a prompt on stdin with /run, and prints JSON Lines events to stdout.',
  docs_custom_agent_proto_title: 'Minimal protocol',
  docs_custom_agent_proto_caps:
    '/caps prints one JSON object with name, models or model, mode, and optional version. Shennian uses it when you run agent add.',
  docs_custom_agent_proto_run:
    '/run receives the user message through stdin. The CLI also passes --workdir, --session, --resume, and --model when available.',
  docs_custom_agent_proto_events:
    'stdout is JSON Lines. Emit delta for streaming text, final when done, error on failure, and optional tool-call or tool-result events. notify is reserved for future use.',
  docs_custom_agent_register_title: 'Register and refresh',
  docs_custom_agent_tip:
    'Start from the demo, replace the reply logic with your own model or tool calls, then register it. No external SDK is required.',
  docs_custom_agent_node_demo: 'Node.js Demo',
  docs_custom_agent_node_intro:
    'Save this as my-agent.js. It is a complete spawn-mode Agent with no dependencies.',
  docs_custom_agent_python_demo: 'Python Demo',
  docs_custom_agent_python_intro:
    'Save this as my_agent.py. It uses only Python standard library and can be adapted to any model provider.',
  msg_sending: 'Sending…',
  msg_still_sending: 'Sending…',
  msg_uncertain: 'Sending…',
  msg_queued: 'Queued',
  msg_edit_queued: 'Edit',
  msg_editing_queued: 'Editing queued message',
  msg_edit_queued_failed: 'The message started running or could not be edited',
  msg_delete_queued: 'Cancel',
  queued_attachment_only: 'Attachment message',
  queued_attachment_count: '{{count}} attachments',
  msg_resend: 'Resend',
  msg_send_failed: 'Send failed',
  quote_message: 'Quote',
  voice_action: 'Voice input',
  voice_start: 'Start recording',
  voice_listening_inline: 'Listening',
  voice_optimizing_inline: 'Optimizing',
  voice_optimizing_continue: 'Optimizing. Activate to continue voice input',
  voice_listening_status: 'Listening {{duration}}',
  voice_refining_status: 'Refining text…',
  voice_permission_denied: 'Microphone permission was denied',
  voice_recording_failed: 'Unable to start recording',
  voice_live_unsupported: 'Live speech recognition is not supported in this environment',
  voice_processing_failed: 'Unable to refine voice draft. Please try again.',
  msg_error_network: 'Network error',
  msg_error_cli: 'CLI unreachable',
  msg_error_agent: 'Agent error',
  paste_image: 'Paste Image',
  footer_brand: 'Shennian',
  footer_slogan: 'AI Agent Control Plane',
  footer_copyright: '© 2026 Shennian',
  landing_community_eyebrow: 'Community',
  landing_community_title: 'Join the WeChat Group',
  landing_community_xhs_desc: '',
  landing_community_xhs_cta: 'Follow on Xiaohongshu',
  landing_community_wechat_label: 'WeChat Group',
  landing_community_wechat_title: 'Scan to join the group',
  landing_community_wechat_desc:
    'This is the Shennian user group for updates, usage discussions, and feedback. To join, provide your user ID or a Shennian product screenshot for verification.',
  landing_community_wechat_alt: 'Shennian WeChat group QR code',
  logout_confirm: 'Are you sure you want to log out?',
  account_delete: 'Delete account',
  account_delete_warning:
    'Your account, personal AI conversations, machines, Agents, and synced data will be permanently removed, and you will leave every Room. Existing Room messages remain for six months and appear under “Deleted user.” This cannot be undone.',
  account_delete_progress: 'Deleting account',
  account_delete_progress_detail:
    'Cleaning up account and device data. You will be signed out when it finishes. Do not close the app.',
  account_delete_confirm: 'Delete permanently?',
  account_delete_failed: 'Could not delete account. Please try again.',
  rename_machine: 'Rename',
  rename_machine_placeholder: 'Enter machine name',
  rename_saving: 'Saving…',
  rename_session: 'Rename',
  rename_session_placeholder: 'Enter conversation name',
  model_selector_title: 'Select Model',
  model_follow_agent: 'Follow Agent',
  model_selector_default: 'Default',
  model_selector_current: 'Current',
  model_selector_refresh: 'Refresh model list',
  model_selector_search: 'Search models',
  model_selector_no_results: 'No matching models',
  model_selector_recent: 'Recently used',
  model_selector_all: 'All models',
  model_selector_switch_agent: 'Switch Agent',
  model_selector_fastest: 'Fastest',
  model_selector_strongest: 'Strongest',
  reasoning_effort: 'Reasoning effort',
  reasoning_effort_low: 'Low',
  reasoning_effort_medium: 'Medium',
  reasoning_effort_high: 'High',
  reasoning_effort_xhigh: 'Extra high',
  reasoning_effort_ultra: 'Ultra',
  reasoning_effort_max: 'Max',
  nian_model_standard: 'Standard',
  nian_model_fast: 'Fast',
  model_new_session_hint: 'Switching Agent creates a new session',
  model_refresh_failed: 'Failed to refresh model list',
  model_switch_failed: 'Failed to switch model',
  model_list_empty: 'Model list not loaded. Refresh to try again.',
  model_not_loaded: 'Not loaded',
  model: 'Model',
  agents_refresh: 'Refresh Agents',
  agents_refresh_short: 'Refresh',
  agents_refresh_success: 'Agent list refreshed',
  agents_refresh_failed: 'Failed to refresh Agent list',
  installed_agents: 'Installed',
  available_agents_to_install: 'Not Installed',
  unbind_machine: 'Remove machine',
  unbind_machine_action: 'Remove',
  unbind_machine_owner_confirm:
    'Removing this machine also removes its dependent agents from their group chats. Agent profiles and chat history are kept. Agents will not automatically rejoin.',
  unbind_machine_owner_desc:
    'The machine will be permanently deleted along with all access grants. This cannot be undone.',
  unbind_machine_grant_confirm: 'Remove this machine?',
  unbind_machine_grant_desc:
    'You will lose access to this machine, but the machine itself will not be deleted.',
  unbind_machine_failed: 'Failed to remove. Please try again.',
  unbinding: 'Removing…',
  machines_total: '{{total}} machines',
  scan_pair: 'Scan to Pair',
  scan_title: 'Scan',
  scan_result_login: 'Login confirmed on new device',
  scan_result_room_access: 'Room access confirmed',
  scan_result_pair: 'Machine paired successfully',
  scan_result_share: 'Machine share accepted',
  enterprise_feature_unavailable: 'This feature is only available for enterprise users',
  enter_pair_token: 'Enter Pair Token',
  or_enter_token: 'or enter manually',
  scan_code: 'Scan',
  scan_hint:
    'Scan a Shennian QR code to join a group chat, add or accept a shared machine, or confirm login',
  scan_choose_image: 'Choose QR from Photos',
  scan_photo_permission: 'Allow photo access to choose a QR code image',
  scan_image_invalid: 'No supported Shennian QR code was found in this image',
  scan_image_failed: 'Could not read this image. Choose a clearer QR code image.',
  camera_permission_title: 'Camera permission needed',
  camera_permission_message: 'Please allow camera access to scan QR codes',
  scan_camera_unavailable: 'The camera is unavailable. You can choose a QR image from Photos.',
  ok: 'OK',
  pick_image: 'Photos & Videos',
  pick_file: 'Pick File',
  no_file_selected: 'No file selected',
  service_region: 'Connection',
  something_went_wrong: 'Something went wrong',
  try_again: 'Try Again',
  select_session: 'Select Session',
  select_session_hint: 'Pick a session from the list',
  add_machine_cta: 'Choose connection',
  relay_disconnected: 'Connection lost · tap to re-pair',
  relay_connected: 'Connected',
  relay_connecting: 'Connecting…',
  no_machine_hint: 'No machine linked · tap to add',
  qr_confirm_failed: 'QR confirmation failed',
  share_redeem_failed: 'Share redemption failed',
  share_access: 'Share Access',
  generate_invite: 'Generate Invite',
  generating: 'Generating…',
  regenerate: 'Regenerate',
  invite_qr_hint: 'Scan with Shennian App to get access',
  invite_qr_unavailable: 'QR code unavailable. Copy the invite code instead.',
  invite_code_label: 'Invite code',
  copy_token: 'Copy Invite Code',
  token_copied: 'Copied',
  pending_redeem: 'Pending',
  redeemed: 'Redeemed',
  grant_create_failed: 'Failed to create invite',
  grant_create_invalid_response:
    'Invite was created, but the server response was incomplete. Please try again.',
  grant_revoke_failed: 'Failed to revoke',
  no_grants: 'No active grants',
  share_scope: 'Share scope',
  share_scope_whole_machine: 'Whole machine',
  share_scope_machine_only_hint:
    'Only whole-machine sharing is supported. Use separate machines / VMs when teams need data isolation.',
  shared_machines: 'Shared with me',
  shared_badge: 'Shared',
  perm_badge_view: 'View only',
  perm_badge_use: 'Can use',
  perm_badge_full: 'Full access',
  perm_badge_admin: 'Admin',
  redeem_invite: 'Accept Invite',
  redeem_invite_placeholder: 'Paste invite code',
  redeem_btn: 'Accept',
} as const
