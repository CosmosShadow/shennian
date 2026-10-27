# Codex

## 神念如何接入

神念通过 Codex 的 app-server 机制接入（`open-source/packages/cli/src/agents/codex.ts`、`codex-runtime.ts`、`codex-protocol.ts`），以 JSON-RPC 方式与本机 Codex 会话通信，而不是逐行解析普通终端输出。

## 模型发现

模型通过运行时探测获得；探测失败时使用一份内置的保底模型列表（`fallbackCodexModels()`）而不是直接判定 Agent 不可用，但保底列表仅作为探测失败的兜底展示，不代表已经验证该模型真实可回复。

## 会话生命周期

- `start`：建立一个新的 Codex thread。
- `send`：向当前 thread 发送一次用户回合。
- `resume`：通过 `thread/resume` 精确恢复指定 thread；神念内部注释明确标注"精确恢复是真实能力，终端检查 / Turn 重新挂载不是"，即只保证按 ID 恢复这一项。
- `stop`：结束当前回合并释放子进程/连接。

## 系统提示词

Codex app-server 支持以配置方式声明指令来源（代码中的 `model_instructions_file` 配置项），神念据此把完整系统提示词写入真实的指令通道，而不是拼进用户消息正文。

## 登录与环境

依赖用户本机已经完成的 Codex 账号登录；神念只转发刷新后的当前用户环境，不写入长期账号凭据的具体值。

## 可用性检查

完整检查覆盖：app-server 可连接、动态模型非空、真实 `start → send → final`、指令注入生效、`stop` 正常结束、`thread/resume` 精确恢复同一 thread。

## 已知限制与排障

- 模型探测失败时展示的是保底列表，不代表已验证可用；仍需要一次真实 `check` 才能确认。
- Codex 的终端检查与 Turn 重新挂载能力有限，恢复能力目前只保证"按精确 ID 恢复"这一项。
