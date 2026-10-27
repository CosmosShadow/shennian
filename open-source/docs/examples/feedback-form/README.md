# 意见收集表 / Feedback form

一个零第三方依赖的 Node.js 应用：双语表单、类型与意见内容、受限本地 JSONL 数据文件。无姓名、邮箱、密码或 API Key 字段；数据不放在网页目录，没有公开查询 / 管理接口。

A dependency-free Node.js app with a bilingual form, category/message validation, and restricted local JSONL storage. No name, email, password, or API-key fields. Records are outside the web root and there is no public read/admin API.

## 1. 启动 / Run

在完整仓库根执行 / From the repository root:

```sh
node open-source/docs/examples/feedback-form/server.mjs
```

默认仅监听 `127.0.0.1:18371`，数据位于用户主目录的 `.local/share/shennian-examples/feedback/feedback.jsonl`。可使用 `PORT` 和 `FEEDBACK_DATA_DIR` 指定自己的端口与受限数据目录，**不要把数据目录设在代码或静态网站目录中**。先自行打开本机地址检查表单。

Listens on loopback only, port 18371. Records go to `.local/share/shennian-examples/feedback/feedback.jsonl` under your home directory. Override `PORT` and `FEEDBACK_DATA_DIR` if needed, keeping data outside source/static directories. Check the form locally first.

## 2. 登记并显式分享 / Register and explicitly share

先完成 Client 与所选 Server 的账号配对，保持 Client 在线。以下使用本仓库构建出的 CLI，不依赖另一个 npm 版本是否已经包含相同命令。在完整仓库根执行；`<app-id>` 和 `<share-id>` 来自上一条命令的输出，不是固定示例凭据。

Pair Client with your selected Server and keep it online. These commands use the CLI built from this repository, rather than assuming the globally installed npm version supports every command. Run from the repository root. IDs are returned by preceding commands, not fixed credentials.

```sh
node open-source/packages/cli/dist/bin/shennian.js local-apps register \
  --title "意见收集 / Feedback" --port 18371 \
  --directory "$PWD/open-source/docs/examples/feedback-form" --path /

node open-source/packages/cli/dist/bin/shennian.js local-apps doctor <app-id>

# 入口 GET 自动包含；仅额外允许这个 POST，不包含查询或管理接口。
# Entry GET is included automatically; allow only this POST API.
node open-source/packages/cli/dist/bin/shennian.js local-apps share <app-id> \
  --post /api/feedback

# 撤销链接及访客会话 / Revoke the link and visitor sessions
node open-source/packages/cli/dist/bin/shennian.js local-apps unshare <share-id>
```

打开 `share` 返回的 URL，而不是让访客连接 loopback 地址。公开页通过注入的 `window.shennian.public.service` 转发提交，访客拿不到电脑凭据；直接本机浏览时使用同一个本地 POST。服务端限制资源与 API，业务输入仍由应用校验。默认分享期限为 30 天，可以提前撤销。自托管反向代理必须转发分享页面与 API 路径，见[部署指南](../../../deploy/self-hosted/README.md)。

Visitors open the URL returned by `share`, not the loopback URL. The public page uses the injected `window.shennian.public.service` bridge; visitors never receive computer credentials. Direct local browsing posts to the same local API. Server enforces resource/API scope and the app validates business input. Shares expire after 30 days and can be revoked earlier. Your reverse proxy must serve the sharing and API paths; see the [deployment guide](../../../deploy/self-hosted/README.md).

## 3. 数据、安全与限制 / Data, security, and limits

- 电脑、应用、Client 都需在线；不是离线云托管。Computer, app, and Client must remain online; this is not offline cloud hosting.
- 任何持链接的人都可能提交；只分享给预期访客，必要时及时撤销。Anyone holding an anonymous link may submit; distribute and revoke it deliberately.
- 应用不自动去重，也不提供身份验证、验证码、恶意内容审核、反垃圾服务或生产级审计。网络超时后重试可能重复写入；正式收集应补幂等键、数据保留策略及业务授权。No automatic deduplication, authentication, CAPTCHA, moderation, anti-spam, or production audit. Retries after network failures can duplicate records; add idempotency, retention, and business authorization for production collection.
- 仅 8 KiB 请求、2000 字符意见，HTML 不回显用户输入，数据文件不可通过 HTTP 读取。不因放在 localhost 就省略输入检查。Requests are bounded to 8 KiB and 2000 message characters. User text is not reflected into HTML; stored records are never served over HTTP. Loopback is not a substitute for validation.
- 服务端中转并不构成端到端加密；不要提交敏感资料。Server relay is not end-to-end encryption. Do not collect sensitive data with this example.

## 测试 / Tests

```sh
node --test open-source/docs/examples/feedback-form/server.test.mjs
```

测试使用系统 tmp 的专用 unit 目录和模拟请求，不监听端口、不调用模型、不创建线上数据。此测试验证示例自身，不冒称完成了每个部署环境的端到端分享验收。

Tests use isolated unit temp directories and mocked requests, with no sockets, model calls, or live data. They validate the example, not every deployment's end-to-end sharing path.
