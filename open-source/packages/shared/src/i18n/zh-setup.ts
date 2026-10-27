// @arch open-source/docs/shared-runtime.md
export const zhSetup = {
  setup_show_full_prompt: '查看完整提示',
  setup_room_link: '这是群聊链接',
  setup_room_link_hint: '这个链接用于加入群聊，不会连接或共享机器。前往群聊确认页面？',
  setup_authorization_code: '这是登录或网页授权码。请使用上方扫码入口，核对授权内容后继续。',
  spaces_enter_link: '输入群聊链接',
  spaces_invitation_text: '邀请你加入神念对话「{{name}}」。',
  spaces_group_text: '打开神念对话「{{name}}」。',
  spaces_invite_ai_instruction:
    '直接点击，或把本消息发给你的 AI，让它安装神念、完成配对并加入对话。',
  spaces_group_ai_instruction:
    '已有成员可直接点击，或把本消息发给你的 AI，让它打开这个对话。',
  spaces_invite_url_label: '邀请',
  spaces_group_url_label: '对话',
  spaces_install_url_label: '安装',

  setup_own_computer: '连接自己的电脑',
  setup_own_computer_hint: '在要运行 AI 的电脑上，选择一种安装方式。',
  setup_install_with_ai: '让 AI 帮你安装',
  setup_copy_prompt_to_computer_ai: '把这段完整提示发给目标电脑上的 AI',
  setup_step_install: '安装 Client',
  setup_platform_support: '支持 macOS、Windows 和 Linux',
  setup_client_install_prompt:
    '请阅读 {{url}}，在这台电脑安装或更新神念，引导我完成账号确认和机器配对，连接本机可用的 AI，并询问我还想连接哪些 AI。',
  setup_selfhost_client_install_prompt:
    '在这台电脑安装或更新神念 Client，只连接自托管服务器 {{server}}。使用独立 HOME 和工作目录，不继承官方云账号、历史或密钥。执行 shennian pair --server {{server}} --token，在当前手机实例输入配对码，然后连接本机可用的 AI。不要运行默认官方云配对，也不要关闭 TLS 校验；如实例使用私有 CA，先按管理员说明信任该 CA。',
  setup_copy_install_prompt: '复制安装提示',
  setup_manual_install_client: '手动安装 Client',
  setup_step_connect: '连接机器',
  setup_step_connect_hint: '电脑上显示配对码或二维码后，扫码或输入配对码即可连接；收到机器共享链接也可以直接粘贴。',
  setup_install_prompt_footer: '把这段话发给电脑上的 AI，支持 macOS、Windows 和 Linux。',
  setup_pair_code_placeholder: '输入配对码或共享链接',
  setup_connect: '连接',
  setup_scan_summary: '配对二维码或机器共享二维码',
  setup_install_with_ai_hint:
    '把下面的内容发给目标电脑上的 AI，它会检查已有环境，安装 Shennian CLI 与 Skill，并引导你完成机器配对。',
  setup_manual_install_link: '手动安装',
  setup_manual_install_link_hint: '在官网查看完整安装、配对和 AI 接入方法',
  setup_view_full_install_guide: '查看全文',
  setup_desktop_recommended: '桌面版 · 推荐',
  setup_desktop_summary: 'Mac / Windows，查看下载安装方式',
  setup_server: '服务器 / 命令行安装',
  setup_server_summary: '查看安装与登录步骤',
  setup_already_installed: '已经安装',
  setup_pair: '使用配对码连接',
  setup_pair_summary: '电脑已显示配对码或二维码时使用',
  setup_invite: '收到机器共享邀请',
  setup_invite_summary:
    '接受别人分享的机器，无需在自己的电脑安装 Client。机器共享与加入群聊是不同的授权。',
  setup_invite_short: '粘贴别人发给你的机器共享链接',
  setup_desktop_title: '在电脑上安装神念',
  setup_desktop_instructions:
    '在想运行 AI 的 Mac / Windows 上打开下载地址，选择对应安装包。手机无需下载电脑安装包。',
  setup_copy_computer_address: '复制电脑下载地址',
  setup_desktop_sign_in:
    '安装并打开神念，登录与手机相同的账号。桌面版已包含连接机器所需组件，无需另装神念 Client。正常登录后，本机会自动关联。',
  setup_desktop_trouble:
    '没出现机器：先检查是否登录同一账号、电脑是否联网、神念是否正在运行。已主动暂停的机器，需要你在目标电脑恢复，不必重复安装。',
  setup_server_intro:
    '适合服务器、SSH 环境，或不使用神念桌面版的电脑。所有操作都在目标机器完成；已有 Desktop 时优先复用随包命令。',
  setup_manual_install: '1. 自己执行安装',
  setup_terminal_hint:
    'Mac / Linux 打开终端；Windows 打开 PowerShell。先按安装指南准备 Node.js 18 或更新版本，再运行下面命令。已有 WSL 的用户在需要运行 AI 的环境里安装。',
  setup_environment_guide: '查看完整安装与环境说明',
  setup_ai_install: '或者，让已有 AI 帮忙',
  setup_ai_prompt: '访问 {{url}}，帮我安装神念 Client。',
  setup_sign_in_choices: '2. 按目标环境完成登录',
  setup_browser_login:
    '能打开浏览器：按终端提示打开登录网页，用同一神念账号登录并确认。完成后回到终端，检查服务已启动；不一定还需要配对码。',
  setup_code_login:
    '服务器或无法打开浏览器：按安装向导选择配对方式，将终端显示的配对码输入手机，或扫描终端二维码。AI 帮你安装时也可以选择这两种登录方式。',
  setup_have_code: '电脑已显示配对码，继续连接',
  setup_pair_instructions:
    '仅当目标电脑已显示神念配对码或二维码时使用。桌面版同账号登录通常自动关联，不需要额外扫码。',
  setup_scan_invite: '扫描机器邀请二维码',
  setup_pair_input: '输入电脑显示的配对码',
  setup_invite_input: '粘贴机器邀请链接',
  setup_invite_invalid: '这不是有效的机器邀请链接，请向机器主人获取完整链接。',
  setup_preview_invite: '查看邀请并确认',
  setup_check_connection: '已安装，检查连接',
  setup_confirm_machine: '确认下面是你的目标机器，再查看 AI。机器在线和 AI 可用是两步检查。',
  setup_view_ai: '查看 AI',
  setup_no_machine: '还没有读取到机器。确认同账号登录、电脑联网并启动神念后，再检查连接。',
  setup_return_project: '返回创建项目',
  setup_refresh_failed: '读取机器失败，点击重试。',
  setup_claim_refresh_failed:
    '配对已确认，但机器列表尚未同步。请重新检查连接，无需再次提交配对码。',
  setup_claim_success: '配对已确认。请检查目标机器是否在线。',
  setup_copy_failed: '复制失败，可以长按上方文字手动复制。',
  setup_open_failed: '无法打开链接，请复制地址后在浏览器打开。',
  setup_preview: '预览版',
  setup_download_not_published: '当前还没有可下载的安装包',
  setup_download_failed: '暂时无法读取版本',
  download_return_invite: '安装后回到原邀请链接继续。只参加群聊，可留在当前网页使用。',
  download_official_site: '官网与所有安装方式',
} as const
