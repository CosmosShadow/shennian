# 神念 Agent 协议与示例

神念通过本机 Adapter Runtime 接入第三方 AI。

- [Client 架构与安全边界](../../docs/cli-runtime.md)
- [Adapter 协议](./PROTOCOL.md)
- [各工具接入说明](../../docs/agent-adapters/README.md)

`examples/` 与 `sdk/` 保留 Node / Python 示例和协议 SDK；测试只使用本地回显夹具，不调用真实模型。SDK 自带的许可保持原文，不因主工程迁移而改写。

凭据由部署者在本机配置，不提交到源码或放入分发制品。示例配置模板为 `provider-config.example`；不要提交含真实值的配置。
