# Cursor Agent

## 神念如何接入

神念通过 `cursor-agent` CLI 接入（`open-source/packages/cli/src/agents/cursor.ts`），以子进程方式启动并解析输出。

## 模型发现

模型通过运行时探测获得（`model-registry/discovery.ts` 中的 Cursor 分支），不是写死在源码里的固定列表。

## 会话生命周期

- `start` / `send`：spawn `cursor-agent` 子进程并发送当前用户回合。
- `resume`：使用 `--resume <chat-id>` 精确恢复对应的原生会话。
- `stop`：终止当前子进程。

## 系统提示词

**当前实现不满足 Adapter 协议 V1 的系统提示词要求。** 代码里的系统提示词是通过 `buildInlineChannelPreamble(...)` 拼接在用户正文前面一起发送给 `cursor-agent`（见 `cursor.ts` 的 `send()`），而不是通过 Cursor 的独立 system/instructions 参数注入——因为 Cursor Agent CLI 目前没有暴露这样的参数。这正是协议 V1 明确禁止的"拼入用户正文"，因此 Cursor 目前无法通过完整检查的系统提示词冲突测试。

## 登录与环境

依赖用户本机已经完成的 Cursor 账号登录。Cursor Agent 没有经过验证的、按调用范围移除 Provider 凭据的方式，因此神念不会为它单独下发 Provider 环境变量，而是依赖 Cursor 自身的登录态。

## 可用性检查

模型发现、`start/send/stop` 和精确 `resume` 目前可用；系统提示词检查会失败，因此 Cursor 目前不满足 Adapter V1 的完整检查，不进入正常可选列表。

## 已知限制与排障

- 系统提示词目前是内联拼接，不是真实的 system/instructions 通道；在 Cursor Agent CLI 提供对应参数之前，官方 Adapter 无法通过完整检查。
- 需要真实通过检查的场景，可以由本地 AI 参考 Adapter V1 尝试其他机器接口（如存在），并把结果提交给神念官方评审。
