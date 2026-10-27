# Server / Worker 与自托管构建

Server 提供账号、设备、成员、会话与消息 API，处理 Relay / WebSocket、权限和附件访问；Worker 是同一核心代码的后台进程，通过 Redis 路由请求并执行持久任务、日程和维护工作。Worker 不是另一份 Server 源码，也不直接拥有电脑上的 Agent 进程。

## 独立源码与构建

公共根运行 `pnpm install --frozen-lockfile`、`pnpm build`。Prisma Client 从唯一 schema 自动生成，生成步骤不会连接数据库；普通 build 输出 `packages/server/dist`，边界检查后的核心构建输出 `packages/server/dist-core`，并带 JSON schemas 与 core-only 模块清单。

`pnpm build:runtime /absolute/path/to/new-directory` 将核心、CLI、Wire、扩展契约、正式迁移与冻结依赖组装到新目录。它核对 schema 指纹、拒绝私有依赖，不复制账号、环境文件、数据库内容、模型 Key 或官方模块。输出已经是可安装的独立运行包，不需要访问内部工程。

## 配置与启动

自托管明确设置 `SHENNIAN_DEPLOYMENT_MODE=self-hosted`、受信 HTTPS 的 `SHENNIAN_PUBLIC_URL`、独立实例 ID 与账号 namespace、数据库 / Redis 地址、随机 JWT 与私有存储签名密钥。存储默认使用本地目录；短信、语音和系统推送不是基础登录与站内消息的前提。模型凭据可以只配置在独立 Client 上。

先以本实例配置执行 `pnpm --dir packages/server exec prisma migrate deploy`，再启动 `node packages/server/dist-core/core-server.js` 和 `node packages/server/dist-core/worker.js`。生产部署须提供自己的 HTTPS、持久卷和备份，不用 `db push` 初始化或升级。

同一 schema 对应一条自托管独立正式 migration 链。已经应用的 SQL 不重写；新变化追加 migration，构建指纹只在追加脚本就绪后更新。旧二进制回退保留新增表 / 列，不自动删数据。数据库、附件、实例身份密钥及每台 Client 状态分别备份。

## 扩展和环境边界

核心没有私有 import，不扫描私有目录或因缺少某个官方模块吞掉错误；缺席的可选能力由显式扩展注册和部署策略决定。兼容已有账号 / Wire / schema 的字段不代表自托管必须购买官方套餐。通用鉴权与成员权限不能因为没有支付模块而被绕过。

公共环境加载器只读取公共工程与 Server 自己的配置，不向父工程找私有配置。官方组合自行注入环境和扩展；官方迁移历史不参与自托管初始化。配置值不写日志或下发给普通客户端。

## 连接首帧与鉴权

原生 App 的单电脑 / 多电脑 Relay 在开始异步鉴权之前同步监听消息。鉴权期间最多保留 32 帧、合计 1 MiB、最长 15 秒；进程合计最多 256 个待鉴权连接、16 MiB 缓冲。超限或超时关闭连接，不转发未鉴权数据。只有登录、版本、套餐 / 部署策略和电脑访问权限校验通过后才按序交给原有逐请求权限检查，拒绝或已关闭连接不重放。正常客户端不需要人为等待后才发送首个请求。缓冲只解决连接就绪时序，不改变 Wire 字段或成员权限。

## 验证

包内单测使用合成账号和隔离夹具，不加载官方环境，不启动真实 Agent 或线上会话。测试中的数据库 URL 是不可用的专用占位地址；接口测试通过 mock 与 Fastify inject 验证，不作为真实数据库升级证明。真实升级、备份、恢复和业务闭环须在指定自托管环境单独验收。

## 本地应用公开能力

私有应用默认仍要求 Owner，不继承共享机器授权。新增公开能力是显式白名单：Owner 或当前机器凭据 POST `/api/local-apps/shares` 指定应用、精确 GET 资源和 POST API，DELETE `/api/local-apps/shares/:id` 撤销；机器凭据不能发布或撤销另一台机器的应用。分享 30 天 TTL，访客 15 分钟 TTL，二者均需仍有效，机器所有权/配对/远程开关、应用登记和 Owner 权益也逐次核对。Redis 只保存临时能力/限流元信息，业务数据由本机应用保存。

浏览器入口始终保留 canonical `/api/local-apps/shared/:id/`，不从已被 Edge 改写的内部 prefix 推导浏览器路径。可信外壳持有短期访客凭据；业务 HTML 位于无 same-origin 权限的 sandbox iframe，通过校验 source 的消息桥提交精确白名单 POST。CSP 禁止任意联网和原生表单外发，子页仅允许本站外壳嵌入。私有 runtime 不改为公开，不把账号/机器凭据交给网页；公开接口不接受访客选择机器、端口、appId 或任意 API。修改登记或撤销分享使后续访客请求失效，已在处理的请求不保证取消。

公开分享不是离线托管、通用反向代理或答案管理接口；应用须自行校验数据、处理幂等、并发和本地持久化。当前限额为分享 POST 30/min、访客 POST 10/min、分享读/单 IP 120/min；请求/响应、并发与超时继续受本地应用中转边界限制。初版以单页内联资源为验证对象，不保证 ES modules/跨域依赖和全部浏览器适配。CLI 命令和安装渠道状态另行判定，见 [Client](./cli-runtime.md)。

## Deployment-specific account configuration

Source contains no built-in QA phone, review credential or diagnostic user ID. An absent or invalid configuration grants no special login access.

- `SHENNIAN_TEST_LOGIN_PHONE`: optional E.164 QA phone. Production also requires the existing `SHENNIAN_TEST_LOGIN_ENABLED` switch and loopback issuance; codes remain random, expiring and one-time.
- `SHENNIAN_REVIEW_ACCOUNT_PHONES`: optional comma-separated E.164 reviewer accounts. Machine access restrictions apply independently of the review login code.
- `SHENNIAN_REVIEW_LOGIN_CODE`: optional six-digit reviewer credential, configured securely per deployment. Without it, review accounts use the normal SMS challenge. Never reuse a credential previously exposed in source.
- `SERVER_DIAGNOSTIC_USER_IDS`: optional comma-separated diagnostic user IDs; empty means no extra account detail logging.

Keep these values in deployment secret configuration, never source, screenshots, examples or test fixtures. Existing official deployments need an explicit configuration and credential transition before rolling out this source change. This source cleanup does not rotate running credentials or erase Git history.

SMS also requires explicit `ALIYUN_SMS_SIGN` and `ALIYUN_SMS_TEMPLATE` alongside its access keys. Production fails closed when provider configuration is incomplete; `DEBUG` never returns SMS codes in production.
