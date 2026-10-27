# 贡献与维护 / Contributing

贡献前请先沟通修改范围、权利来源与维护安排，不接收未经授权的代码导入。代码、行为规范和测试应一起更新；构建和验收入口见 README，适用许可见 LICENSE-STATUS.md。

Discuss scope, rights and maintenance before contributing. Do not import code without appropriate permission. Update implementation, specifications and tests together. See README for build and verification entry points, and LICENSE-STATUS.md for applicable terms.

## 修改与检查 / Changes and checks

- 维护同一份核心代码，避免维护两份可写核心长期双向合并。Keep one canonical implementation rather than two independently edited copies.
- 同时更新行为规范和测试，不改变既有协议 / 权限语义而不说明兼容性。Update specifications and tests with behavior changes and document compatibility.
- 测试不得连接真实 Agent、读真实配置或产生线上数据。Use isolated fixtures without live agents, personal configuration, or production data.
- 运行冻结安装、构建、单元测试与部署工具测试；失败如实记录。Run frozen installation, builds, unit tests, and deployment-tool tests; report failures accurately.
- 业务规则在商业政策中说明，不添加未经批准的技术 License 锁。Business policy does not authorize adding a technical license lock.

## 安全 / Security

不要在 Issue、PR 或公开群聊中发送密钥、用户数据或未修复漏洞细节。安全报告按 SECURITY.md 的私下联系渠道处理。

Never post secrets, user data, or unpatched vulnerability details in issues, PRs, or public rooms. Follow SECURITY.md for private contact.
