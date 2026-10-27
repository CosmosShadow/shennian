# 官方 Adapter 详情文档规范

每个神念官方支持的 Agent 使用一份 Markdown 文件：

```text
open-source/docs/agent-adapters/<adapter-id>.md
```

发布 Client 时把这些文档作为只读文本资源随 CLI 一起打包。Client 的 `adapter show <adapter-id>` 和界面详情读取同一份正文，不在 Server、App 和 Skill 复制另一套能力说明。

文档是面向用户及其本地 AI 的连续文本，不是要求服务端长期维护的结构化能力矩阵。建议包含：

```markdown
# <Agent 显示名称>

## 神念如何接入
说明使用的 SDK、CLI、app-server 或机器接口，以及最低版本。

## 模型发现
说明如何动态获得模型，以及请求模型与实际上游模型的判断边界。

## 会话生命周期
说明 start、send、stop、resume 的真实上游机制。

## 系统提示词
说明使用的真实 system/instructions 参数和检查方式。

## 登录与环境
说明原生登录、Provider 配置、环境变量和工作目录来源；不写任何值。

## 可用性检查
说明完整检查步骤和通过条件。

## 已知限制与排障
说明稳定错误阶段、常见失败和建议本地 AI 执行的安全检查。
```

规则：

- 只写用户可验证事实，不公开神念私有实现代码；
- 不包含 Token、真实环境变量值、私人路径或内部 ID；
- 实现机制变化必须同时更新文档和对应 Adapter 检查；
- Agent 未完成完整检查时，详情文档仍可用于排障，但该 Agent 不进入正常可选列表。
