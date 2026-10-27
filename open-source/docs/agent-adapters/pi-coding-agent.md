# Pi Coding Agent

## 神念如何接入

神念通过 Pi Coding Agent 的 RPC 客户端接入（`open-source/packages/cli/src/agents/pi-coding-agent.ts`、`pi-rpc-client.ts`），以子进程 + RPC 的方式通信。

## 模型发现

模型通过运行时探测获得，不是写死在源码里的固定列表。

## 会话生命周期

- `start` / `send`：spawn 子进程并通过 RPC 发送当前用户回合。
- `resume`：精确恢复指定原生会话；代码在恢复失败并检测到 RPC 恢复了不同会话时会主动报错（"Pi RPC resumed a different session"），拒绝把错误会话当作恢复成功。
- `stop`：终止当前子进程。

## 系统提示词

Pi Coding Agent 把完整系统提示词写入一个临时 `instructions.md` 文件，再通过 `--append-system-prompt <file>` 传给上游，属于真实的文件型 system/instructions 通道，不拼接进用户正文。

## 登录与环境

依赖用户本机已经完成的 Pi Coding Agent / Provider 登录；神念只转发刷新后的当前用户环境，并清理 `NO_COLOR` 等无害运行时标记。

## 可用性检查

完整检查覆盖：可执行程序可定位、动态模型非空、真实 `start → send → final`、`instructions.md` 文件注入生效、`stop` 正常结束、精确 `resume`（并拒绝任何非目标会话）。

## 已知限制与排障

- `resume` 明确拒绝"恢复了别的会话"这种情况；遇到此类错误说明上游把请求路由到了错误的原生会话，需要先排查 Pi Coding Agent 自身的会话管理。
