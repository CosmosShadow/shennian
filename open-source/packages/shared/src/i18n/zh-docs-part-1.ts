// @arch open-source/docs/shared-runtime.md
// @test src/__tests__/i18n-reasoning-effort.test.ts

export const zhDocsPart1 = {
  docs_page_title: '文档',
  docs_quickstart: '快速开始',
  docs_install: '安装',
  docs_pairing: '扫码配对',
  docs_first_msg: '发送第一条消息',
  docs_cli_ref: 'CLI 参考',
  docs_custom_agent: '自定义 Agent 接入',
  docs_changelog: '更新日志',
  docs_coming_soon: '文档整理中，敬请期待。',
  docs_back_home: '返回首页',
  docs_nav_start: '开始使用',
  docs_nav_daily: '日常使用',
  docs_nav_agents: '使用 Agent',
  docs_nav_capabilities: '常用能力',
  docs_nav_wechat: 'Agent使用微信',
  docs_nav_support: '排障与支持',
  docs_nav_advanced: '高级',
  docs_overview_badge: '普通用户优先',
  docs_overview_title: '用神念连接你的第一台电脑',
  docs_overview_intro:
    '安装桌面端、登录账号，神念会自动检查并配置本机服务。配置完成后，你可以在手机、浏览器或桌面端选择这台电脑，直接接管 Claude Code、Codex、OpenCode、Nian 等 Agent。',
  docs_download_desktop: '下载桌面端',
  docs_desktop_image_alt: '神念桌面端控制台截图',
  docs_desktop_install_title: '桌面端安装',
  docs_desktop_install_intro:
    '普通电脑优先安装桌面端。打开 shennian.net 下载对应系统的安装包，首次打开后登录账号。桌面端会把这台电脑加入你的账号，并自动检查神念 Client、后台连接、Node.js 运行环境和常用 Agent CLI。',
  docs_desktop_title: '安装与自动配置',
  docs_desktop_intro:
    '普通用户建议优先安装桌面端。桌面端登录后会把这台电脑加入账号，并自动检查神念 Client、后台连接和常用 Agent CLI；缺失时会进入自动配置流程，让你少碰命令行。',
  docs_method_desktop_title: '桌面端安装',
  docs_method_desktop_desc:
    '适合 Mac、Windows 和 Linux 图形桌面。Linux 优先使用 .deb 或 AppImage；服务器、SSH 和无图形界面机器用 CLI。',
  docs_method_cli_title: '命令行安装',
  docs_method_cli_desc: '适合服务器、NAS、无图形界面机器，或希望自己管理 daemon 的开发者。',
  docs_method_ai_title: '让 AI 帮你安装',
  docs_method_ai_desc:
    '把安装文档链接发给 Claude、Codex 或 Cursor，让它在当前电脑上完成 CLI 安装和配对前检查。',
  docs_desktop_step1_title: '下载并打开桌面端',
  docs_desktop_step1_desc:
    '从官网下载安装包，打开神念后登录你的账号。手机、Web 和桌面端使用同一个账号。',
  docs_desktop_step2_title: '等待自动配置',
  docs_desktop_step2_desc:
    '桌面端会检查本机神念 Client、后台连接、Node.js 运行环境，以及 Claude Code、Codex、OpenCode 等常用 Agent 客户端。',
  docs_desktop_step3_title: '从任意设备开始使用',
  docs_desktop_step3_desc:
    '配置完成后，这台电脑会出现在机器列表里。你可以在手机、浏览器或桌面端选择它，启动 Agent 并发送任务。',
  docs_desktop_tip: '服务器或纯命令行机器仍然使用 CLI 配对；桌面端自动配置主要服务普通电脑。',
  docs_cli_install_title: '命令行安装',
  docs_cli_install_intro:
    '服务器、NAS、SSH 或无图形界面机器使用 CLI 接入。要求 Node.js 18 或以上版本；安装后运行 shennian，CLI 会引导你扫码或粘贴 Token 配对，并启动后台 daemon。',
  docs_login_pairing_title: '登录与配对',
  docs_login_pairing_desc:
    '手机 App、Web 和桌面端使用同一个账号。桌面端机器通过登录加入账号；CLI 机器通过扫码或粘贴 Token 配对。配对只需一次，之后后台服务会自动重连。',
  docs_login_pairing_step_desktop_title: '桌面端登录',
  docs_login_pairing_step_desktop_desc:
    '在目标电脑打开神念桌面端并登录，同一账号下的手机、Web 和桌面端会看到这台机器。',
  docs_login_pairing_step_cli_title: 'CLI 机器配对',
  docs_login_pairing_step_cli_desc:
    '在目标机器运行 shennian 获取二维码和 sn- 开头的配对 Token，再用手机 App 或 Web 扫码或粘贴 Token。',
  docs_login_pairing_step_online_title: '确认机器在线',
  docs_login_pairing_step_online_desc:
    '机器显示在线后，就可以从任意设备选择它、启动 Agent、恢复会话和浏览文件。',
  docs_login_pairing_tip:
    '只有机器被移除、Token 失效或更换账号后，才需要重新运行 shennian pair；日常排障优先看 shennian status 和日志。',
  docs_mobile_app_title: '手机 App / Web 接管',
  docs_mobile_app_desc:
    '电脑在线后，你可以从手机、浏览器或桌面端接管同一台电脑上的 Agent 会话。Agent 仍运行在原来的电脑上，神念负责把会话、状态、文件和操作入口同步到当前设备。',
  docs_mobile_app_image_alt: '神念会话列表截图',
  docs_mobile_app_card_title: '会话跟着账号走',
  docs_mobile_app_card_desc:
    'Agent 仍运行在原来的电脑上，神念负责把手机、浏览器和桌面端连接到同一个会话控制面。',
  docs_first_message_title: '发送第一条消息',
  docs_first_message_intro:
    '神念的日常使用就是三件事：选机器、选 Agent、发消息。确认工作目录后像聊天一样发送任务；Agent 的输出、工具调用和执行进度会实时回到神念界面。',
  docs_machines_image_alt: '神念机器列表截图',
  docs_machines_title: '选择在线机器',
  docs_machines_short:
    '机器列表会展示每台电脑的在线状态、系统、版本和可用 Agent。先选机器，再决定把任务交给谁。',
  docs_first_step1_title: '选择机器',
  docs_first_step1_desc:
    '在「我的机器」里选择状态为在线的电脑；桌面端自动配置完成后，它会直接出现在这里。',
  docs_first_step2_title: '选择 Agent',
  docs_first_step2_desc:
    '根据任务选择 Claude Code、Codex、OpenCode、Nian 或其他已接入 Agent，并确认工作目录。',
  docs_first_step3_title: '发送消息',
  docs_first_step3_desc: '像聊天一样输入需求。Agent 的输出、工具调用和执行进度会实时回到神念界面。',
  docs_first_step4_title: '随时接管',
  docs_first_step4_desc:
    '出门后也可以从手机继续补充指令、查看结果、下载文件，任务仍然运行在原来的电脑上。',
  docs_membership_credits_title: '套餐与积分',
  docs_membership_credits_desc:
    '基础安装、配对和远程接管可以先按上面的流程完成。部分能力会检查套餐和积分，例如 Agent使用微信需要 Pro / Team 权益和可用积分。',
  docs_membership_credit_plan_title: '查看当前套餐',
  docs_membership_credit_plan_desc: '个人页「套餐与支付」会显示当前套餐、可用积分和可购买项。',
  docs_membership_credit_wechat_title: 'Agent使用微信需要权益',
  docs_membership_credit_wechat_desc:
    '使用微信机器看板会检查账号使用条件；看到需要 Pro / Team 或积分不足时，先回到套餐与支付处理。',
  docs_membership_credit_where_title: 'Team 和组织权限',
  docs_membership_credit_where_desc:
    'Team、组织和机器权限相关入口在个人页「空间与权限」，适合多人共用机器和统一管理。',
  docs_membership_credits_tip:
    '积分用于多模态识别、结构化读取、外部消息发送确认等消耗型能力；普通远程接管本身不是按消息扣积分。',
  docs_machines_intro:
    '机器是神念的第一层入口。你可以把办公室电脑、家里电脑、服务器和共享机器放在同一个列表里，随时知道哪台机器可用、能跑哪些 Agent。',
  docs_chat_image_alt: '神念手机聊天界面截图',
  docs_chat_title: '一个聊天界面接管不同 Agent',
  docs_chat_desc:
    '同一个会话界面展示 Agent 回复、任务进度和工具调用。你可以让 Agent 继续、暂停、补充上下文，或者切换到文件视图查看结果。',
  docs_nian_title: '使用内置 Agent Nian',
  docs_nian_desc:
    'Nian 是神念内置 Agent，不需要额外安装第三方 CLI。登录神念后即可选择 Nian，用来完成快速提问、内容整理、轻量任务和安装引导。',
  docs_nian_image_alt: '神念 Nian 对话截图',
  docs_nian_card_title: '不用额外安装 CLI',
  docs_nian_card_desc: '登录神念后即可使用内置 Agent，适合作为第一次体验和日常轻量助手。',
  docs_codex_title: '使用 Codex',
  docs_codex_desc:
    'Codex 适合代码修改、项目理解、测试修复和工程任务。神念负责把 Codex 在原电脑上的输出、工具调用和进度同步到手机、Web 和桌面端。',
  docs_codex_step_install_title: '在目标电脑准备 Codex CLI',
  docs_codex_step_install_desc: '先按 Codex 官方方式安装并登录，确认本机终端可以直接运行 codex。',
  docs_codex_step_machine_title: '在神念选择在线机器',
  docs_codex_step_machine_desc:
    '机器在线后，神念会探测可用 Agent 和模型。选择 Codex，并确认要操作的工作目录。',
  docs_codex_step_run_title: '发送工程任务',
  docs_codex_step_run_desc:
    '像聊天一样描述修改、排查或测试需求。任务仍在原电脑执行，你可以从任意设备继续跟进。',
  docs_codex_tip:
    '如果神念里看不到 Codex，先确认目标电脑终端能独立运行 codex，再刷新 Agent 列表或重启 daemon。',
  docs_claude_code_title: '使用 Claude Code',
  docs_claude_code_desc:
    'Claude Code 适合长上下文代码理解、跨文件改造和本地项目协作。使用前先在目标电脑安装并登录 Claude Code。',
  docs_claude_code_step_install_title: '在目标电脑准备 Claude Code',
  docs_claude_code_step_install_desc:
    '确认本机终端可以直接运行 claude，并且账号登录、模型选择等上游配置已经完成。',
  docs_claude_code_step_machine_title: '选择机器和工作目录',
  docs_claude_code_step_machine_desc:
    '在神念里选择在线机器和 Claude Code，设置项目工作目录后开始会话。',
  docs_claude_code_step_run_title: '多端继续协作',
  docs_claude_code_step_run_desc:
    '后续可以从手机继续追问、补充需求、查看文件结果，Claude Code 仍在原电脑上工作。',
  docs_claude_code_tip:
    'Claude Code 的安装、登录和账号授权仍以本机 CLI 为准；神念只接管会话控制面和多端同步。',
  docs_other_agents_title: '其他 Agent',
  docs_other_agents_desc:
    'OpenCode、Cursor Agent 等本地 Agent 可以通过统一入口接入神念。它们的安装、登录和账号授权仍以各自 CLI 为准。',
  docs_other_agents_card_supported_title: '统一入口',
  docs_other_agents_card_supported_desc:
    '神念负责探测命令、展示可用入口，并把会话同步到手机、Web 和桌面端。',
  docs_other_agents_card_local_title: '先能本地运行',
  docs_other_agents_card_local_desc:
    '如果列表里看不到某个 Agent，先确认它能在目标电脑终端里独立运行。',
  docs_other_agents_card_refresh_title: '刷新探测结果',
  docs_other_agents_card_refresh_desc:
    '新安装 Agent 后，可以刷新 Agent 列表或重启 daemon，让神念重新探测命令和模型。',
  docs_agent_module_pending:
    '本章先占位为独立模块，后续会补安装、登录、使用建议、模型选择和常见失败处理。',
  docs_custom_agent_arch_tip:
    '这一章后续只保留接入步骤和最小协议；长代码示例会拆到自定义 Agent 专门页面，避免主文档过重。',
  docs_wechat_title: 'Agent使用微信',
  docs_wechat_overview_title: '概览',
  docs_wechat_intro:
    'Agent使用微信让神念里的 Agent 使用你电脑上的微信，主要完成两件事：向某个微信对话发送消息，接收这个微信对话里的新增消息。微信仍然运行在你的本机，神念不会托管你的微信账号。',
  docs_wechat_prereq_title: '前提条件',
  docs_wechat_req_install_title: '已安装桌面端或 CLI',
  docs_wechat_req_install_desc:
    '普通电脑建议安装神念桌面端；服务器或开发者机器可以安装 Shennian CLI。机器需要完成登录或配对，并保持在线。',
  docs_wechat_req_local_title: '微信与 Agent 在同一台机器',
  docs_wechat_req_local_desc:
    '当前只支持 Mac 或 Windows 桌面微信。微信、神念连接器和被绑定的 Agent 会话必须在同一台机器上。',
  docs_wechat_req_helper_title: 'Mac 需要配置 Helper 权限',
  docs_wechat_req_helper_desc:
    'macOS 上需要在神念桌面端打开“Agent使用微信”或“使用微信”入口进行 Helper 安装、修复和权限引导，补齐屏幕录制、辅助功能、自动化等系统权限。',
  docs_wechat_req_account_title: 'Pro / Team 与可用积分',
  docs_wechat_req_account_desc:
    'Agent使用微信属于外部消息能力，需要账号具备 Pro / Team 权益，并且有可用积分完成视觉识别、结构化读取和发送确认。',
  docs_wechat_safety_title: '原理和安全',
  docs_wechat_safety_desc:
    '神念具备 Computer Use 能力：它会通过多模态大模型理解电脑屏幕，并像真人一样操作电脑和微信，例如打开指定对话、读取可见消息、输入并发送回复。',
  docs_wechat_safety_computer_use_title: 'Computer Use',
  docs_wechat_safety_computer_use_desc:
    '通过屏幕理解、截图识别、点击、输入和剪贴板等本机动作使用微信，动作发生在你的电脑上。',
  docs_wechat_safety_capability_title: '只做可见读写',
  docs_wechat_safety_capability_desc:
    '主要能力是向指定微信对话发送消息，以及接收这个对话里的新增可见消息。',
  docs_wechat_safety_no_low_level_title: '不解析底层敏感数据',
  docs_wechat_safety_no_low_level_desc:
    '不解析微信底层通信、协议、数据库或其他敏感数据，不注入微信进程，也不会绕过微信客户端规则。',
  docs_wechat_safety_no_storage_title: '不存储微信消息',
  docs_wechat_safety_no_storage_desc:
    '神念不会把微信消息存成云端聊天记录，也不会把历史聊天记录上传成备份。',
  docs_wechat_safety_cursor_tip:
    '绑定神念某个对话时，只会记录最后几条消息作为 cursor 标记，用来判断哪些消息已经看过、下次从哪里继续；这个标记不是完整聊天记录。',
  docs_wechat_step_session_title: '打开神念 Agent 对话',
  docs_wechat_step_session_desc:
    '先在已准备好的同一台机器上启动 Claude Code、Codex、OpenCode、Nian 或自定义 Agent，进入对应的神念对话。',
  docs_wechat_step_channel_title: '进入使用微信绑定页',
  docs_wechat_step_channel_desc:
    '从神念对话右上角进入“外部消息”或“外部消息渠道”，选择“使用微信”。这个入口绑定的是当前神念对话。',
  docs_wechat_step_conversation_title: '填写微信对话名称',
  docs_wechat_step_conversation_desc:
    '输入微信左侧列表里显示的联系人或群名，打开“启用”，保存。当前一个神念 Agent 对话绑定一个微信对话名称。',
  docs_wechat_step_agent_title: '让新消息进入 Agent',
  docs_wechat_step_agent_desc:
    '绑定后，神念在本机按节奏检查这个微信对话。新增消息会进入绑定的神念会话，Agent 的回复会回写到同一个微信对话。',
  docs_wechat_cli_title: 'Agent使用微信 CLI',
  docs_wechat_cli_desc:
    '`shennian wechat` 是给 Agent 使用本机微信的命令入口。普通使用先跑 doctor；read / write 默认输出给人和 Agent 阅读，只有脚本解析时才加 JSON。',
  docs_wechat_skill_install_title: '给外部智能体安装 Skill',
  docs_wechat_skill_install_desc:
    '如果你想让 Codex、Claude Code、PolyCode 或其他支持 Skill 的智能体直接使用这个微信能力，把下面这段话发给它，让它按自己的 Skill 机制安装。',
  docs_wechat_cli_tip:
    '只在用户明确要求读取某个微信对话时运行 read。发送消息前要确认目标对话和完整内容；神念不会托管你的微信账号，也不会绕过微信客户端规则。',
  docs_wechat_binding_title: '绑定神念对话和微信对话',
  docs_wechat_binding_desc:
    'CLI 适合单次读写；绑定适合持续处理某个微信联系人或群。绑定后，微信新增消息会进入对应神念 Agent 对话，Agent 回复会回到同一个微信对话。',
  docs_wechat_binding_tip:
    '绑定后的第一次扫描只建立基线，不会把历史消息灌进 Agent。后续只有新增消息进入会话；当前不做跨机器绑定，也不做个人微信云端托管。',
  docs_wechat_daily_title: '日常使用',
  docs_wechat_daily_desc:
    '绑定后，保持这台机器在线，微信处于已登录状态。你可以在手机、Web 或桌面端继续和 Agent 对话；真正读写微信的动作仍发生在绑定的那台电脑上。不可用时先运行 shennian wechat doctor，或到「设置 → Agent使用微信 / 使用微信」查看机器状态。',
  docs_enterprise_wecom_title: '企业微信托管群',
  docs_enterprise_wecom_intro:
    '企业微信托管群是面向已开通客户的外部消息能力：你在神念里扫码绑定自己的企业微信账号，再把某个企业微信群绑定到一个神念 Agent 对话。群里 @ 已托管的企业微信账号后，消息会进入这个 Agent；Agent 需要回复时，通过已绑定的同一个群发回。',
  docs_enterprise_wecom_prereq_title: '权益和前提',
  docs_enterprise_wecom_req_entitlement_title: '需要企业微信隐藏权益',
  docs_enterprise_wecom_req_entitlement_desc:
    '入口只对已人工开通 managed_wecom 的账号显示；仅 Pro、Team 或普通企业级别不一定包含该隐藏能力。若看不到入口，请联系神念开通。',
  docs_enterprise_wecom_req_manager_title: '需要支持外部消息的 Agent 对话',
  docs_enterprise_wecom_req_manager_desc:
    '绑定群发生在具体神念对话里。当前推荐使用 Manager / Nian / Codex / Claude Code 等支持外部通道提示词和发送命令的会话。',
  docs_enterprise_wecom_req_account_title: '准备可扫码登录的企业微信',
  docs_enterprise_wecom_req_account_desc:
    '使用你自己的企业微信手机端扫码确认。首版一个神念账号只绑定一个托管企业微信账号，掉线或过期后可重新扫码。',
  docs_enterprise_wecom_entry_title: '进入入口并绑定群',
  docs_enterprise_wecom_entry_desc:
    '先在个人页完成企业微信账号绑定，再回到要接入外部群的 Agent 对话，从对话右上角进入外部消息配置。',
  docs_enterprise_wecom_step_profile_title: '个人页 → 企业微信',
  docs_enterprise_wecom_step_profile_desc:
    '登录神念 Web/App，打开个人页。已开通 managed_wecom 后会看到“企业微信”入口；未开通时页面会提示企业客户专属。',
  docs_enterprise_wecom_step_qr_title: '选择地区并扫码登录',
  docs_enterprise_wecom_step_qr_desc:
    '进入企业微信页后选择常用登录地区，点击绑定/重新登录，使用企业微信手机端扫码。若手机端出现 6 位验证码，把验证码填回神念页面完成登录。',
  docs_enterprise_wecom_step_sync_title: '同步群会话',
  docs_enterprise_wecom_step_sync_desc:
    '账号状态变为在线后，点击同步。页面只展示可绑定的企业微信群；如果新群没出现，先确认账号在群内，再点刷新同步。',
  docs_enterprise_wecom_step_session_title: '打开 Agent 对话 → 外部消息',
  docs_enterprise_wecom_step_session_desc:
    '打开要处理这个群的神念 Agent 对话，点右上角外部消息入口，选择“企业微信”，再选择刚同步到的群。',
  docs_enterprise_wecom_step_save_title: '设置监听与回复并保存',
  docs_enterprise_wecom_step_save_desc:
    '默认“仅 @ 时触发”；也可改为“全部消息”。确认“允许回复”开关和自定义约束后保存。一个神念对话当前绑定一个企业微信群。',
  docs_enterprise_wecom_config_title: '企业微信应用、机器人、凭证和回调',
  docs_enterprise_wecom_config_desc:
    '当前用户侧不需要创建企业微信自建应用、群机器人，也不需要填写 Secret、Token、Webhook 或回调 URL；这些由神念服务端和 QiWe 托管层统一管理。',
  docs_enterprise_wecom_config_no_app_title: '无需用户创建应用或机器人',
  docs_enterprise_wecom_config_no_app_desc:
    '现有实现是扫码托管企业微信账号，不是让用户在企业微信后台新建应用、群机器人或复制 Webhook。',
  docs_enterprise_wecom_config_callback_title: '凭证和回调由服务端管理',
  docs_enterprise_wecom_config_callback_desc:
    'QiWe API Token、设备 guid 和回调密钥只保存在神念服务端；客户端和本机 daemon 不持有平台密钥。回调地址由服务端自动设置。',
  docs_enterprise_wecom_config_area_title: '登录地区用于稳定扫码',
  docs_enterprise_wecom_config_area_desc:
    '神念会按请求 IP 推荐登录地区，你也可以手动选择常用地区，减少企业微信新设备登录提醒异常。',
  docs_enterprise_wecom_behavior_title: '群里如何触发和回复',
  docs_enterprise_wecom_behavior_trigger_title: '默认 @ 托管账号触发',
  docs_enterprise_wecom_behavior_trigger_desc:
    '群聊默认 listenMode=mention_only：普通消息只进入服务端短期上下文缓存；有人 @ 这个托管企业微信账号时，神念把本次 @ 后所需上下文投递给绑定的 Agent。',
  docs_enterprise_wecom_behavior_reply_title: 'Agent 用绑定路由回复',
  docs_enterprise_wecom_behavior_reply_desc:
    'Agent 不需要知道群 ID。普通 Agent 使用 shennian external send，Manager 使用 shennian manager external send；服务端按当前神念对话绑定发回同一个群。关闭“允许回复”后只接收不发送。',
  docs_enterprise_wecom_behavior_media_title: '文本优先，媒体按附件处理',
  docs_enterprise_wecom_behavior_media_desc:
    '入站图片、文件、视频、音频会作为短时效附件投递到本机工作目录；回复默认用文字。只有用户明确要求发图片/文件时，Agent 才通过 send-image/send-file 等命令发送本地文件。',
  docs_enterprise_wecom_behavior_tip:
    '群聊默认不会把历史消息一次性灌进 Agent。第一次绑定后只对后续触发消息生效；“全部消息”模式适合低噪声专用群，客户大群请优先使用仅 @ 触发。',
  docs_enterprise_wecom_unbind_title: '解绑、停用和重新扫码',
  docs_enterprise_wecom_unbind_desc:
    '在 Agent 对话的外部消息页关闭“启用”或删除绑定，可停止该群进入当前对话；在个人页 → 企业微信中，已绑定群旁可打开对应会话或解除这个群绑定。页面底部“解除绑定”会删除整个托管企业微信账号及其会话绑定；账号离线、二维码过期或撤销时，使用“重新登录/刷新二维码”重新扫码。',
  docs_enterprise_wecom_safety_title: '权限和安全提示',
  docs_enterprise_wecom_safety_entitlement_title: '服务端强校验',
  docs_enterprise_wecom_safety_entitlement_desc:
    '账号绑定、会话同步、群绑定和发送接口都会校验 managed_wecom；Manager 绑定还需要外部消息/Manager 能力，旧客户端或 API 不能绕过。',
  docs_enterprise_wecom_safety_scope_title: '最小绑定范围',
  docs_enterprise_wecom_safety_scope_desc:
    '一个绑定只连接一个神念对话和一个企业微信群。Agent 回复默认回到这个群，不允许 Agent 自行选择其他群或接触平台密钥。',
  docs_enterprise_wecom_safety_unbind_title: '可随时停用',
  docs_enterprise_wecom_safety_unbind_desc:
    '可以关闭单个对话绑定、关闭允许回复、或解除整个企业微信账号绑定。外部消息缓存和短时效附件由服务端按策略清理。',
  docs_enterprise_wecom_trouble_title: '常见故障排查',
  docs_enterprise_wecom_trouble_no_entry_title: '看不到“企业微信”入口',
  docs_enterprise_wecom_trouble_no_entry_desc:
    '确认当前登录的是已开通 managed_wecom 的账号。只有 Pro/Team 但没有该隐藏权益时，入口仍不会显示。',
  docs_enterprise_wecom_trouble_qr_title: '二维码过期或扫码后仍未在线',
  docs_enterprise_wecom_trouble_qr_desc:
    '点击刷新二维码/重新登录，确认企业微信手机端完成确认；若出现 6 位验证码，必须填回神念页面。必要时切换到常用登录地区再试。',
  docs_enterprise_wecom_trouble_empty_title: '同步后没有群',
  docs_enterprise_wecom_trouble_empty_desc:
    '确认托管账号已经加入目标外部群，再点击同步；当前页面主要展示群会话，个人会话不是默认绑定目标。',
  docs_enterprise_wecom_trouble_no_trigger_title: '群里发了消息 Agent 没反应',
  docs_enterprise_wecom_trouble_no_trigger_desc:
    '默认仅 @ 托管企业微信账号时触发；检查外部消息页已启用、选择了正确群、账号在线，并确认绑定的机器/Agent 会话可接收任务。',
  docs_enterprise_wecom_trouble_no_reply_title: 'Agent 收到但没有回群',
  docs_enterprise_wecom_trouble_no_reply_desc:
    '检查“允许回复”是否开启；Agent 需要使用 shennian external send 或 shennian manager external send，而不是在神念聊天里普通回复。',
  docs_files_title: '文件与附件',
  docs_files_intro:
    '神念把本机项目文件、上传附件和 Agent 生成结果放在同一个控制面里。你可以从会话进入工作目录，搜索文件、预览文本、图片和 HTML，下载单个文件或文件夹 ZIP，也可以把手机里的截图、文档上传到当前任务。',
  docs_files_image_alt: '神念文件浏览器截图',
  docs_files_card_title: '把文件上下文交给 Agent',
  docs_files_card_desc:
    '需要让 Agent 看某个文件时，用 @引用把它插入对话；Markdown 文件还可以预览、编辑，并按需导出源文件或 PDF。',
  docs_projects_sessions_title: '项目与会话管理',
  docs_projects_sessions_desc:
    '神念里的项目首先由工作目录承载：启动 Agent 时确认目录，后续消息、附件和文件浏览都会围绕这个目录展开。',
  docs_projects_sessions_card_workdir_title: '工作目录承载项目',
  docs_projects_sessions_card_workdir_desc:
    '选择目录后，Agent 的文件读写、附件引用和结果下载都围绕这套本机上下文进行。',
  docs_projects_sessions_card_session_title: '会话记录一次工作流',
  docs_projects_sessions_card_session_desc:
    '一个会话记录所选机器、Agent、模型、工作目录、消息、工具调用和结果文件。',
  docs_projects_sessions_card_context_title: '恢复与隔离',
  docs_projects_sessions_card_context_desc:
    '你可以从列表恢复上下文；切换 Agent 会创建新会话，避免不同 Agent 的上下文互相污染。',
  docs_skills_title: 'Agent 原生能力',
  docs_skills_desc:
    '神念只读展示 Codex、Claude Code 和 WorkBuddy 已经安装的原生 Skill / 插件能力，不建设自己的 Skill 市场。',
  docs_skills_card_install_title: '由 Agent 自己管理',
  docs_skills_card_install_desc:
    '安装、升级和权限确认都在对应 Agent 中完成；神念不下载、不修复、不托管能力包。',
  docs_skills_card_call_title: '从远端插入调用',
  docs_skills_card_call_desc:
    '在聊天加号中选择 Agent 能力，神念把原生 `$skill` 或 `/skill` 调用插入草稿，由用户确认后发送。',
  docs_skills_card_repair_title: '首版支持范围',
  docs_skills_card_repair_desc:
    '首版只支持 Codex、Claude Code 和 WorkBuddy；其它 Agent 仍可正常对话，但不展示能力选择器。',
  docs_skills_arch_tip:
    '神念只传输能力名称、描述、来源和原生调用字符串，不上传 Skill 正文、脚本或本机绝对路径。',
  docs_multi_device_title: '多设备接管',
  docs_multi_device_desc:
    '手机 App、Web 和桌面端使用同一个账号。电脑在线后，你可以从任意设备打开同一个会话，继续补充指令、查看 Agent 输出、检查文件和下载结果。',
  docs_multi_device_image_alt: '神念分享和多端接管截图',
  docs_multi_device_card_title: '离开电脑也能继续',
  docs_multi_device_card_desc:
    'Agent 不需要迁移到手机；任务仍在原电脑执行，你只是换一个控制面继续操作。',
  docs_status_sync_title: '通知与状态同步',
  docs_status_sync_desc:
    '神念会同步连接状态、消息状态、Agent 执行进度和文件操作结果，帮助你判断问题发生在网络、daemon 还是 Agent 本身。',
  docs_status_sync_card_connection_title: '连接状态',
  docs_status_sync_card_connection_desc:
    '界面会展示连接中、收取中、发送中、网络异常、CLI 连接不上等状态。',
  docs_status_sync_card_progress_title: '执行进度',
  docs_status_sync_card_progress_desc:
    'Agent 输出、工具调用、待执行状态和文件操作结果会实时回到当前设备。',
  docs_status_sync_card_errors_title: '错误定位',
  docs_status_sync_card_errors_desc:
    'Agent 执行出错、权限缺失或外部能力不可用时，优先看页面状态和对应排障命令。',
  docs_status_sync_tip:
    '产品文案里可以理解为实时状态同步；自定义 Agent 协议里的 notify 当前仍是未来保留能力，不要把它当作已开放主动通知接口。',
  docs_machine_management_title: '机器管理',
  docs_machine_management_desc:
    '机器是神念的第一层入口。机器列表展示每台电脑的在线状态、系统、版本、可用 Agent 和共享标记；机器详情承接重命名、解绑、重新配对、刷新 Agent 和模型列表等操作。',
  docs_machine_card_status_title: '状态与版本',
  docs_machine_card_status_desc:
    '快速判断机器是否在线、连接器版本是否需要升级，以及当前系统是否支持某项能力。',
  docs_machine_card_agents_title: 'Agent 与模型探测',
  docs_machine_card_agents_desc:
    '刷新已安装 Agent、模型列表和工作目录入口，让每台机器展示自己真实可用的能力。',
  docs_machine_card_share_title: '共享访问',
  docs_machine_card_share_desc:
    '通过邀请码或二维码接受共享机器，并按只查看、可使用、完全控制、管理员等权限协作。',
  docs_advanced_badge: '开发者与服务器',
  docs_cli_title: 'CLI 安装',
  docs_cli_intro2:
    '如果你在服务器、NAS 或无图形界面环境使用神念，可以用 CLI 接入。要求 Node.js 18 或以上版本。',
  docs_troubleshooting_title: '排障',
  docs_troubleshooting_intro2:
    '普通电脑优先看桌面端自动配置状态；CLI 机器则先检查 daemon，再按需重新配对。',
  docs_fix_offline_title: '机器离线',
  docs_fix_offline_desc: '先确认桌面端或 CLI daemon 正在运行，并且当前网络可以访问 shennian.net。',
  docs_fix_agent_title: 'Agent 不可用',
  docs_fix_agent_desc:
    '确认对应的 Claude Code、Codex、OpenCode 等客户端已经安装并完成登录或初始化。',
  docs_fix_repair_title: '重新配对',
  docs_fix_repair_desc:
    '机器被移除、Token 失效或更换账号后，再执行重新配对。普通情况下不需要反复扫码。',
  docs_fix_upgrade_title: '升级失败',
  docs_fix_upgrade_desc: '如果 shennian 升级连续失败，先用 npm 删除全局包，再重新安装最新版。',
  docs_fix_wechat_title: 'Agent使用微信不可用',
  docs_fix_wechat_desc:
    '先跑 shennian wechat doctor，或在设置里的使用微信机器看板检查 Helper、权限、微信登录、会员和积分。',
  docs_customer_support_title: '人工客服',
  docs_customer_support_desc: '扫码添加神念企业微信客服，发送你的问题截图、机器状态和错误提示。',
  docs_customer_support_qr_title: '企业微信客服',
  docs_customer_support_qr_desc:
    '遇到安装、配对、Agent 登录或 Agent使用微信排障问题时，直接扫码联系人工客服。',
  docs_customer_support_qr_alt: '神念企业微信客服二维码',
  docs_customer_support_cta: '打开支持页',
  docs_custom_agent_title: '自定义 Agent 接入',
  docs_custom_agent_intro2:
    '自定义 Agent 是稳定开放给开发者的接入方式：你只需要实现一个本地命令，Shennian 负责把手机 / 浏览器里的消息转成 stdin，把 stdout 里的 JSON Lines 事件流转回客户端。Agent 不需要接入 WebSocket、HTTP 或服务端数据库。',
  docs_custom_agent_card_caps_title: '1. 声明能力',
  docs_custom_agent_card_caps_desc:
    '实现 /caps，输出名称、模型列表、spawn 模式、是否支持 resume。Shennian 用它在 UI 里展示可选 Agent 和模型。',
  docs_custom_agent_card_run_title: '2. 接收一轮任务',
  docs_custom_agent_card_run_desc:
    '实现 /run，从 stdin 读取用户消息；CLI 会传入 --workdir、--session、--model、--resume 和附件路径。',
  docs_custom_agent_card_events_title: '3. 输出事件流',
  docs_custom_agent_card_events_desc:
    'stdout 每一行都是 JSON 对象。先发 delta 或 tool-call，让用户马上看到进度，最后用 final 结束本轮。',
  docs_custom_agent_flow_title: '完整数据流',
  docs_custom_agent_flow_desc:
    '最小可用 Agent 只有两个入口：/caps 用于能力探测，/run 用于处理一条用户消息。下面的 JSONL 就是 Shennian 期望读取的公开格式。',
  docs_custom_agent_events_title: '公开事件格式',
  docs_custom_agent_events_desc:
    '这些 state 是 v1 稳定开放给自定义 Agent 的输出协议。Shennian 会自动补齐内部 runId / seq 并同步到手机、浏览器和桌面端。',
  docs_custom_agent_event_delta:
    '流式文本片段。用于正常回复，也可以带 thinking:true 展示为思考内容。',
  docs_custom_agent_event_final:
    '本轮完成。每次成功回复都必须以 final 结束，可附带 usage 和 agentSessionId。',
  docs_custom_agent_event_error: '本轮失败并结束。message 会展示给用户。',
  docs_custom_agent_event_tool_call:
    '展示 Agent 正在调用的本地工具；工具由 Agent 自己执行，Shennian 只负责展示。',
  docs_custom_agent_event_tool_result: '展示本地工具结果，适合列目录、读文件、搜索等进度回放。',
  docs_custom_agent_first_event_tip:
    '第一个有效事件推荐发 delta，例如 {"state":"delta","text":"已收到任务，开始处理。\\n"}。start / init 是 Shennian 内部归一化事件，notify 是未来主动通知能力，v1 不要把它们当作成功信号。',
  docs_custom_agent_resume_title: '会话恢复',
  docs_custom_agent_resume_desc:
    '如果 /caps 里设置 resume:true，Agent 在 final 里返回自己的 agentSessionId。下一轮 Shennian 会把这个值通过 --resume 传回去；上下文如何持久化由 Agent 自己决定。',
  docs_custom_agent_attachments_title: '附件与工作目录',
  docs_custom_agent_attachments_desc:
    'Shennian 会把用户选择的文件作为本机绝对路径传给 --attachment，同时传入 --workdir。Agent 可以像普通 CLI 一样直接读取项目文件、图片、PDF 或其他素材。',
  docs_custom_agent_boundaries_title: '不要依赖的内部格式',
  docs_custom_agent_boundary_start:
    '不要输出 start / init 作为自定义 Agent 成功信号；它们属于 Shennian 内部事件。',
  docs_custom_agent_boundary_notify:
    'notify 暂时是未来保留能力，当前 spawn 模式下不要用它表达一轮回复完成。',
  docs_custom_agent_boundary_internal:
    '不要依赖 Relay Frame、数据库表结构、内置 Claude / Codex adapter 的私有解析格式或 ~/.shennian/config.json 的完整内部结构。',
  docs_install_intro:
    '需要 Node.js 18 或以上版本。选择以下任意方式启动，首次运行约 2 分钟完成配置。',
  docs_install_opt_npx: '全局安装（一次性设置）',
  docs_install_opt_global: '全局安装后直接调用（常驻 / 自启动推荐）',
  docs_pairing_intro: '配对只需一次，之后永久有效。整个过程不超过 30 秒。',
  docs_pairing_step1_title: '在目标机器上运行 CLI',
  docs_pairing_step1_desc:
    '先执行 npm install -g shennian@latest，再运行 shennian。CLI 会自动注册到中继服务器并打印二维码和配对 Token。',
  docs_pairing_step2_title: '打开神念 App',
  docs_pairing_step2_desc:
    '在手机上打开神念 App，进入「设置」页面，点击「扫码」，或在「我的机器」中点击「添加机器」。',
  docs_pairing_step3_title: '扫码或粘贴 Token',
  docs_pairing_step3_desc:
    '扫描终端中显示的二维码，或选择「粘贴 Token」，输入以 sn- 开头的配对码。',
  docs_pairing_step4_title: '配对完成',
  docs_pairing_step4_desc:
    '机器出现在 App 机器列表中，状态变为「在线」。下次启动 CLI 无需重新配对。',
  docs_pairing_tip:
    '提示：如果机器重置或 Token 失效，在 App 机器详情页点击「重新配对」重新生成 Token。',
  docs_first_msg_intro: '配对完成后，选择一台在线机器，启动 Agent，即可开始对话。',
  docs_first_msg_step1_title: '选择机器',
  docs_first_msg_step1_desc: '在 App 底部切换到「机器」标签，点击一台状态为「在线」的机器。',
  docs_first_msg_step2_title: '选择 Agent',
  docs_first_msg_step2_desc:
    '从列表中选择 Agent（Claude、Codex、Cursor、OpenCode 或 Nian），设置工作目录。',
  docs_first_msg_step3_title: '启动 Agent',
  docs_first_msg_step3_desc: '点击「启动」，等待 Agent 就绪（通常 3-5 秒）。',
  docs_first_msg_step4_title: '发送消息',
  docs_first_msg_step4_desc:
    '在输入框输入消息，点击「发送」。Agent 的回复将实时流式返回到对话界面。',
  docs_first_msg_tip: '可点击输入框右侧的 📎 图标，选择本机文件作为上下文附件。',
  docs_cli_intro: '这些是普通用户日常使用、排障、升级和接入自定义 Agent 需要知道的命令。',
  docs_cli_commands_title: '命令',
  docs_cli_flags_title: '标志',
  docs_troubleshooting: '排障',
  docs_supported_agents_title: '内置 Agent',
  docs_cli_flag_name_desc: '设置机器名称（默认：hostname）',
  docs_cli_flag_api_desc: '临时覆盖本次命令使用的服务端地址',
  docs_cli_flag_version_desc: '显示版本号',
  docs_cli_note:
    '节点、配对信息和自定义 Agent 都保存在本机配置里。普通用户通常不需要设置环境变量。',
  docs_cmd_smart_start: '智能启动：需要时先配对，然后启动后台 daemon。',
  docs_cmd_pair: '重新配对这台电脑，生成新的二维码或 Token。',
  docs_cmd_start: '启动后台服务，并启用开机自启动。',
  docs_cmd_stop: '停止后台服务，并关闭远程访问。',
  docs_cmd_status: '查看后台服务是否在线，以及日志文件位置。',
  docs_cmd_logs: '打印最近的后台服务日志，用于排障。',
  docs_cmd_config: '查看本机配置，例如节点和机器 id。',
  docs_cmd_config_server: '切换国内 / 海外节点，切换后需要 stop && start。',
  docs_cmd_upgrade: '升级 CLI 到 npm 上的最新版。',
  docs_cmd_agent_add: '探测能力后，注册一个自定义 Agent 命令。',
  docs_cmd_agent_list: '列出已注册的自定义 Agent。',
  docs_cmd_agent_remove: '从这台机器移除一个自定义 Agent。',
  docs_troubleshooting_intro: '如果 App 连不上电脑，先排查 daemon，再按需重新配对。',
  docs_troubleshooting_step1_title: '检查状态',
  docs_troubleshooting_step1_desc: '运行 shennian status，确认本机后台服务是否正在运行。',
  docs_troubleshooting_step2_title: '重启 daemon',
  docs_troubleshooting_step2_desc:
    '运行 shennian stop && shennian start。配对信息和节点配置都会保留。',
  docs_troubleshooting_step3_title: '凭据变化时重新配对',
  docs_troubleshooting_step3_desc:
    '如果机器重置、在 App 中被移除，或 Token 过期，运行 shennian pair。',
  docs_troubleshooting_step4_title: '检查 Agent CLI',
  docs_troubleshooting_step4_desc:
    '安装你想远程控制的 CLI，例如 claude、codex、cursor agent 或 opencode。',
  docs_restart_warning:
    '重启 daemon 会让 App 与这台电脑短暂断开，并可能中断正在运行的本地 Agent 会话。',
  docs_custom_agent_intro:
    '自定义 Agent 本质上就是一个本地命令。它用 /caps 声明能力，用 /run 从 stdin 接收用户消息，并向 stdout 输出 JSON Lines 事件。',
  docs_custom_agent_proto_title: '最小协议',
  docs_custom_agent_proto_caps:
    '/caps 输出一个 JSON 对象，包含 name、models 或 model、mode，以及可选的 version。shennian agent add 会用它做能力探测。',
  docs_custom_agent_proto_run:
    '/run 通过 stdin 接收用户消息。CLI 还会在可用时传入 --workdir、--session、--resume 和 --model。',
  docs_custom_agent_proto_events:
    'stdout 使用 JSON Lines。delta 表示流式文本，final 表示结束，error 表示失败，也可输出 tool-call、tool-result。notify 暂为未来保留能力。',
  docs_custom_agent_register_title: '注册并刷新',
  docs_custom_agent_tip: '从 Demo 改起，把回复逻辑替换成自己的模型或工具调用即可。不需要额外 SDK。',
  docs_custom_agent_node_demo: 'Node.js Demo',
  docs_custom_agent_node_intro: '保存为 my-agent.js。这是一个零依赖的完整 spawn 模式 Agent。',
  docs_custom_agent_python_demo: 'Python Demo',
  docs_custom_agent_python_intro:
    '保存为 my_agent.py。只使用 Python 标准库，可以改造成任意模型服务。 ',
  msg_sending: '发送中…',
  msg_still_sending: '发送中…',
  msg_uncertain: '发送中…',
  msg_queued: '待执行',
  msg_edit_queued: '编辑',
  msg_editing_queued: '正在编辑待执行消息',
  msg_edit_queued_failed: '消息已开始执行或编辑失败',
  msg_delete_queued: '取消',
  queued_attachment_only: '附件消息',
  queued_attachment_count: '{{count}} 个附件',
  msg_resend: '重发',
  msg_send_failed: '发送失败',
  quote_message: '引用',
  voice_action: '语音输入',
  voice_start: '开始录音',
  voice_listening_inline: '正在识别',
  voice_optimizing_inline: '优化中',
  voice_optimizing_continue: '正在优化，轻点继续语音输入',
  voice_listening_status: '听写中 {{duration}}',
  voice_refining_status: '正在优化文本…',
  voice_permission_denied: '未获得麦克风权限',
  voice_recording_failed: '录音启动失败',
  voice_live_unsupported: '当前环境暂不支持实时语音识别',
  voice_processing_failed: '语音整理失败，请重试',
  msg_error_network: '网络连接异常',
  msg_error_cli: 'CLI 连接不上',
  msg_error_agent: 'Agent 执行出错',
  footer_brand: '神念',
  footer_slogan: 'AI Agent 控制面',
  footer_copyright: '© 2026 神念',
  landing_community_eyebrow: '加入社区',
  landing_community_title: '加入微信群',
  landing_community_xhs_desc: '',
  landing_community_xhs_cta: '关注小红书',
  landing_community_wechat_label: '微信群',
  landing_community_wechat_title: '扫码加入微信群',
  landing_community_wechat_desc:
    '这是神念用户群，用于获取更新、交流用法和反馈问题。申请加群时，请提供用户 ID，或发送神念产品截图用于验证。',
  landing_community_wechat_alt: '神念微信群二维码',
  logout_confirm: '确定要退出登录吗？',
  account_delete: '注销账号',
  account_delete_warning:
    '将永久删除你的账号、个人 AI 对话、已绑定机器、Agent 及同步数据，并退出全部群聊。已发送的群聊消息按六个月期限保留并显示为“已注销用户”。此操作不可恢复。',
  account_delete_progress: '正在注销账号',
  account_delete_progress_detail: '正在清理账号和设备数据，完成后将自动退出。请勿关闭应用。',
  account_delete_confirm: '确定永久注销？',
  account_delete_failed: '注销失败，请稍后重试。',
  rename_machine: '重命名',
  rename_machine_placeholder: '输入机器名称',
  rename_saving: '保存中…',
  rename_session: '重命名',
  rename_session_placeholder: '输入对话名称',
  model_selector_title: '选择模型',
  model_follow_agent: '跟随智能体',
  model_selector_default: '默认',
  model_selector_current: '当前',
  model_selector_refresh: '刷新模型列表',
  model_selector_search: '搜索模型',
  model_selector_no_results: '没有匹配的模型',
  model_selector_recent: '最近使用',
  model_selector_all: '全部模型',
  model_selector_switch_agent: '切换 Agent',
  model_selector_fastest: '最快',
  model_selector_strongest: '最强',
  reasoning_effort: '思考强度',
  reasoning_effort_low: '低',
  reasoning_effort_medium: '中',
  reasoning_effort_high: '高',
  reasoning_effort_xhigh: '超高',
  reasoning_effort_ultra: 'Ultra',
  reasoning_effort_max: '最大',
  nian_model_standard: '标准',
  nian_model_fast: '快速',
  model_new_session_hint: '切换 Agent 将创建新会话',
  model_refresh_failed: '刷新模型列表失败',
  model_switch_failed: '模型切换失败',
  model_list_empty: '模型列表未加载，请刷新重试',
  model_not_loaded: '未加载',
  model: '模型',
  agents_refresh: '刷新 Agent',
  agents_refresh_short: '刷新',
  agents_refresh_success: 'Agent 列表已刷新',
  agents_refresh_failed: '刷新 Agent 列表失败',
  installed_agents: '已安装',
  available_agents_to_install: '未安装',
  unbind_machine: '移除机器',
  unbind_machine_action: '移除',
  unbind_machine_owner_confirm:
    '移除这台机器，也会将依赖它的智能体从相关群聊移出。智能体资料和群聊历史将保留，不会自动重新加群。',
  unbind_machine_owner_desc: '机器将被永久删除，所有授权记录也会一并清除，该操作不可撤销。',
  unbind_machine_grant_confirm: '是否移除这台机器？',
  unbind_machine_grant_desc: '你将失去对该机器的访问权限，但机器本身不会被删除。',
  unbind_machine_failed: '移除失败，请稍后重试',
  unbinding: '移除中…',
  machines_total: '{{total}} 台',
  scan_pair: '扫码配对',
  scan_title: '扫一扫',
  scan_result_login: '确认在新设备上登录',
  scan_result_room_access: '当前群聊授权已确认',
  scan_result_pair: '机器配对成功',
  scan_result_share: '已接受机器分享',
  enterprise_feature_unavailable: '该功能仅对企业用户开放',
  enter_pair_token: '输入配对 Token',
  or_enter_token: '或手动输入',
  scan_code: '扫一扫',
  scan_hint: '扫描神念二维码，可加入群聊、添加或接受共享机器、确认登录',
  scan_choose_image: '从相册选择二维码',
  scan_photo_permission: '请允许访问相册，以选择二维码图片',
  scan_image_invalid: '图片中没有可识别的神念二维码',
  scan_image_failed: '无法识别这张图片，请换一张清晰的二维码图片',
  camera_permission_title: '需要相机权限',
  camera_permission_message: '请允许使用相机来扫描二维码',
  scan_camera_unavailable: '当前设备不能使用相机，可从相册选择二维码图片',
  ok: '确定',
  pick_image: '图片/视频',
  pick_file: '选择文件',
  paste_image: '粘贴图片',
  no_file_selected: '未选择文件',
  service_region: '线路',
  something_went_wrong: '出了点问题',
  try_again: '重试',
  select_session: '选择会话',
  select_session_hint: '从列表中选择一个会话',
  add_machine_cta: '选择接入方式',
  relay_disconnected: '连接已断开，点击重新配对',
  relay_connected: '已连接',
  relay_connecting: '连接中…',
  no_machine_hint: '未绑定机器，点击添加',
  qr_confirm_failed: '二维码确认失败',
  share_redeem_failed: '分享兑换失败',
  share_access: '共享访问',
  generate_invite: '生成邀请码',
  generating: '生成中…',
  regenerate: '重新生成',
  invite_qr_hint: '对方用神念 App 扫描此码即可获取访问权',
  invite_qr_unavailable: '二维码暂不可用，请复制邀请码发送给对方。',
  invite_code_label: '邀请码',
  copy_token: '复制邀请码',
  token_copied: '已复制',
  pending_redeem: '待兑换',
  redeemed: '已兑换',
  grant_create_failed: '生成邀请码失败',
  grant_create_invalid_response: '邀请码已创建，但服务器返回不完整，请重试。',
  grant_revoke_failed: '撤销失败',
  no_grants: '暂无授权记录',
  share_scope: '共享范围',
  share_scope_whole_machine: '整机',
  share_scope_machine_only_hint:
    '当前只支持整机共享。需要数据隔离时，请为不同团队使用不同机器 / VM。',
  shared_machines: '共享给我的机器',
  shared_badge: '共享',
  perm_badge_view: '仅查看',
  perm_badge_use: '可使用',
  perm_badge_full: '完全控制',
  perm_badge_admin: '管理员',
  redeem_invite: '接受邀请',
  redeem_invite_placeholder: '粘贴邀请码',
  redeem_btn: '接受',
  redeem_loading: '接受中…',
  view_only_hint: '该机器仅允许查看历史记录',
  tab_install_machine: '安装机器',
  tab_accept_invite: '接受邀请',
  accept_invite_desc: '粘贴同事发来的邀请码，即可访问其机器',
  changelog_v010: '初始发布 · 支持 Claude / Codex / Nian，内置文件系统，HTTPS 全程加密。',
  secure_https_wss: 'HTTPS + WSS',
  secure_jwt: 'JWT 认证',
  secure_zero_port: '零端口暴露',
  status_connecting: '连接中…',
  status_syncing: '收取中…',
  network_offline: '当前无网络连接',
  chat_empty_hint: '发送一条消息开始对话',
  long_screenshot: '长截图',
  long_screenshot_generating: '正在生成长截图…',
  long_screenshot_failed_title: '长截图失败',
  long_screenshot_failed_message: '当前对话内容无法生成图片，请稍后再试。',
  manager_wecom_entry: '企业微信联通',
  manager_wecom_title: '企业微信联通',
  manager_wecom_description:
    '为当前对话选择一个微信群。开启后，这个对话会接收群消息，并可按权限发送回复。',
  manager_wecom_enabled: '监听群聊',
  manager_wecom_can_reply: '允许发送回复',
} as const
