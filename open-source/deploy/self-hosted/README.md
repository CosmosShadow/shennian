# Docker 自托管

在完整社区仓库根先进入 `open-source` 执行（本节命令均以该目录为工作目录）：

```sh
cd open-source
node deploy/self-hosted/init-config.mjs https://your-domain.example
# 网络受限时，可在 docker build 中设置可信的 DEBIAN_MIRROR / NPM_REGISTRY。
docker compose -f deploy/self-hosted/compose.yaml up -d --build
```

配置工具为新实例生成独立身份、账号 namespace、数据库密码、JWT 与存储签名密钥，文件权限 0600；不打印凭据，拒绝覆盖已有配置。默认邀请注册，管理员在本机私下读取 `.runtime/server.env` 中的邀请码后交给受信成员；可在首次配置时追加 `open` 或 `closed` 参数选择注册策略。不要把配置文件提交到 Git、发送给普通用户或放到静态网站。

Compose 启动 MariaDB、Redis，先完成独立的正式 migration，再启动 Server 和 Worker。API 默认只绑定服务器本机的 `127.0.0.1:3000`。部署者须在外部反向代理上配置与上述 URL 一致的受信 HTTPS 和 WebSocket 转发：`/api/` 去前缀转发，其余 API / Relay 路径保持原样；不要跳过证书校验或把数据库端口暴露到公网。默认流程不会安装证书或替部署者配置 DNS。

手机选择「自托管服务器」，填写 HTTPS 域名或带受信证书的 IP，注册 / 登录。电脑使用同一实例完成 Client 配对。只需在 Client 上配置自己的一个模型供应商即可进行 AI 对话，Server 不要求模型、短信、语音、推送或 OSS Key。系统推送默认关闭，站内消息和未读仍保留。

只构建镜像也可以执行：

```sh
docker build --platform linux/amd64 -f deploy/self-hosted/Dockerfile.source -t shennian-selfhost:local .
```

下面保留运行包装配与迁移细节，适合离线交付和已有实例升级。不要对已有实例重新运行配置工具、删除 volume 或重放初始 SQL。先按[备份与升级](backup-and-upgrade.md)固定数据和回退镜像，再执行正式增量迁移。

## 独立自托管运行包

完整仓库的 App 位于 `packages/app`，Server / Worker / Client 位于 `open-source/packages`。本节描述后端运行包，手机的原生编译见[App 指南](../../docs/mobile-app.md)。SSO 当前不提供。

公共根先运行 `pnpm build:backend`，再运行 `pnpm build:runtime <全新输出目录>`。只装配核心编译输出、公开 Client、数据库正式 migrations 和必要依赖；不复制官方包、内部文档、开发目录或任何环境文件。运行清单包含逐文件 SHA-256，依赖锁只保留运行闭包。

部署者独立提供 MySQL / MariaDB、Redis、JWT 与存储签名密钥、64 位十六进制账号 namespace、16–128 位实例 ID、HTTPS 公开 origin。用正常 CA 或部署者自己的受信 CA；不得关闭 TLS 校验。注册策略为 `closed / invite / open`，默认 invite；邀请码由部署者提供，不能用官方短信审核账号代替本地账号。

使用专用数据库执行 `prisma migrate deploy`。已有实例先备份并核对迁移与回退；不要手改官方生产数据库。私有存储目录须持久化并备份。服务启动入口为 `packages/server/dist/core-server.js`，Worker 为 `packages/server/dist/worker.js`，Client 为 `packages/cli/dist/bin/shennian.js`。

Client 用独立 OS 账号和 HOME 首次配对，默认不继承原生 Agent 历史、模型密钥或官方配对。现阶段已绑定安装禁止直接改成另一个 origin；必须使用全新安装，尚未提供安全跨实例历史迁移。客户端只支持一台活动 Server。

## 容器构建输入

使用全新的构建目录，其中 `runtime/` 是上面装配器生成的**原始、尚未安装依赖**的运行包；将本目录的 `Dockerfile`、`.dockerignore`、`verify-runtime.mjs` 复制到该构建目录根部。在该目录执行 `docker build --platform linux/amd64 -t shennian-selfhost:local .`。这只是本地候选标签，不是可从公开仓库下载的发行版。

构建先验证清单中的 SHA-256、缺失 / 额外文件、符号链接与私有路径，再冻结锁文件安装 Linux 依赖。校验是完整性检查，不替代发布者签名、依赖许可或供应链审计。不要把集成仓库、运行状态或密钥目录当作容器 context。镜像不携带环境文件、模型 Key 或官方模块。

