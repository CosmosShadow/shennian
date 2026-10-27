# 应用、智能体与 AI 原生组织 / Apps, agents, and AI-native organizations

神念连接你的本地 AI、其他人和他们的 AI。个人可以组织自己的 AI 团队，公司可以连接同事、智能体与本地业务应用。官方云与自托管使用同一套 App / Client；开发应用不以自建 Server 为前提。

Shennian connects local AI, people, and their AI. Individuals can organize personal AI teams; companies can connect colleagues, agents, and local business apps. Cloud and self-hosted deployments share the same App/Client; building apps does not require hosting a Server.

## 意见收集与小工具 / Feedback forms and tools

从[可运行意见表](examples/feedback-form/README.md)开始：AI 创建表单 → 本地运行 → Client 登记 → 仅开放入口资源与提交 API → 访客填写 → 本地文件保存 → 主人查看或撤销分享。可以在此基础上开发问卷、内部需求收集、活动报名或其他轻量工具；新增个人信息字段前，应补充明确告知、业务授权、保留期限及适当保护。

Start with the [runnable feedback form](examples/feedback-form/README.md): create a form, run it locally, register it with Client, expose only the entry and submission API, let visitors submit, save locally, and revoke the share when finished. Extend it into surveys, internal requests, or lightweight tools. Add appropriate notice, business authorization, retention, and protection before collecting personal information.

资源分享不是整机代理，也不自动为应用生成权限、认证、存储或幂等语义。数据属于应用自己的存储；Server 不会替所有应用自动备份其本地目录。应用 / Client / 电脑需要在线。访客使用应用不要求成为本实例的注册账号；组织账号计数以许可定义为准。

Resource sharing is not a general computer proxy and does not invent application authorization, authentication, persistence, or idempotency. Apps own their storage; Server does not automatically back up every computer's app data. The computer, app, and Client must remain online. Visitors need not become registered instance accounts; organization-account counting follows the license.

## 智能体、客服与群聊 / Agents, support, and rooms

1. 准备能真实回复的本机 AI 与自己的模型配置，完成 Client 与 Server 的配对。Prepare working local AI and your own model configuration, and pair Client with Server.
2. 为智能体设定名称、职责、电脑、专用工作目录与最小必要权限。配置自己的产品资料，限制能访问的文件与工具。Give the agent a name, role, computer, dedicated workspace, and least-required permissions. Supply your own product knowledge and bound its files and tools.
3. 选择访客分享或群聊；测试访客身份隔离、错误回答处理和撤权，再将入口给真实用户。Choose visitor sharing or a room. Test visitor isolation, failure handling, and revocation before distribution.
4. 在自己的实例复用这些机制搭建客服、内部知识助手或项目团队。官方客服只是产品用例，不是随开源工程发放的官方账号、完整知识库或凭据。Run your own support, knowledge assistant, or project team on your instance. Official support is a product example, not a bundled official identity, complete knowledge base, or credentials.

含真实账号与工作环境的旧截图已撤下，后续使用专用演示数据。客服需使用部署者自己的资料、模型与权限。

Screenshots of real accounts and workspaces have been withheld; future demos will use synthetic data. Supply your own knowledge, model, and permissions.

## 主机与实例边界 / Host and instance boundaries

手机、电脑 Client 和分享对象都属于选定实例，不自动跨官方云与公司实例互通。已有安装不能直接覆盖实例绑定来混用数据。无短信、推送或语音配置时，先验证本地账号、配对和一家模型的回复链路。SSO 不属于本版功能；企业 OTA 是独立构建与签名配置，不随业务 Server 地址切换。

The App, Client, and shared objects belong to the selected instance; cloud and company instances are not automatically federated. Do not overwrite an existing binding to mix data. Start with local accounts, pairing, and a single model before configuring SMS, push, or speech. SSO is not included. Enterprise OTA uses separate build/signing configuration and does not change when selecting a business Server.
