<div align="center">

# 神念 · Shennian

### 构建你的 AI 原生组织

**连接本地 AI · 开发智能体和应用 · 分享给别人用 · 让人与 AI 一起工作**

[English](README.en.md) · [官网](https://shennian.net/) · [功能与使用文档](https://shennian.net/docs) · [自托管](open-source/deploy/self-hosted/README.md) · [联系我们](https://shennian.net/#contact)

[![CI](https://github.com/CosmosShadow/shennian/actions/workflows/ci.yml/badge.svg)](https://github.com/CosmosShadow/shennian/actions/workflows/ci.yml)

</div>

> 私有准备仓库，暂未开放。等待隐私整改、历史复核及真人批准后再决定公开。

神念是面向**个人与公司**的 AI 原生协作软件：连接你已有的 AI，把智能体、应用和人组织到同一套工作流程中。个人可以拥有自己的 AI 团队，公司可以让同事和不同职责的 AI 一起讨论、分工、执行和交付。

**不需要先自建服务器。** 可以使用神念官方云，也可以部署自己的 Server；两者共用同一套 App 与 Client。AI 工具、工作目录和本地应用可以在自己的电脑运行，手机用于参与、管理和指挥。

## 你可以用神念做什么

| 能力 | 使用方式 |
|---|---|
| **连接已有 AI** | 通过 Client、CLI 与 Skill，连接 Codex、Claude Code、Pi、ACP 等工具；继续使用自己的模型和工具环境。 |
| **开发与分享智能体** | 配置职责、机器与工作目录，发布链接，让朋友、同事或用户与智能体对话，或将其加入群聊。 |
| **开发与分享应用** | 让 AI 制作意见收集表、网页和业务工具，在自己的电脑运行，再按明确的资源 / API 权限分享。 |
| **人与 AI 协作** | 群聊、邀请、消息、附件、独立智能体身份与访问控制，让讨论与交付发生在同一处。 |
| **手机连接电脑** | 查看已配对电脑、项目、会话与任务，在手机上安排工作和查看结果。 |
| **个人助理与记忆** | 主电脑 / 主 Agent、Personal Agent、Wiki / 记忆、日记与后台任务；具体使用范围见功能目录。 |
| **自托管与运维** | 多人账号、Server / Worker、SQL、Redis、附件存储、正式迁移、备份与升级。 |
| **可选服务** | 使用自己的模型、语音、短信、推送或企业 OTA 配置；不附带官方密钥、签名和更新权限。 |

[完整功能目录与版本边界 →](open-source/docs/features.md)

## 从三个真实场景开始

### 1. 把 AI 变成可以分享的智能体

给已有 AI 设置职责，例如产品咨询、内部知识问答或项目助手。创建分享链接，或把智能体加入群聊。访问权限、到期和撤销由分享者管理，**分享某个智能体不等于公开整台电脑**。

### 2. 做一个意见收集表，发给别人填写

> “帮我做一个意见收集应用，提供类型和意见内容，不收集姓名与联系方式。内容保存在我的电脑，只开放表单页面和提交接口；不要公开数据文件或管理接口。”

仓库附带**可运行、零第三方依赖的双语意见表**：[示例代码与分享步骤](open-source/docs/examples/feedback-form/README.md)。访客通过分享页提交，内容由应用写到自己的本地数据目录；不是把整套程序上传到云端托管。电脑、应用和 Client 需要保持在线。

![仓库附带的意见表示例界面](open-source/docs/assets/screenshots/feedback-form.png)

### 3. 搭建自己的客服与 AI 团队

官网的神念客服展示了“有职责的智能体 + 访客对话 + 群聊协作”的用法。你也可以在自己的实例上配置产品资料、模型与权限，搭建自己的客服、内部助手或团队智能体。**自托管不会附送官方客服的身份、私有知识库、凭据或运营数据。**

[应用、客服与智能体实践指南 →](open-source/docs/application-examples.md)

## 登录入口

含真实账号与工作环境的旧截图已撤下，后续使用专用演示数据重新制作。

![官方云 / 自托管登录入口](open-source/docs/assets/self-hosted-login.png)

## 功能与架构

![神念功能与架构全景](open-source/docs/assets/system-architecture.png)

手机 App 连接所选 Server；本机 AI 通过 Skill / CLI 使用 Client；Client 通过 WSS 连接同一实例。访客只能通过分享入口使用明确授权的应用与智能体。图示覆盖模块职责，不代表每项可选服务已默认启用；精确运行关系见[架构文档](open-source/docs/system-architecture.md)。

### 数据与权限

- **自己的电脑**：工作目录、AI 历史、应用及其本地业务数据、记忆与日记。每台电脑需独立备份。
- **所选 Server**：账号、成员关系、消息、附件与中转 / 任务状态。可选择官方云或自己的服务器。
- **模型供应商**：接收执行所需的获授权上下文。HTTPS / WSS 是传输加密，**不是端到端加密**。
- 一个安装只连接一台活动 Server，不把个人云与公司账号、Token、历史混用。更换实例应按指南使用独立安装，不能直接覆盖旧绑定。
- 本地应用分享使用资源与 API 白名单，可到期、撤销；不要分享密钥、数据文件、管理接口或任意端口。

## 安装与部署：选择你的方式

| 我想做什么 | 大概步骤 | 详细指南 |
|---|---|---|
| **直接使用官方云** | 安装手机 App 和电脑 Client → 确认账号并配对 → 连接自己的 AI。无需先自建 Server，也可以开发和分享应用。 | [安装与首次使用](open-source/docs/getting-started.md#1-直接使用官方云) |
| **从源码编译** | 准备 Node.js / pnpm → 克隆与冻结安装 → 构建 App / Client → 按平台准备原生环境。 | [源码构建指南](open-source/docs/getting-started.md#2-从源码构建) |
| **部署自己的服务** | 准备服务器与 HTTPS 域名 → 初始化独立配置 → Docker 启动 → 手机和 Client 连接同一实例。 | [Docker 部署指南](open-source/deploy/self-hosted/README.md) |

先用一家模型完成连接、配对和真实回复，再按需启用语音、短信、推送或自有 OTA。第三方模型与工具的账号、费用和额度遵循各自规则；已有实例不要重新初始化或删除数据卷。

**文档导航：**[首次使用与排查](open-source/docs/getting-started.md) · [手机构建与签名](open-source/docs/mobile-app.md) · [备份 / 恢复 / 升级](open-source/deploy/self-hosted/backup-and-upgrade.md) · [企业自有 OTA](open-source/docs/enterprise-ota.md) · [意见表示例](open-source/docs/examples/feedback-form/README.md)

## 源码导航

```text
packages/app/                共用手机 App
open-source/packages/        Server、Worker、Client / CLI、Wire、SDK
open-source/docs/            功能、架构、使用和安全说明
open-source/docs/examples/   可运行应用示例
open-source/deploy/          Docker、迁移、备份与更新工具
plugins/shennian/            Skill 与接入资料
```

SSO 不包含在当前版本；可选功能按实际版本、平台与实例配置使用。具体功能和验证范围见[功能目录](open-source/docs/features.md)与[验收矩阵](open-source/docs/self-hosted-acceptance.md)。

## 许可与联系

个人自用、同一组织最多 **20 个已启用自然人账号**的内部使用，在保留品牌与版权的许可范围内免费；允许按许可修改和构建。超限、去品牌或托管转售等使用请通过[官网企业微信](https://shennian.net/#contact)联系。没有技术激活锁，不公开价格。

本项目采用 [Shennian Community License 1.0](LICENSE)，是带使用条件的源码可用许可，**不是 MIT / Apache 或无限制商用许可**。第三方组件保留各自许可；自建应用、内容和业务数据的权利不因此转移。[许可说明](open-source/LICENSE-STATUS.md) · [第三方声明](open-source/docs/third-party/README.md)
