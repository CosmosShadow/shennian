# 自定义 Node Adapter

## 神念如何接入

这一项不对应某个具体的第三方 Agent，而是神念自适应接入的入口：当官方 Adapter 无法适应你机器上的实际安装、网关或启动方式时，你的本地 AI 可以用 [神念 Adapter 协议 V1](../../packages/agent-protocol/PROTOCOL.md) 写一个 `adapter.mjs`，交给独立 Shennian Client 内置的 Adapter Runtime 加载和检查。

```text
shennian adapter init <目录> --name <名称>
shennian adapter check <adapter.mjs> --workdir <目录> [--model <模型>]
shennian adapter add <名称> --entry <adapter.mjs>
shennian adapter list
shennian adapter show custom:<名称>
shennian adapter remove <名称>
```

## 模型发现

由你自己实现的 `listModels` 决定；必须每次从上游真实、动态发现，且至少返回一个模型。

## 会话生命周期

`start / send / stop / resume` 全部由你自己的 `adapter.mjs` 实现；Runtime 负责 JSON Lines、并发、取消、终态和错误归一，你不需要自己处理这些。

## 系统提示词

`start / resume` 必须接收 `systemPrompt`，并通过上游真实的 system/instructions 参数注入；`send` 不再携带系统提示词。`adapter check` 会用一次真实的冲突测试验证这一点，只把结果写文本代码位置，不要求可再验证的形式化证明。

## 登录与环境

`adapter check` 使用与官方 Agent 相同的、刷新过的当前用户环境，并过滤神念长期账号、机器和登录凭据；你的 Adapter 自己启动的子进程必须继承这份环境，不能用空环境覆盖 Provider Key。

## 可用性检查

见 [神念 Adapter 协议 V1](../../packages/agent-protocol/PROTOCOL.md) 第 9 节的完整检查清单：模块契约、动态模型、真实 `start`、系统提示词冲突测试、`send` 终态、`stop`、精确 `resume`。全部通过后才能 `adapter add` 注册。

## 已知限制与排障

- `adapter add` 只接受指纹未变化、已经通过 `adapter check` 的文件；修改文件后需要重新 `check`。
- 检查失败时按返回的 `stage` 和错误码定位问题：`models`、`start`、`systemPrompt`、`send`、`stop`、`resume` 分别对应协议里的对应阶段。
- 通用实现完整通过检查后，可以在你确认的前提下生成一份脱敏文件提交给神念官方，参考 [Agent 自适应接入](../cli-runtime.md) 第四节。
