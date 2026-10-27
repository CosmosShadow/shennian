# 安装、构建与首次连接

[English](getting-started.en.md) · [功能目录](features.md) · [Docker 部署](../deploy/self-hosted/README.md)

## 选择路径

- **想先用起来**：选择官方云，安装手机 App 与电脑 Client，不用部署 Server。
- **想修改或自行发行客户端**：从源码编译；签名、供应商项目与更新源由你自己配置。
- **想让账号、消息和附件由自己的服务器处理**：部署自托管 Server，再让 App 与 Client 连接同一实例。

三种路径使用同一套 App / Client 实现。开发智能体和本地应用不要求先自托管；应用、Client 与电脑需要在线，模型供应商仍会处理执行所需的获授权上下文。HTTPS / WSS 不是端到端加密。

## 1. 直接使用官方云

1. 打开[官网](https://shennian.net/)，按平台下载手机 App。
2. 在运行 AI 的电脑上，按[官方安装指南](https://shennian.net/install.md)安装 / 检查 Client 与 Skill。不要把密码、模型 Key 或配对凭据粘贴到公开群聊。
3. 在 App 选择「神念官方云」，按引导确认账号，并批准自己的电脑配对。
4. 连接一款已经安装、登录且能真实回复的 AI；其他工具可稍后添加。
5. 开始个人对话或群聊，创建有职责的智能体；要分享本地工具，可从[意见收集表示例](examples/feedback-form/README.md)开始。

使用别人分享的 AI 或加入群聊，可从原邀请链接进入，不要求访客先安装自己的 Client。第三方模型 / AI 工具的账号、费用和额度遵循其原有规则。

## 2. 从源码构建

### 环境

| 项目 | 要求 |
|---|---|
| Node.js | 22.19 或更新的兼容版本 |
| pnpm | 9.15.4 |
| 完整单元测试 | 另需 Python 3 |
| iOS | macOS、Xcode 与原生依赖环境 |
| Android | Android Studio、Android SDK 与原生依赖环境 |

电脑 Client / CLI 支持 macOS、Windows 与 Linux。Desktop GUI 不在当前维护范围，不需要为它安装依赖或做发布验证。

### 安装、构建与检查

在终端执行，命令工作目录为完整仓库根：

```sh
git clone https://github.com/CosmosShadow/shennian.git
cd shennian
pnpm install --frozen-lockfile
pnpm build
pnpm build:app
pnpm test
pnpm test:deploy
```

- `pnpm build`：Core 构建与 App 类型检查。
- `pnpm build:app`：生成 App 所需 WebView 资源并检查类型。
- `pnpm test`：Core 与移动端单元测试，不代替真实设备验收。
- `pnpm test:deploy`：部署、配置、OTA 工具及应用示例测试。

根据要编译的平台选择下一步，不要求同时编译两端：

```sh
pnpm ios
# 或
pnpm android
```

首次原生构建与自行发行所需的应用标识、证书、推送和 OTA 信任配置，见[手机 App 构建指南](mobile-app.md)。本仓库不提供官方签名、模型 Key、官方客服凭据或官方 OTA 权限。

## 3. 自托管自己的 Server

### 先准备什么

准备服务器、Docker / Compose、可持久化的数据目录，以及受信 HTTPS 域名和反向代理。只把域名写进配置不会自动完成 DNS、证书和网络配置；不要为了通过连接而关闭 TLS 校验，也不要把数据库端口暴露到公网。

### 新实例初始化

从完整仓库根执行：

```sh
cd open-source
node deploy/self-hosted/init-config.mjs https://your-domain.example
docker compose -f deploy/self-hosted/compose.yaml up -d --build
```

把示例域名换成自己的受信地址。配置工具生成独立实例身份、namespace、数据库密码及签名密钥，默认邀请注册；Compose 先执行正式迁移再启动 Server / Worker。API 默认只绑定服务器本机。反向代理、注册策略、存储及网络受限环境的完整配置见[Docker 部署指南](../deploy/self-hosted/README.md)。

**已有实例不要重复初始化、删除数据卷或手工重写已应用 migration。** 更新前先看[备份、恢复与升级](../deploy/self-hosted/backup-and-upgrade.md)。

### App 与 Client 连接

1. App 登录页选择「自托管服务器」，输入部署时配置的 HTTPS 域名或带受信证书的 IP（可含自定义端口）。
2. 连接与实例发现成功后，按管理员的注册策略注册或登录。
3. 电脑 Client 连接同一实例，完成账号确认和配对，再配置自己的 AI / 模型。
4. 一个安装只有一台活动 Server；不要把官方 Token、旧配对或本地历史复制到公司实例。已有绑定不能直接覆盖地址来换服。

## 4. 第一次验收与可选能力

先只配置一家模型，在手机发送专用测试消息，确认真实返回、历史读取与重新打开会话；需要模型数据处理确认时由用户决定。再检查群聊权限、附件和撤权，逐项记录实际结果。

语音、短信、推送、对象存储和企业 OTA 都按需配置；缺少这些不应成为最小本地账号 / 配对链路的前置条件。开启某项服务不代表其他项也启用，不要把 Key 下发给普通客户端。

## 5. 常见问题与深入文档

| 情况 | 先检查 | 下一步 |
|---|---|---|
| 服务器地址连接失败 | DNS、HTTPS 证书信任、反向代理与 WSS 转发；不要关闭校验 | [部署配置](../deploy/self-hosted/README.md) |
| 无法注册 | 实例注册策略是关闭、邀请还是开放；使用本实例管理员提供的渠道 | [账号与初始化](../deploy/self-hosted/README.md) |
| 手机看不到电脑或 AI | App / Client 是否属于同一实例，配对是否完成，电脑是否在线 | [官网连接排查](https://shennian.net/docs#troubleshooting) |
| AI 没回复 | 原生工具的安装 / 登录、模型配置、授权与 Client 在线状态 | [AI 接入文档](https://shennian.net/docs#ai-setup) |
| 应用能打开但提交失败 | 是否显式允许对应 POST，应用是否校验输入，电脑与 Client 是否在线 | [应用实践](application-examples.md) |
| 升级、恢复或自己的更新源 | 备份与回退基线；业务服务器地址不等于 OTA 信任来源 | [升级](../deploy/self-hosted/backup-and-upgrade.md) / [OTA](enterprise-ota.md) |

平台、版本和未覆盖场景以[功能目录](features.md)与[验收矩阵](self-hosted-acceptance.md)为准。SSO 不包含在当前版本。
