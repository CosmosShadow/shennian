# 神念 Adapter 协议 V1

> 状态：规范已确认；Runtime / CLI V1、本地注册桥接与单文件提交审核入口已形成开发候选，见 `TASK-20260922-1021` / `TASK-20260922-1232` / `TASK-20260922-1236`；尚未统一 QA，不得发布
> 范围：独立 Shennian Client 内置 Adapter Runtime 与本地 Node Adapter
> 产品流程：[Agent 自适应接入](../../docs/cli-runtime.md)

## 1. 目标

本协议用于把本机第三方 Agent 接入神念。所有新接入统一实现这一份协议，不保留多套公开协议或多语言 SDK。

用户或其本地 AI 编写一个 Node ES Module，只实现五个生命周期函数。独立 Shennian Client 自带 Adapter Runtime，负责进程、JSON Lines、请求关联、并发、取消、终态和错误处理。

```text
Shennian daemon
    ↕ stdin / stdout JSON Lines
Client 内置 Adapter Runtime（独立子进程）
    ↕ 生命周期函数
adapter.mjs
    ↕ SDK / CLI / app-server
第三方 Agent
```

Desktop 不内置 Client、Runtime 或第三方 Agent。daemon 不直接 import 用户代码。

## 2. 交付方式

Adapter Runtime 在工程中可以作为独立 npm 包维护，但必须：

- 作为 `shennian` CLI 的捆绑依赖随独立 Client 发布；
- 版本与 Client 一起升级；
- 不要求用户在 Adapter 目录执行 `npm install`；
- 不要求用户理解或直接实现 JSON Lines；
- 在 daemon 之外的子进程加载用户的 `adapter.mjs`。

用户只维护 Adapter 文件本身。

## 3. Adapter 模块

`adapter.mjs` 默认导出一个对象：

```js
export default {
  name: 'Example Agent',
  version: '1.0.0',

  async listModels({ workDir }) {
    const models = await upstream.listModels({ workDir })
    return {
      models: models.map((model) => ({ id: model.id, name: model.name })),
      defaultModel: models[0].id,
    }
  },

  async start({ sessionId, workDir, modelId, systemPrompt }) {
    const client = await upstream.start({ workDir, modelId, systemPrompt })
    return { session: client, nativeSessionId: client.sessionId }
  },

  async send({
    session,
    text,
    modelId,
    reasoningEffort,
    attachments,
    signal,
    output,
  }) {
    for await (const event of session.send({
      text,
      modelId,
      reasoningEffort,
      attachments,
      signal,
    })) {
      if (event.type === 'text') output.delta(event.text)
      if (event.type === 'thinking') output.delta(event.text, { thinking: true })
      if (event.type === 'tool-call') output.toolCall(event.name, event.args)
      if (event.type === 'tool-result') output.toolResult(event.name, event.result)
    }
    output.setNativeSessionId(session.sessionId)
    output.final()
  },

  async stop({ session, reason }) {
    await session.stop(reason)
  },

  async resume({ nativeSessionId, workDir, modelId, systemPrompt }) {
    const client = await upstream.resume(nativeSessionId, {
      workDir,
      modelId,
      systemPrompt,
    })
    return { session: client, nativeSessionId }
  },
}
```

`name`、`version` 和五个函数全部必需。

## 4. 强制生命周期

### 4.1 `listModels`

输入：

```ts
type ListModelsInput = {
  workDir: string
}
```

输出：

```ts
type ModelList = {
  models: Array<string | { id: string; name?: string }>
  defaultModel: string
}
```

规则：

- 必须运行时从当前 SDK、CLI、app-server 或上游配置动态发现；
- 必须返回至少一个非空、唯一的模型 ID；
- `defaultModel` 必须存在于 `models`；
- 禁止把某次机器探测结果复制到源码里长期写死；
- 无法可靠发现模型的 Agent 不满足协议，不能注册为可用 Adapter。

`modelId` 只是请求模型。上游未返回可信实际模型标识时，不得声称已经观察到另一个模型。

### 4.2 `start`

输入：

```ts
type StartInput = {
  sessionId: string
  workDir: string
  modelId: string
  systemPrompt: string
}
```

输出：

```ts
type SessionResult = {
  session: unknown
  nativeSessionId: string
}
```

规则：

- `session` 只保存在 Runtime 子进程内存中，不序列化给 daemon；
- `nativeSessionId` 必须是上游真实、稳定、可恢复的 Session ID；
- 启动必须使用指定工作目录和模型；
- `systemPrompt` 是 Client 为该 Session 生成的完整、不可变系统提示词，Adapter 必须在创建上游 Session 时通过真实 system / instructions 通道注入；
- 禁止把 `systemPrompt` 拼接进首条用户消息，或者伪装成用户消息；
- 启动的 SDK、CLI 或 app-server 必须继承 Runtime 提供的当前用户环境。

### 4.3 `send`

输入：

