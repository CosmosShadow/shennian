# 自托管验收矩阵

核对日期：2026-10-24。通过只针对记录中的候选、环境和步骤，不代表全部 UI 或生产容量。

## 2026-10-27 完整工程补充

- App 保留同一套源码，完整仓库重新克隆后完成冻结安装、Core / App 构建、生成文件一致性与部署工具检查。Core 517 文件 / 4,184 项，移动 328 文件 / 2,355 项，部署工具 35 项；Linux 上 macOS 专项测试按平台跳过，不把跳过当作该平台验证。
- 独立公共配置生成 iOS 原生工程与 CocoaPods，完成模拟器原生编译；全新克隆的 Release 构建包含内嵌 JS，不要求官方 EAS、签名团队、推送 Key 或官方组合模块。真机发行仍须部署者自己的签名。
- iOS 已实际核对服务器 Tab、HTTPS 地址、账号登录、智能体入口与历史渲染。首次发送会要求确认把主动发送内容交给所连接的 AI；服务端探针成功不替代该手机交互的独立验收。
- 新源码 Docker 的 759 个运行文件完整性校验通过；现有五步 migration checksum 不变。只配置一家 DashScope qwen-plus，语音、短信和系统推送关闭；站内消息和历史不依赖这些供应商。
- Client 强制结束后，持久 PID 1 旧锁由新进程回收，无手工删除锁；整机正常重启后六项服务恢复。部署后、Client 崩溃恢复后、整机重启后共 18 次立即首帧 / 历史请求及 6 次模型真实回复通过，探针临时 Device 均按正常 API 撤销。
- 下表保留前期隔离恢复、升级回退等演练的具体范围；它们不意味着任何版本、所有平台或全部个人功能都已重验。SSO 仍暂缓，Desktop 不在交付范围。

| 范围 | 状态 | 已有证据 / 还需做什么 |
|---|---|---|
| 干净公共运行包与 Linux amd64 Docker 构建 | 通过 | 清单逐文件完整性检查、冻结依赖安装、独立迁移引擎；不是完整源码独立构建。 |
| QA host 独立数据库 / Redis / API / Worker / Client | 通过 | 独立持久卷与身份、受信 QA CA、六容器运行；不代表公网 CA 或生产负载。 |
| 空库正式迁移、重复执行、schema drift | 通过 | 四步自托管迁移、重复无 pending、drift 空、联系人约束正反例与夹具清理。 |
| iOS 填 IP、发现、邀请注册 / 登录、Client 配对 | 通过 | 专用开发构建与独立模拟器；不是商店版或真机。 |
| 单一模型真实回复、重启与历史恢复 | 通过 | Client 原生 Pi + DashScope qwen-plus，真实两轮回复；不是内置 Personal Agent 验收。 |
| 两用户群聊、成员边界、附件、站内未读 | API 通过 | 非成员拒绝、加入前历史隔离、双向消息、本地对象签名与完整性；并非每个手机交互都已走完。 |
| 已绑定 Client 禁止直接换实例 | 通过 | 改到另一实例被拒绝，配置原字节不变；安全旧数据迁移未交付。 |
| Personal Agent / 主电脑 / 主 Agent 设置 | 未完成本轮验收 | 必须单独验证内置助理、模型设置、能力发现、撤权与主电脑版本。 |
| Wiki / 记忆 / 日记 / Worker | 未完成本轮验收 | 主电脑文件、有限上下文、手机副本、冲突与恢复不能用普通 Agent 回复替代。 |
| 提醒 / 日历 / 笔记 / 聆听 / 文件夹 / 应用 | 未完成本轮验收 | 分功能记录正向与权限 / 离线 / 未配置场景。 |
| 语音 / 短信 / 系统推送 | 未启用 | 本轮只配置一家大模型；缺配置 UI 仍待逐项补验。 |
| Android / 真机 / 公网证书 | 未完成 | 本轮 iOS 模拟器不替代这些验收。 |
| 备份恢复 | 本轮单实例演练通过 | 加密归档、隔离恢复 48 文件 / 84 表行数 / 4 迁移校验和 / 2 触发器，Redis 持久数据独立载入；不是异地整机灾备或其他电脑备份。 |
| 升级回退 | 本轮一对候选通过 | 原 Client 0.5.41 → 公共运行镜像内 0.5.43，iOS 原会话真实回复；回退原镜像、原账号登录通过，再恢复候选。同 schema，不代表任意跨版本降级。 |
| 完整源码与公开边界 | 已提供 | 完整仓库包含唯一 App、Core、CLI、部署、文档与测试；独立克隆冻结构建和 CI 通过。只发布已筛选的独立社区历史，不公开混合内部仓库；技术扫描不是法律合规认证。 |
| 企业自有 OTA | 开发候选；工具测试通过 | 默认关闭、独立 HTTPS / 证书、离线签名与原子激活、协议 / 篡改 / 资源 hash 隔离测试；未做企业原生壳下载、重启应用、回退或真机验收，不由官方 OTA 或 Docker 升级替代。 |
| SSO | 当前不实施 | 不是本轮验收门禁；后续另行确认。 |

备份涉及每台 Client 的本地文件与密钥，Server 单独备份不足以恢复个人工作空间。本矩阵记录各项实际验证范围，源码公开不把未覆盖的平台或功能自动改写为通过。

## 2026-10-27 完整源码与手机界面补验

独立社区克隆冻结安装、Core / App 构建、Core 517 文件 / 4184 项、移动 328 文件 / 2355 项及部署工具检查通过；后续应用分享源码提交的完整远端 CI 也通过。独立 iOS 模拟器 Debug 与内嵌 JS 的 Release 均在首次数据处理同意后收到单模型真实回复，保留同一实例账号与历史，不依赖 Debug 的 Metro 服务。此结果不是 Android、签名真机或商店发行证明。新增意见表示例以模拟请求验证本地持久化、输入边界及不公开数据文件；不把单元测试称为每个自托管环境都完成了端到端发布。

Independent community-clone frozen installation, Core/App builds, Core tests (517 files / 4184 tests), mobile tests (328 files / 2355 tests), and deployment checks passed. Full remote CI for subsequent app-sharing source also passed. Independent iOS Debug and bundled-JS Release builds displayed real single-model replies after first-use consent, preserving account/history; Release did not depend on Metro. This does not certify Android, signed physical devices, or store distribution. The feedback example tests local persistence, validation, and non-exposure of stored data through mocked requests, not every self-hosted environment's end-to-end publication.
