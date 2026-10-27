# Server 扩展契约

本规范描述已实现的公共扩展机制，不要求取得官方商业模块。扩展契约和注册实现在本公共工程的 `packages/server-extensions`；完整 Server 暂在父工程 `packages/server`，目录迁移期间只维护一个源。

## 构建与依赖

- `@shennian/server/core` 导出 `buildApp`、`ServerExtension` 和模块状态类型；导入不启动监听。
- `@shennian/server/runtime` 提供显式启动入口。独立核心入口 `core-server.ts` 只允许 `SHENNIAN_DEPLOYMENT_MODE=self-hosted`。
- 运行 `pnpm --filter @shennian/server build:core`，使用独立配置与输出 `dist-core`，编译依赖审计隐藏私有目录。输出包含 schemas 与 `build-modules.json`，不含官方入口和支付代码。
- `@shennian/server` 不依赖私有 workspace 包。私有组合包可以按明确版本依赖公共核心，不能让核心反向 re-export 私有实现。
- 过渡导出 `@shennian/server/integration` 仍聚合历史计费、邀请、认证服务，供外部组合使用；它不是稳定社区 API，不在核心入口依赖图中。历史业务尚需端口迁移，当前全仓不能直接视为已审计的公开包。

## 注册与故障语义

`buildApp({ extensions })` 默认空清单。扩展有唯一 `id`、`apiVersion: 1`、可选 `officialOnly / enabled` 与 Fastify `routes`。注册前校验完整清单，重复或不合法项导致启动失败。

- 未组合：能力不可用，不执行私有代码；缺少计费模块时 `/billing` 及其子路由返回 404 `module_unavailable`。
- 已组合但关闭：保留模块可用/关闭的区别；接口仍须遵守认证和运行开关。
- 已声明但 import 或初始化损坏：启动失败，不吞异常冒充“未安装”。
- `officialOnly` 不在自托管模式执行。该标记不是沙箱；扩展属于受信服务端代码，不接受客户端提交的任意模块路径。
- `/public/modules` 与兼容别名 `/api/public/modules` 返回 `schemaVersion` 和 `available/enabled`，不暴露配置、路径和密钥；响应不缓存。

## 验证

公共注册行为由 `packages/server-extensions/src/__tests__/register.test.ts` 覆盖，可从公共根独立构建并运行。完整集成工程另有核心 factory、独立编译和容器入口检查，不属于本公共子集的运行前提。单元验证不启动真实 Server、数据库、Relay 或支付。