```ts
type SendInput = {
  sessionId: string
  session: unknown
  text: string
  modelId: string
  reasoningEffort?: string
  attachments: Array<{ path: string; name?: string; mime?: string }>
  signal: AbortSignal
  output: AdapterOutput
}
```

强制规则：

- `text` 只包含当前用户消息；系统提示词已经由 `start` 或 `resume` 作为 Session 配置建立；
- `send` 不接收、拼接或热更新系统提示词；
- 每次必须使用指定 `modelId`；
- 同一 Session 同时只允许一个活动 Turn；
- 收到 `signal.abort` 后必须尽快停止上游执行；
- 普通对话与智能体使用相同结构，协议中没有 Room、AgentIdentity、Membership 或 Binding 字段。

### 4.4 `stop`

输入：

```ts
type StopInput = {
  sessionId: string
  session: unknown
  reason: 'client_stop' | 'process_shutdown'
}
```

`stop` 必须停止活动 Turn、释放上游进程或连接，并允许 Runtime 有界退出。Runtime 可以在超时后使用 SIGTERM / SIGKILL 收口，但 Adapter 不能依赖强杀作为正常路径。

### 4.5 `resume`

输入：

```ts
type ResumeInput = {
  sessionId: string
  nativeSessionId: string
  workDir: string
  modelId: string
  systemPrompt: string
}
```

输出与 `start` 相同。

规则：

- 必须恢复传入的精确 `nativeSessionId`；
- 禁止恢复“最新”“最近”或任意其他 Session；
- Client 必须保证 `systemPrompt` 与该 Session 保存的 Prompt 快照一致；Prompt 已变化时不得调用 `resume`，而应启动新 Session；
- Adapter 必须把 `systemPrompt` 传给支持恢复时重新声明 instructions 的上游；上游已把 Prompt 固化在原生 Session 中时，也必须恢复同一个 Session，不能创建替代会话；
- 恢复后必须继续同一上下文，并再次返回相同的原生 Session ID；
- 无法实现精确恢复的 Agent 不满足协议。

Adapter V1 不提供第三方历史会话的列表、搜索、导入或全量同步。Client 只保存自己启动后取得的精确 `nativeSessionId`；不得扫描第三方数据库、云历史、其他配置目录，或用“最近会话”代替精确恢复。

## 5. 输出 API

Runtime 提供：

```ts
type AdapterOutput = {
  delta(text: string, options?: { thinking?: boolean }): void
  toolCall(name: string, args?: Record<string, unknown>): void
  toolResult(name: string, result: string): void
  setNativeSessionId(id: string): void
  final(usage?: { inputTokens: number; outputTokens: number }): void
  error(message: string, code: string): void
}
```

规则：

- `final` 和 `error` 是终态；
- 每个已接受的 `send` 必须且只能产生一个终态；
- handler 返回但没有主动终结时，Runtime 自动补 `final`；
- handler 抛错时，Runtime 转为 `error`；
- 终态后的输出被拒绝；
- 工具事件只用于展示，工具仍由上游 Agent 在本机执行。

## 6. 系统提示词检查

Adapter 注册前必须进行系统提示词检查。Runtime 使用一组无敏感信息的冲突测试：

1. systemPrompt 要求输出一个随机挑战值；
2. 用户 text 要求输出另一个不同值；
3. 结果必须遵循 systemPrompt；
4. Adapter 必须证明调用的是上游 system/instructions 参数，而不是正文拼接。

仅凭模型偶然返回正确文本不足以通过。官方 Adapter 文档必须说明真实注入机制；本地 Adapter 提交必须包含对应代码位置和检查结果。

## 7. 环境变量

环境不通过 JSON Lines 传输。Runtime 启动 Adapter 子进程时直接构造进程环境：

- macOS / Linux：刷新当前用户登录 Shell；
- Windows：刷新当前用户和机器环境；
- Client Provider 配置最后覆盖同名值；
- 合并正确的 `PATH`；
- 智能体保留当前 Room 的短期能力变量；
- 删除神念长期账号、机器和登录凭据；
- 删除 Desktop 启动器内部变量。

Adapter 启动自己的子进程时必须继承这份环境。禁止把环境变量值写入 stdout、stderr、模型信息、错误消息、客服消息或提交文件。

## 8. Runtime JSON Lines

这一层只供 daemon 与 Client 内置 Runtime 使用，Adapter 作者通常不直接处理。

### 请求

```json
{"protocolVersion":1,"id":"1","method":"start","params":{"sessionId":"s1","workDir":"/work","modelId":"model-a","systemPrompt":"你是项目助手"}}
{"protocolVersion":1,"id":"2","method":"send","params":{"text":"你好","modelId":"model-a","attachments":[]}}
{"protocolVersion":1,"id":"3","method":"resume","params":{"nativeSessionId":"native-123","workDir":"/work","modelId":"model-a","systemPrompt":"你是项目助手"}}
{"protocolVersion":1,"id":"4","method":"stop","params":{}}
```

