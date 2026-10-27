# WorkBuddy

## 神念如何接入

神念通过 WorkBuddy（CodeBuddy）CLI 接入（`open-source/packages/cli/src/agents/workbuddy.ts`），以子进程方式启动并解析输出。

## 模型发现

模型通过运行时探测获得；探测失败时使用内置保底列表（`fallbackWorkBuddyModels()`）展示，同样只是展示用途，不代表已验证可回复。

## 会话生命周期

- `start` / `send`：spawn WorkBuddy 子进程并发送当前用户回合。
- `resume`：使用 `--resume <session-id>` 精确恢复对应原生会话。
- `stop`：终止当前子进程。

## 系统提示词

WorkBuddy CLI 同时支持 `--system-prompt-file <path>` 和 `--append-system-prompt <text>` 两种真实参数；`workbuddy.ts` 会按平台和长度选择用文件还是文本参数传入完整系统提示词（提示词较长或所在平台更适合文件方式时写入临时文件），不会拼接进用户正文。

## 登录与环境

依赖用户本机已经完成的 WorkBuddy 账号登录；神念只转发刷新后的当前用户环境。

## 可用性检查

完整检查覆盖：可执行程序可定位、动态模型非空、真实 `start → send → final`、系统提示词参数生效、`stop` 正常结束、`--resume` 精确恢复同一原生会话。

## 已知限制与排障

- 已恢复的原生 Session 中，某些平台上的 `<speaker>` 结构化块可能被特殊处理，具体行为以实际会话为准。
- 模型探测失败时的保底列表仅供展示，请以真实 `check` 结果为准。
