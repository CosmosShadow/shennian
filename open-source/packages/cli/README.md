# @shennian/cli

> Shennian AI Agent 控制面的本机后台服务 / CLI
>
> [运行架构与安全边界](../../docs/cli-runtime.md) · [工具接入说明](../../docs/agent-adapters/README.md) · [Agent 协议与 SDK](../agent-protocol/)

## 常用命令

| 命令 | 说明 |
|------|------|
| `shennian` | 智能启动：必要时 pair 再启动后台服务 |
| `shennian pair` | 交互选择浏览器授权或 QR / Token 后重新配对 |
| `shennian pair --browser` | 浏览器授权配对；打不开时会保留 URL |
| `shennian pair --token` | 使用现有二维码 / Token 配对，适合 SSH / headless |
| `shennian start` | 启动后台服务 |
| `shennian stop` | 停止后台服务，保留登录 |
| `shennian logout` | 停止服务并清除本机神念登录与配对凭据，保留模型配置与历史 |
| `shennian status` | 查看后台服务状态 |
| `shennian logs -n 100` | 查看最近日志 |
| `shennian config` | 查看本地配置 |
| `shennian pair --server <url>` | 连接指定的自托管实例并配对；已绑定安装禁止直接换服 |
| `shennian room create/join/status/read/send/attachment get/leave` | 创建或参与明确的神念群聊 |
| `shennian runtime add/list/remove` | 管理自定义 Agent Runtime |
| `shennian upgrade` | 升级 CLI |

`start`、`stop`、`status`、`logout` 可选加 `--json`。`logs` 输出日志文本，不支持 `--json`。
自托管配对时显式指定同一实例地址；同一安装不支持多个活动 Server。停止再启动不能绕过实例绑定保护。

## 随 Client 提供的功能指南

不需要仓库、登录、联网或启动 daemon，当前 Agent 可按需查询：

```bash
shennian guide
shennian guide --search 通知
shennian guide local-apps
shennian guide local-apps --json
shennian help local-apps register
```

指南包括功能目录、群聊、智能体、项目、联系人、电脑、文件夹快捷入口、AI 定时工作、手机通知、录音、英语、日记记忆和导航。开发应用主题解释要起的本地 HTTP 服务、相对资源、SDK 请求、登记、手机打开与诊断；Codex、Claude Code 或已有授权编码工具都可使用。`guide` 是说明文档，`help` 是当前命令参数；手机引导型能力不能伪造为公开 CLI。有文档不代表所有已部署手机/Server 均支持，也不构成执行或权限授权。

## 开发

```bash
pnpm build   # tsc 编译
pnpm dev     # tsc --watch
```

## 测试

```bash
cd open-source/packages/cli

# 全部 agent E2E
npx tsx src/__tests__/agents-e2e.ts

# 单个 agent
npx tsx src/__tests__/agents-e2e.ts claude
```

## 依赖

- `@shennian/wire` — 协议类型定义

## 本地应用（开发候选，需支持该能力的 Client 与手机 App）

应用文件和业务数据保存在本人机器，不公开分享，不存云端 HTML 版本。将服务绑定到 `127.0.0.1`，以相对资源路径构建 HTML/JS/CSS；神念云端只负责鉴权与转发。

```bash
shennian local-apps register --title "我的应用" --port 5173 --path / --directory /absolute/project
shennian local-apps list
shennian local-apps remove <app-id>
```

更新登记用相同 `--id <app-id>`；移除不删应用文件。页面使用 `await shennian.personal.service(machineId, 5173, 'POST', '/api/action', { value: 1 })`，返回 `{ status, headers, body }`。仅支持本人已登记的应用端口及 GET/POST/DELETE，不传递系统凭据，不自动重试写入。业务数据何时保存由自己的服务决定；展开、输入、动画不触发 HTML 保存。

当前首期不代理 WebSocket/HMR，修改后在手机中刷新。详细约束见仓库 `docs/architecture/local-apps.md` 与 `docs/engineering/local-dev.md`；实际是否已发布以发布记录为准。

用户问起本地应用的配置或连接时，AI 可用 `shennian local-apps inspect <id>` 按需读取元信息（不返回机器凭据），用 `shennian local-apps doctor <id>` 只读检查指定入口。诊断只做已登记端口的单次 GET，不扫描端口、自动修复或返回页面内容。`check: local_entry_http` 的成功不等于云端/手机整条链路健康；只有用户授权后再执行修复。
