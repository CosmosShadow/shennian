// @arch open-source/docs/shared-runtime.md
export const zhAgentSetup = {
  desktop_client_missing_title: '安装独立 Shennian Client',
  desktop_client_missing_body:
    'Desktop 仍可使用账号、群聊和远端机器。本机运行 AI 前，需要为当前用户单独安装并配对 Client。Desktop 不会自动安装 Client、Node.js 或第三方 AI。',
  desktop_client_copy_for_ai: '复制安装要求给 AI',
  desktop_client_manual_install: '查看手动安装方法',
  desktop_client_recheck: '重新检查',
  desktop_client_action_failed: '操作未完成，请重试或直接打开 https://shennian.net/install.md。',
  desktop_client_install_prompt:
    '请打开并遵循 https://shennian.net/install.md，在这台电脑为当前用户安装或复用 Shennian CLI 与官方 Shennian Skill。先检查 shennian --version 与 shennian status --json，已有可用安装不要重复安装。若缺少 Node.js、npm、权限、PATH、网络或配对，请说明具体问题并按官方步骤处理；安装、登录、配对和恢复主动暂停前取得我的确认。不要安装或登录第三方 AI 工具，不要修改项目文件。完成后验证 Shennian CLI 已配对并运行、全新对话能发现 Skill，再告诉我这台机器已经可以在神念中使用。',
  machine_agents_current_summary: '{{name}} 上的 AI 工具',
  machine_agents_more_title: '连接更多 AI 工具',
  machine_agents_missing_hint: '输入想接入的工具，把生成的这句话发给你电脑上的 AI。',
  machine_agents_tool_label: '要接入的 AI 工具',
  machine_agents_tool_placeholder: '例如 Qwen Code',
  machine_agents_copy_help: '复制提示',
  machine_agents_help_prompt:
    '请使用官方 Shennian Skill（{{skillUrl}}）帮我将“{{agent}}”接入神念；如需安装或配对，请按 {{installUrl}} 操作。',
  agents_validation_quota_exceeded:
    '当前 AI 账号的额度、订阅或请求频率限制了这次测试，请在厂商账号中检查后再试。',
  agents_validation_network_failed: '目标电脑暂时无法连接 AI 服务，请检查网络后重试。',
  ai_setup_entry_hint: '选择一个 AI，查看安装、登录和检查步骤。已有可用工具无需重装。',
  ai_setup_entry: 'AI 安装与登录帮助',
  ai_setup_checking: '正在检查…',
  ai_setup_state_offline: '先连接目标电脑',
  ai_setup_state_owner: '请机器主人完成准备',
  ai_setup_state_missing: '还需要准备运行工具',
  ai_setup_state_version: '运行工具版本需要核对',
  ai_setup_state_configuration: '登录或配置需要检查',
  ai_setup_state_login: '需要登录这个 AI 的账号',
  ai_setup_state_unknown: '已发现工具，登录状态待检查',
  ai_setup_state_authenticated: '已检测到登录',
  ai_setup_help_offline:
    '电脑关机、断网或已暂停时，无法检查 AI。请在目标电脑确认神念运行状态；刷新不会解除你主动设置的暂停。',
  ai_setup_help_owner:
    '你可以使用已授权的能力，但不能替机器主人安装或配置 AI。请主人在这台电脑完成准备后再回来检查。',
  ai_setup_help_missing:
    '安装聊天桌面应用不一定包含神念可调用的运行工具。请先核对已有安装，再按官方步骤补齐；不需要重复安装神念。',
  ai_setup_help_version:
    '当前使用的工具与桌面应用版本不一致。请核对实际运行来源和厂商升级说明，再重新检查。神念不会自动升级或关闭现有任务。',
  ai_setup_help_configuration:
    '先按官方说明检查账号、网络和配置。API 或企业配置继续使用已有设置；不要把所有错误都当作没有安装。',
  ai_setup_help_login:
    '运行工具已找到，请在目标电脑完成第三方账号登录，然后回到这里重新检查。神念登录不能代替第三方登录。',
  ai_setup_help_unknown:
    '当前工具或旧版神念尚未返回可确认的登录状态。无需先重装；可在下面发送 hello 测试，或在目标电脑按官方方法核实账号。',
  ai_setup_help_authenticated:
    '检测发现了登录凭据，但没有发送模型请求。可在下面测试所选模型能否回复；测试通过只说明这次连接可用，实际任务仍受额度和权限限制。',
  ai_setup_target: '请在「{{name}}」上操作 · {{os}}',
  ai_setup_tool_version: '当前运行工具版本：{{version}}',
  ai_setup_step_install: '1. 确认运行工具',
  ai_setup_windows:
    'Windows：只有 Codex 桌面应用时，按官方指南准备独立命令行工具。Claude Code 按所用版本的官方 Windows 要求安装。已有 WSL 时，在与工作目录相同的环境安装和登录；不要把两个环境混用。',
  ai_setup_codex_windows:
    'Windows 上的 Codex：神念只使用这台电脑上能直接运行的 Windows 版 Codex 命令行，找不到时不会改用 WSL 里的 Codex。神念会自动识别 Codex 桌面版放在用户目录下的命令行副本；商店包内的程序系统不允许其他程序启动。找不到时，请先打开一次 Codex 桌面版，或另装独立命令行版并加入用户 PATH；也可以用环境变量 SHENNIAN_CODEX_PATH 指向它的完整路径。修改后需要重启神念 Client，再点下面的重新检查。待发送的消息会保留，恢复后自动重试。',
  ai_setup_codex_wsl:
    '如果 Codex 装在 WSL 里：请在 WSL 中再安装并配对一个神念 Client。它会作为另一台电脑出现在你的账号里，需在那台电脑上新建会话；原来在 Windows 上的会话和消息不会转移过去。',
  ai_setup_unix:
    'Mac 会先尝试复用可用的 Codex / Claude 桌面随包工具。没有发现时再按官方指南安装命令行版。Mac / Linux 在终端操作；安装完成后打开一个新终端，确认命令能显示版本。',
  ai_setup_official_install: '查看 {{agent}} 安装步骤',
  ai_setup_step_login: '2. 在目标电脑登录',
  ai_setup_login_hint:
    '打开目标电脑的终端，完成 {{agent}} 官方登录流程。浏览器授权由你本人确认；旧版不支持下面命令时，查看官方登录说明。',
  ai_setup_official_login: '查看官方登录与账号说明',
  ai_setup_account_limits:
    '第三方订阅、API 额度和企业配置由对应账号决定。不要把密码、验证码或密钥发到神念群聊；如果登录取消或失效，可在厂商流程重新登录。',
  ai_setup_optional_ai: '可选：让已有 AI 帮忙',
  ai_setup_optional_hint:
    '需要一个已经能在目标电脑执行命令的 AI。没有其他 AI 时，直接按上面的官方步骤操作，不需要先安装 Skill。',
  ai_setup_copy_prompt: '复制给已有 AI',
  ai_setup_prompt:
    '请帮我在「{{machine}}」（{{os}}）准备 {{agent}}，供神念调用。先确认你能在这台目标电脑执行命令，检查现有神念来源与状态，运行 shennian agent discover 查看实际发现结果；能复用就不重装。按 {{install}} 补齐必要安装，按 {{login}} 引导我本人登录，不索取密码、验证码或密钥，不切换账号。再次 discover 后，使用返回的工具类型 {{type}} 和模型；明确我的项目目录后，执行一次 shennian agent check {{type}} --workdir "项目绝对路径"，实际发送 hello 验证可用性（使用我的模型额度）。只有 ready=true 才算这次测试通过；失败说明具体原因和下一步，不循环发送。旧版不支持命令时按原安装来源升级或让我回神念完成测试，不另装 Client。最后提醒我回神念刷新并继续原任务。不要强制安装 Skill、创建群或智能体、停止已有任务或恢复主动暂停。',
  ai_setup_check_again: '我已完成，重新检查',
  ai_setup_first_task:
    '“重新检查”只刷新工具和登录状态。要确认模型确实能回复，请主动使用下面的 hello 测试；测试通过后返回原任务继续。',
  ai_setup_test_title: '3. 测试能否回复',
  ai_setup_test_hint:
    '选择这台电脑上的项目目录和模型，发送一次 hello 测试。会使用该 AI 的模型额度；测试不创建智能体或群聊，也不发送群消息。',
  ai_setup_test_action: '发送 hello 测试',
  ai_setup_test_running: '正在等待测试回复…',
  ai_setup_test_passed: '测试通过，所选 AI 和模型已返回 hello。可以回到原来的操作继续。',
  ai_setup_test_failed_hint:
    '请按上述原因检查安装、登录、目录、模型权限或网络。修复后可重新测试；已有选择会保留。',
  ai_setup_continue: '返回，继续原来的操作',
  ai_setup_check_failed: '检查未完成。确认机器联网后重试；若安装刚完成，请在目标电脑核对运行环境。',
} as const
