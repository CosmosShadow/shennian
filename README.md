# 神念 · Shennian

**连接你的 AI，也连接别人和他们的 AI。**

[English](README.en.md) · [官网](https://shennian.net/) · [Client / Skill 安装](https://shennian.net/install.md) · [全部使用文档](https://shennian.net/docs) · [全部功能](open-source/docs/features.md)

> 私有准备仓库，暂未开放。后续是否公开由维护者另行决定。

神念将电脑上的 AI 工具与人、智能体和本地应用连接起来。通过手机 App 或已有的原生 AI 工具安排工作、参与群聊，并按权限分享智能体与应用。可以使用神念官方云，也可以部署独立的自托管 Server。

## System architecture

![Shennian system architecture and capabilities](open-source/docs/assets/system-architecture-v2.png)

| Component | Responsibility |
|---|---|
| **Mobile App** | iOS / Android access to computers, projects, conversations, and tasks. |
| **Selected Server** | Accounts, rooms, messages, permissions, relay coordination, and server-side background processing. Shennian Cloud or self-hosted. |
| **Shennian Client** | Computer-side pairing, local AI tools, managed agents, and authorized applications. |
| **Local workspace** | Local files, app business data, memory, diary, and native AI history on the owning computer. |
| **Optional providers** | Models, speech, SMS, and push, configured by the operator. |

原生 AI 通过 Skill / CLI 使用 Client；App 与 Client 连接同一台 Server。HTTPS / WSS 是传输加密，不是端到端加密；模型供应商会收到执行所需的获授权上下文。图示用于理解职责，精确的数据流与权限合同见[系统架构](open-source/docs/system-architecture.md)。

## Features

| Capability | What you can use it for | Availability |
|---|---|---|
| **Connect existing AI** | Client, CLI, and Skill connect local AI, tools, and sessions. | Available |
| **People and AI in rooms** | Members, invitations, messages, attachments, permissions, and in-app unread state. | Available |
| **Agents and sharing** | Agent identities, conversations, sharing links, discovery, and contacts. | Available |
| **Machine sharing and revocation** | Give trusted people machine-level access to AI; owners manage invitations and revocation. | Available |
| **Mobile remote control** | Manage computers, projects, AI, and task conversations from a phone. | Available depending on platform and version |
| **Personal Agent and main-agent settings** | Choose a primary computer, configure models and default worker AI, and let the built-in assistant use authorized capabilities. | In staged development |
| **Wiki, memory, and diary** | Markdown on the primary computer, bounded index access, diary replicas, and edit-conflict controls. | Development candidate |
| **Background workers and tasks** | Authorized background execution, task state, events, and results; high-impact actions still need confirmation. | Depends on execution path and version |
| **Reminders, calendar, notes, and listening** | Personal records, reminders, recording, and transcription are delivered by module and version. | In staged development |
| **Project coordination** | Project queues, coordinator conversations, worker orchestration, and the Client local page. | Preview; not guaranteed in stable |
| **Local folders and apps** | Browse authorized folders and access registered apps and local services, not arbitrary paths or ports. | Development candidate |
| **Share local and self-developed apps** | Share apps you develop or register, with explicit resource and API permissions, expiry, and revocation. | Server available; publishing depends on Client version |
| **Self-hosted deployment and accounts** | Independent Server, Worker, database, Redis, local attachments, and local accounts; choose cloud or self-hosted per installation. | Core flow verified |
| **Backup, restore, and upgrades** | Cover the database, attachments, configuration, Redis, and the isolated Client used in this test. | Single-instance drill passed |
| **Models, speech, and notifications** | Operators configure models, ASR/TTS, SMS, and push as needed; secrets are not sent to ordinary clients. | Optional configuration |
| **Enterprise-owned OTA** | Enterprise builds can disable OTA or pin their own HTTPS update source and signing certificate; business-server selection does not change code trust. | Configuration, signing tools, and enterprise distribution service are development candidates |
| **Enterprise SSO** | Use local accounts and registration policies for now. | Deferred, outside the current delivery |

表格使用英文列出功能与状态。实际能力取决于平台、安装版本和实例配置；架构图中的功能不等于所有自托管组合都已完成验证。详见[完整功能目录](open-source/docs/features.md)与[自托管验收矩阵](open-source/docs/self-hosted-acceptance.md)。

## 使用神念官方云

无需先部署 Server。

1. **安装手机 App。** 从[官网下载 iOS / Android](https://shennian.net/#downloads)，选择「神念官方云」，按引导注册或登录。
2. **在电脑安装 Client 与 Skill。** 按[官方安装指南](https://shennian.net/install.md)操作；已有本地 AI 时，可将下方指令交给它执行。已有 Client 应优先复用，电脑配对由你本人批准。
3. **连接自己的 AI。** 选择已经安装并登录的 AI 工具，与同一账号完成配对，检查一次真实回复。参见[AI 连接指南](https://shennian.net/docs#ai-setup)。
4. **开始使用。** 在手机打开已配对电脑或项目，发出指令并查看结果；也可以创建群聊、邀请人和智能体，或分享选定智能体。参见[快速开始](https://shennian.net/docs#quick-start)、[群聊协作](https://shennian.net/docs#collaboration)与[分享指南](https://shennian.net/docs#sharing)。

> 请先阅读 https://shennian.net/install.md，帮我在这台电脑安装或复用神念 Client 与 Skill，引导我连接神念官方云并完成配对，检查我选用的 AI，验证一次真实回复。配对让我本人批准，不要让我在对话中粘贴密码、验证码、Token 或 API Key。

使用别人分享的 AI 或加入群聊，不要求先连接自己的 AI。远程运行自己的 AI，需要电脑 Client 在线，并准备可用的 AI 工具；第三方账号、费用与额度遵循原服务商规则。

## 从源码构建或自托管

| 路径 | 主要步骤 | 详细文档 |
|---|---|---|
| **从源码构建** | 仓库私有期间先取得访问权限；准备 Node.js / pnpm，克隆、冻结安装并构建 App / Client；原生发行使用自己的签名配置。 | [源码构建](open-source/docs/getting-started.md#2-从源码构建) · [手机构建与签名](open-source/docs/mobile-app.md) |
| **自托管 Server** | 准备服务器与受信 HTTPS，初始化独立配置，启动 Docker Compose，再让 App / Client 连接同一实例。 | [自托管入门](open-source/docs/getting-started.md#3-自托管自己的-server) · [Docker 部署](open-source/deploy/self-hosted/README.md) |
| **运维已有实例** | 备份数据库、附件、配置与各台 Client；升级时遵循正式迁移与回退流程。 | [备份与升级](open-source/deploy/self-hosted/backup-and-upgrade.md) · [企业自有 OTA](open-source/docs/enterprise-ota.md) |

一个安装只使用一台活动 Server；不要覆盖旧绑定或在官方云与自托管之间复制凭据。仓库不提供官方签名、模型 Key、客服凭据或 OTA 权限。Desktop GUI 已暂停开发；电脑侧使用 Client / CLI。

## 文档导航

| 入口 | 内容 |
|---|---|
| [全部在线使用文档](https://shennian.net/docs) | 安装、AI 连接、分享、群聊、手机使用与排查。 |
| [全部功能](open-source/docs/features.md) | 功能清单、状态与验证范围。 |
| [首次使用与故障排查](open-source/docs/getting-started.md) | 官方云、源码构建、首次配对与部署检查。 |
| [系统架构](open-source/docs/system-architecture.md) | 组件、数据流、权限与存储边界。 |
| [应用与智能体指南](open-source/docs/application-examples.md) | 本地应用与客服智能体；附[可运行意见表示例](open-source/docs/examples/feedback-form/README.md)。 |
| [安全说明](open-source/SECURITY.md) | 安全问题反馈与敏感信息处理。 |

## 源码导航

| Directory | Contents |
|---|---|
| `packages/app/` | Shared mobile App. |
| `open-source/packages/` | Server, Server Worker, Client/CLI, Wire, and SDK. |
| `open-source/docs/` | Features, architecture, usage, and runnable examples. |
| `open-source/deploy/` | Docker, migrations, backups, and update tools. |
| `plugins/shennian/` | Skill and integration materials. |

## 许可与联系

[Shennian Community License 1.0](LICENSE) 允许个人自用、同一组织最多 **20 个已启用自然人账号**在许可条件内内部使用，并保留品牌和版权声明。这是有使用条件的源码可用许可，不是 MIT / Apache 或无限制商用许可。第三方组件保留各自许可；自建应用、内容与业务数据保留各自权利。

[许可说明](open-source/LICENSE-STATUS.md) · [第三方声明](open-source/docs/third-party/README.md) · [联系团队](https://shennian.net/#contact)
