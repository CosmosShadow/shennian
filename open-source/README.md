# 神念 · Shennian

**构建你的 AI 原生组织。连接本地 AI，开发和分享智能体与应用，让人与 AI 一起工作。**

神念连接你电脑上已有的 AI、其他人和他们的 AI，让你通过手机或原生 AI 工具参与对话、协作与任务执行。自托管让组织使用自己的服务器、账号和数据存储。

[官网](https://shennian.net) · [使用指南](https://shennian.net/docs) · [功能目录](./docs/features.md) · [联系我们](https://shennian.net/#contact)

## 可以用来做什么

- **连接已有 AI**：通过 Shennian Client、CLI 和 Skill 接入本机工具与会话。
- **应用开发与分享**：运行自己的意见表、网页与工具，按资源 / API 白名单分享；见[可运行意见表示例](docs/examples/feedback-form/README.md)。
- **人与 AI 协作**：群聊、独立智能体、邀请、消息、附件和访问权限。
- **手机连接电脑**：管理已配对电脑上的项目和 AI 对话。
- **自托管服务**：独立 Server / Worker、数据库、Redis、本地附件和账号注册策略。
- **按需配置能力**：模型、语音、短信与推送使用部署者自己的配置，不附带官方密钥。

Personal Agent、主电脑 / 主 Agent、Wiki / 记忆、日记与任务等模块的作用及逐项验证范围见[功能目录](./docs/features.md)。不同平台的使用能力以对应版本与验收记录为准，Desktop 不属于当前维护范围。

## 系统架构

![神念功能与系统架构](./docs/assets/system-architecture.png)

[架构说明](./docs/system-architecture.md)解释手机、Client、Server、Worker 和存储的职责。组织可以自托管多人服务；同一安装只连接一个活动 Server，不将官方云与组织数据混合。

## 自托管与运维

从[部署指南](./deploy/self-hosted/README.md)了解 HTTPS、账号策略、数据库迁移、Docker 运行包与服务启动。Client 与手机必须连接同一实例；手机在登录页选择「神念官方云 / 自托管服务器」，自托管填写 IP 或域名后再登录、注册与配对。

- [备份、恢复与升级](./deploy/self-hosted/backup-and-upgrade.md)
- [关闭 OTA 或配置自己的签名更新服务](./docs/enterprise-ota.md)
- [功能与验收记录](./docs/self-hosted-acceptance.md)

Server / Worker 与 Client 的源码、Docker 构建和正式迁移都在本仓库。按部署指南生成自己的实例配置，再启动服务；包内测试不代替真实部署验收。

## 编译与测试

使用 Node.js 22.19 或更新的兼容版本与 pnpm 9.15.4（完整单元测试还需要 Python 3）。以下为 Core 检查，在完整仓库的 `open-source` 目录运行：

```sh
pnpm install --frozen-lockfile
pnpm build
pnpm test
pnpm test:deploy
```

以上命令构建 Server / Worker、Client / CLI、Wire、Shared、Server 扩展契约和协议 Node SDK，并验证包内行为和部署工具，不需要官方凭据或私有服务。Client 编译后可运行 `node packages/cli/dist/bin/shennian.js --help`，具体见 [Client 使用与架构](./docs/cli-runtime.md)。完整仓库根提供包含共用 App 的构建与测试入口；手机源码位于 `packages/app`，见[手机 App 构建](./docs/mobile-app.md)。

## 维护、版权与联系

保留适用的品牌、版权声明与第三方许可；使用范围见[版权与许可状态](./LICENSE-STATUS.md)。部署、定制及其他合作请通过官网[联系我们](https://shennian.net/#contact)。

维护边界见 [AGENTS.md](./AGENTS.md)，贡献流程见 [CONTRIBUTING.md](./CONTRIBUTING.md)，安全问题请按 [SECURITY.md](./SECURITY.md) 私下报告。
