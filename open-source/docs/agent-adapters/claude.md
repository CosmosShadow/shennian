# Claude Code

## 神念如何接入

神念通过官方 `claude` CLI 接入本机已经安装并登录的 Claude Code。`open-source/packages/cli/src/agents/claude.ts` 用 `resolveBuiltinCommand('claude')` 定位可执行程序，并以子进程方式启动一次会话；不使用未发布的私有 API。

## 模型发现

模型 ID 通过运行时探测得到（`model-registry/discovery.ts`），不是写死在源码里的固定列表；探测失败时不会伪造一个"看起来正常"的模型。

## 会话生命周期

- `start`：拼出 CLI 参数并 spawn 子进程，建立一次新的原生会话。
- `send`：把当前用户消息传给同一个子进程/会话。
- `resume`：使用 `--resume <session-id>` 精确恢复对应的原生会话，不猜测"最近一次"。
- `stop`：终止当前子进程并释放资源。

## 系统提示词

Claude CLI 支持 `--append-system-prompt <text>` 参数；神念把当前会话的完整系统提示词通过这个参数传入，不拼接进第一条用户消息。首次 `start` 与之后的 `--resume` 都会重新带上该参数。

## 登录与环境

依赖用户本机已经完成的 Claude 账号登录状态；神念只刷新并转发当前用户环境（Provider Key、`PATH` 等），不写入或读取任何长期账号凭据的具体值到日志、协议或提交文件中。

## 可用性检查

完整检查覆盖：可执行程序可定位、动态模型非空、真实 `start → send → final`、`--append-system-prompt` 生效、`stop` 正常结束、`--resume` 精确恢复同一原生会话。

## 已知限制与排障

- 未安装或未登录 Claude CLI 时，`start` 会在启动阶段失败；先确认 `claude` 命令本身可以在终端正常工作。
- 模型探测依赖 CLI 自身的可用模型列表；账号权限变化会改变可选模型集合。
