# OpenCode

## 神念如何接入

神念通过 OpenCode CLI 接入（`open-source/packages/cli/src/agents/opencode.ts`），以子进程方式启动并解析输出；模型清单还可以通过 OpenCode 自身的 API（`model-registry/opencode-api.ts`）查询。

## 模型发现

模型通过运行时探测获得，不是写死在源码里的固定列表。

## 会话生命周期

- `start` / `send`：spawn OpenCode 子进程并发送当前用户回合。
- `resume`：精确恢复对应原生会话。
- `stop`：终止当前子进程。

## 系统提示词

系统提示词通过 `buildInlineChannelPreamble(...)` 拼接在用户正文前一起发送（见 `opencode.ts` 的 `send()`）。这是当前 OpenCode 兼容接入的既定传递方式；如上游提供稳定的独立 system/instructions 参数，将另行评估迁移。

## 登录与环境

依赖用户本机已经完成的 OpenCode / Provider 登录；神念只转发刷新后的当前用户环境。

## 可用性检查

模型发现、`start/send/stop` 和精确 `resume` 可用。候选对 OpenCode 1.18.x 与 2.0.11 共用子进程工作目录，并在 POSIX 同步 `PWD`，不传 2.0.11 不接受的 `run --dir`。代码级检查已通过；两个版本的真实 `agent check`、工作目录与回复仍需独立实机回归后才能宣称兼容完成。

## 已知限制与排障

- 系统提示词当前以内联方式传递；这是兼容接入策略，不影响可用性检查。