每个请求必须包含协议版本 `1`、非空唯一 `id`、方法和对象 `params`。顺序为：

```text
start → send → send ... → stop
resume → send → send ... → stop
```

### 响应

```json
{"protocolVersion":1,"type":"response","id":"2","ok":true,"result":{"accepted":true}}
```

```json
{"protocolVersion":1,"type":"response","id":"2","ok":false,"error":{"code":"turn_active","message":"当前已有执行中的 Turn"}}
```

`send` 的成功响应只表示 Runtime 已接受请求，不表示模型已经完成。

### 事件

```json
{"protocolVersion":1,"type":"event","requestId":"2","event":{"state":"delta","text":"你好"}}
{"protocolVersion":1,"type":"event","requestId":"2","event":{"state":"final","nativeSessionId":"native-123"}}
```

事件类型：`delta / tool-call / tool-result / final / error`。同一 `requestId` 下按 stdout 顺序处理。

### 稳定错误码

| 错误码 | 含义 |
|---|---|
| `invalid_json` | stdin 不是合法单行 JSON。 |
| `invalid_request` | 版本、ID、方法或参数结构不合法。 |
| `method_not_found` | 方法不存在。 |
| `adapter_contract_invalid` | 名称、版本或五个必需函数缺失。 |
| `models_invalid` | 模型发现失败、为空或默认模型不在列表。 |
| `session_not_started` | 未 start 就调用其他方法。 |
| `session_already_started` | 重复 start。 |
| `turn_active` | 同时发起第二个 Turn 或在 Turn 中 resume。 |
| `system_prompt_unsupported` | 不能通过真实 system/instructions 注入。 |
| `start_failed` | start 失败。 |
| `send_failed` | send 失败。 |
| `stop_failed` | stop 失败。 |
| `resume_failed` | resume 失败或不是精确 Session。 |
| `stopped` | Client 已停止当前 Turn。 |

自动化只依赖错误码，不依赖可变错误文案。

## 9. 完整检查

Adapter 只有同时通过以下检查，才可注册并在界面显示：

1. 模块契约完整；
2. `listModels` 动态返回至少一个模型；
3. 选定模型完成真实 `start`；
4. `start / resume` 的独立 `systemPrompt` 通过真实 system / instructions 通道生效；
5. `send` 返回正文和唯一终态；
6. `stop` 正常结束；
7. `resume` 精确恢复同一原生 Session，并完成下一轮对话；
8. Adapter 进程能读取当前用户环境中的测试变量名称对应值，但不把值输出；
9. 神念长期凭据没有进入 Adapter 环境。

检查只证明本地 Adapter 会话链路，不自动创建 Room，也不代替智能体加入真实群聊后的业务排查。

## 10. Client 命令

```text
shennian adapter init <目录> --name <名称>
shennian adapter check <adapter.mjs> --workdir <目录> --model <模型>
shennian adapter add <名称> --entry <adapter.mjs>
shennian adapter list
shennian adapter show <adapter-id>
shennian adapter remove <名称>
shennian adapter submit <adapter.mjs> --agent <通用 Agent 名称> --general-purpose --confirm-share
```

- `init` 不覆盖现有文件；
- `check` 使用正式 Runtime 做完整检查；
- `add` 只接受已经通过检查且文件指纹未变化的 Adapter；
- `list` 只把完整通过的 Adapter 标为可用；
- `show` 输出该官方 Adapter 的 Markdown 详情或本地 Adapter 的说明文档；
- `remove` 只删除注册，不删除用户源码。
- `submit` 只接受最近完整检查通过且 SHA-256 未变化的单个 `adapter.mjs`；`--general-purpose` 声明不是私有 / 组织内部 / 项目专用实现，`--confirm-share` 表示用户已明确同意本次分享。

`check` 失败的 JSON 必须同时返回稳定 `stage / error / nextAction`。`nextAction`
只给出对应生命周期的修复方向，不回显 Adapter stderr、Provider 响应、环境值、
绝对路径中的私有内容或完整日志。本地 AI 对同一实现最多进行 3 轮“编辑 → check”；
仍未通过时必须停止，向用户说明最后的 `stage / error` 和所需外部条件，不得无限重试。

`add` 成功后，Client 将指纹仍匹配的注册项桥接到现有 `AgentAdapter` 会话边界。
`shennian agent discover --refresh` 从注册记录展示检查时动态发现的全部模型和默认模型；
源文件缺失或 sha256 变化时，该注册项立即失效，不再进入发现和正常选择列表。

提交前 Client 与 Server 都必须拒绝超过 256 KiB、非 UTF-8、包含凭据、环境值、
绝对路径或私有内容的文件；Server 独立重算 SHA-256，只私有保存待审核对象。
提交记录不进入 Runtime、发现或注册路径，Server 不 import 或执行未审核源码。

本协议采用硬升级。实现进入开发后，应一次性把 Client、Skill、安装文档、模板、检查器和注册流程全部对齐到 V1，不对外暴露并行协议选择。
