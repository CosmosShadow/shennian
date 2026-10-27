# Shennian Client / CLI

Client 是运行在用户电脑上的本机服务，CLI 是它的命令入口；它不是已暂停维护的 Desktop 图形客户端。唯一源码在 `packages/cli`，Wire 提供与 Server / App 一致的通信类型。

## 构建与运行

在公共仓库根目录执行 `pnpm install --frozen-lockfile`、`pnpm build`。构建包含 CLI、Wire、Shared、扩展契约和协议 Node SDK；CLI 的帮助入口为：

```sh
node packages/cli/dist/bin/shennian.js --help
node packages/cli/dist/bin/shennian.js --version
```

运行配对前先阅读 `pair --help` 并显式选择目标实例地址。自托管手机与 Client 必须连接同一实例。此源码构建不意味着已经启动 Server，也不替用户安装或登录其他 AI。

## 职责与数据流

- CLI：配对、配置、状态、后台进程、升级、工具能力查询与明确授权的 Room 操作。
- Daemon / Session：维持已配对身份、连接 Relay、持久化会话 / 队列，处理断线、恢复和进程生命周期。
- Adapter：发现已有工具、动态模型、调用与停止、精确恢复原生会话；[接入说明](agent-adapters/README.md)与 CLI 随包资源来自同一正文。
- 本机能力：按权限处理文件、项目、记忆、任务与已登记应用，不把整机信任误称为文件沙箱。
- 升级器：核对渠道、候选与完整性，协调独立进程安装与失败回退；源码编译不自动上传或发布软件。

## 账号与实例边界

同一安装只有一个活动 Server。保存的身份属于对应实例；已有绑定拒绝直接切换 origin，不能只改 URL 复用身份或混合官方云与组织数据。独立测试必须使用自己的 HOME 和配置目录，不能对真实安装执行 logout、覆盖配置或删除历史。

本机模型凭据由用户提供，不进入源代码，不随普通消息转发给其他用户。机器、Room 和智能体分别进行授权；外部 AI 经 CLI / Skill 操作群聊仍以真人身份发送，不因调用工具自动成为独立成员。

## 测试

公共 Vitest 运行包内单元测试，排除 `*.real.test.ts`，不加载官方 Server 环境配置。示例 Agent 是本地可控回显夹具，不是真实 Provider。临时文件放在系统 tmp 的 `shennian-tests/unit/`，本轮仅清理自己的路径。

官方 npm 发布、跨系统真实安装升级与官方站点文档一致性属于集成工程的发布门禁，不要求第三方获取私有脚本才能编译 Client。协议、权限和更新信任变化仍需专项验证，不能以普通编译替代。

## 本地应用显式分享（源码候选）

本地登记仍默认私有。`local-apps share <appId> --post /exact/api/path --asset /exact/asset.js` 向当前绑定实例申请 30 天免登录链接；入口自动授权，只逐项授权公共 GET 资源和 POST API，不支持通配符、任意端口或删除操作。不要授权管理接口或包含私人数据的资源。链接持有者均能访问，匿名不能保证一人一次；`local-apps unshare <shareId>` 撤销链接及其短期访客权限。运行中的配对 Client 与应用服务必须在线，分享服务不离线暂存业务数据。命令与 Server 必须都含本次实现；源码检查不代表已发布到安装渠道。