镜像包含正式 migration 所需的 OpenSSL 与 Prisma engine。默认不执行所有第三方安装脚本，只显式下载 Prisma migration engine。网络受限时可由管理员选择可信镜像源，不关闭 TLS / 包完整性验证。低内存实例宜在其他构建机生成同架构镜像，再导入部署机；不要求在承载业务的机器上编译或安装依赖。

`DEBIAN_MIRROR` 是站点 origin，例如 `https://mirrors.aliyun.com`，不要再附加 `/debian`（Dockerfile 保留原仓库路径）；`NPM_REGISTRY` 可显式指定受信 npm registry。Linux amd64 源码构建和 759 个运行输入文件校验已通过，不含环境文件、模型密钥、官方组合模块或内部文档。Docker 构建不代替原生界面、升级恢复或生产负载验收。

独立运行校验器测试：`node --test verify-runtime.test.mjs`，无须内部 workspace、数据库或任何密钥。

## 独立的正式迁移链

自托管使用本目录 `prisma/migrations` 中的独立正式迁移，不重放官方历史增量，也不连接官方数据库。前三步由唯一的 Server Prisma schema 生成初始结构，第四步安装联系人约束触发器与初始写入控制记录；第五步追加个人会话云副本表和调度列，不改写前四步 SQL。触发器保持“联系人恰有一个目标”的数据库级约束，避免 MySQL / MariaDB 不允许 CHECK 列参与级联外键的冲突；不是简单删掉校验。

`baseline.json` 固定当前迁移链对应的 schema SHA-256。运行包装配时校验与唯一 schema 一致；有 schema 变化却没有更新迁移链时构建失败。已有自托管部署以后只能追加正式迁移，不重写已应用 baseline，也不能在升级时重新初始化数据目录。官方历史 migrations 由官方组合独立维护，内容与已应用 checksum 不变，不进入公共初始化路径。

推荐**新建**数据库在初始化数据目录前明确配置：

```text
lower_case_table_names=1
character_set_server=utf8mb4
collation_server=utf8mb4_unicode_ci
```

MariaDB 容器可用 `--lower-case-table-names=1`、`--character-set-server=utf8mb4`、`--collation-server=utf8mb4_unicode_ci` 启动参数。官方历史迁移还存在表名大小写与默认字符集假设，不能将其当作可直接用于空库的自托管安装器。不要对已有业务数据库直接切换大小写模式、删除 volume 或手改 migration 记录；已有部署需单独备份、评估和迁移。

先等待数据库健康，再用该实例的独立配置运行 migration 容器，工作目录为 `/app/packages/server`，命令为 `node node_modules/prisma/build/index.js migrate deploy`。正式迁移成功后再启动 Server / Worker；不能以 `db push`、直接执行临时 SQL、手填 applied 状态或忽略失败的 migration 代替验收。

反向代理向外提供受信 HTTPS，`/api/` 去前缀转发，其余路径保持原样，同时支持 WebSocket。必须持久化 `SHENNIAN_STORAGE_DIR` 对应的私有目录。测试 CA 只用于明确导入该 CA 的测试设备，不代表公网证书配置已完成。

`SHENNIAN_PUBLIC_URL` 也是本实例群邀请等分享 URL 的安全默认，不应指向官方 Web。独立 Web 站点可显式设置 `WEB_APP_PUBLIC_BASE_URL`；当前仅运行 API 的安装不意味着已包含可浏览的完整 Web 前端。手机按当前实例 origin 校验邀请链接，不靠链接切换实例。跨域独立 Web 与手机信任配置需要另行验收。

首轮只需为隔离 Client 的原生 AI 配置一家模型供应商；模型 Key 不必交给 Server。已验证 Pi + DashScope `qwen-plus`、手机填写 HTTPS IP 后注册登录 / 配对、真实回复、两用户群聊和本地附件。可选短信 / 语音 / 系统推送未配置不等于这些功能已验收。统一缺失能力提示、完整源码迁移和跨版本升级矩阵仍待完成；单实例加密备份 / 隔离恢复以及一对镜像升级回退已演练。SSO 当前不实施。维护 / migration 用独立一次性容器，避免与常驻 Server 共用内存限额；测试机的运行结果不构成生产容量保证。

功能架构见[开源系统架构](../../docs/system-architecture.md)，逐项状态见[验收矩阵](../../docs/self-hosted-acceptance.md)。

备份采集范围、加密工具、隔离恢复和升级回退见[运维说明](backup-and-upgrade.md)。
