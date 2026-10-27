# 企业自有 OTA（可选）

状态：2026-10-24 开发候选。通用配置、离线签名发布器、只读企业分发服务与专项单元测试已提供；尚未完成企业原生壳的真实下载、重启应用、失败恢复或真机验收。不能把已有官方 OTA 或 Docker 升级验收当作企业 OTA 验收。不需要 OTA 时不部署此服务。

## 范围与信任边界

- 公共能力：更新配置、Expo manifest / 资源分发、SHA-256、RSA 签名、按 platform / runtime / channel 隔离、原子激活和基线冲突检查。
- 企业服务位于 `deploy/enterprise-ota/`，独立于业务 Server、账号权限、充值和授权。无按席位 / 代码 License 门禁。企业合同授权不是 OTA 发布密钥。
- 企业自己持有签名私钥、原生应用签名与运维发布权限。只读容器仅挂载**公开证书**和分发目录，不能签名或上传。发布者能修改应用代码，应与普通业务管理员分权。
- 登录 IP / 域名是**业务服务地址**，不是 OTA 地址。切换业务服务器不会改变原生壳的更新源、证书或渠道。官方 App 不会因为连接公司服务器而信任公司代码；企业自有 OTA 必须制作自己的原生壳。
- 公共策略 `open-source/config/ota.cjs` 不包含官方域名、EAS 项目或对象存储账号。共用 `packages/app/app.config.ts` 默认使用自托管发行配置、OTA 关闭，不寻找官方目录。维护者自己的发行工作区可显式声明构建组合；这不改变共用 App 界面，也不是企业更新服务的依赖。构建入口见[App 指南](mobile-app.md)。

## 1. 默认关闭或显式启用

构建企业 App（不是在 Server 容器里填写这些变量）：

| 变量 | 默认 / 作用 |
|---|---|
| `SHENNIAN_DISTRIBUTION=self-hosted` | 必须显式指定；避免使用混合工程的官方组合 |
| `SHENNIAN_OTA_MODE=disabled` | 公共策略默认；`updates.enabled=false`，无官方更新源和 EAS ID |
| `SHENNIAN_OTA_MODE=self-hosted` | 开启自有 OTA，缺必要配置立即构建报错 |
| `SHENNIAN_OTA_URL=https://ota.example.com/api/updates` | 独立 HTTPS 更新源，不允许 URL 用户信息 / 查询密钥 / fragment |
| `SHENNIAN_OTA_CODE_SIGNING_CERTIFICATE=/secure/company-public.pem` | 构建机上公开 X.509 代码签名证书路径；被编入壳，不是私钥 |
| `SHENNIAN_OTA_KEY_ID=main` | 公钥标识，发布器必须相同 |
| `SHENNIAN_OTA_CHANNEL=preview` | 企业渠道，与发布器相同；正式渠道通常 production |

从当前混合工程构建时，还需明确企业 App 名称、bundleIdentifier / applicationId、原生签名和自有 runtimeVersion，不能冒用官方应用身份；此提交只抽离 OTA，不宣称品牌 / 打包配置已全部独立。每个原生依赖变化、证书轮换或信任源变化都需重新构建正确的原生壳。`expo prebuild` 会改原生项目，必须在自己的受控构建目录操作，检查生成的 iOS Expo.plist / Android 配置后再归档；**只改容器环境变量或 JS 无法修改已安装壳**。使用 release 构建验收，不用 Expo Go 或连接 Metro 的 debug 壳证明 OTA。

## 2. 创建自己的签名材料

在受控构建机（不是分发容器）操作；使用组织自己的密钥保管系统更好：

```sh
umask 077
mkdir -p "$HOME/.config/company-ota"
openssl req -x509 -newkey rsa:3072 -nodes \
  -keyout "$HOME/.config/company-ota/private-key.pem" \
  -out "$HOME/.config/company-ota/certificate.pem" \
  -days 365 -subj '/CN=Company OTA' -addext 'extendedKeyUsage=codeSigning'
```

本例私钥未加密，必须限制文件权限、离线加密备份并隔离 CI 权限；禁止上传 Git、镜像、聊天或普通业务配置接口。证书可公开，私钥不可。实现检查证书用途、有效期、RSA ≥2048 与密钥匹配；证书过期 / 丢失前安排新原生壳轮换，不通过关闭验签应急。

## 3. 企业只读更新服务

在服务器准备专用数据目录与公开证书，目录对容器 UID 1000 可读；私钥不在服务器上：

```sh
export OTA_STORE=/srv/company-ota/data
export OTA_CERTIFICATE=/srv/company-ota/certificate.pem
export OTA_PUBLIC_ORIGIN=https://ota.example.com
cd open-source/deploy/enterprise-ota
# 首次启动前由运维创建 OTA_STORE，并放入企业公开证书。
docker compose up -d --build
# 可先 docker compose build --build-arg NODE_IMAGE=组织审核镜像@sha256:摘要
```

同机反向代理受信 HTTPS `ota.example.com` 到 `127.0.0.1:8098`，保持 `/api/updates`、`/assets/…` 路径，透传 Expo 请求头；不缓存 manifest（资源可长缓存）。容器的 8080 是内部 HTTP，不得直接暴露到公网。此 compose 不自动申请 TLS、开防火墙或复用业务账号密码。可用企业 VPN / 网络 ACL 限制读取，但不要在 URL 或客户端内嵌长期管理密钥。资源默认可读，**代码签名保证完整性，不保证包内容保密**。

服务只有 GET `/api/updates`、GET `/assets/<id>/<hash>` 和 `/healthz`。没有上传、后台登录或发布 API。运行用户不得写分发目录；`OTA_PUBLIC_ORIGIN` 必须与签名资源 URL 相同。镜像使用 Node 22，正式部署应固定组织审核的基础镜像 digest，并完成依赖 / 镜像安全审计。

## 4. 导出、签名候选、验证、激活

在受控构建机固定源码提交、依赖和原生 runtime，使用**相同企业构建变量**运行 Expo export：

```sh
cd packages/app
# 平台分别导出；输出是本次候选专用目录，不复用旧目录。
pnpm exec expo export --platform ios --output-dir /secure/ota-export-ios
```

为 manifest 准备仅包含可公开运行元数据的 JSON，例如 `{"expoClient":{"extra":{"controlSurface":"mobile"}}}`；按实际企业 App 公共配置补齐，不放任何模型 / 上传 / 签名密钥。发布工具不自动读取官方 app.json，不连接官方 OSS，不自动加载私有环境文件。

```sh
export OTA_STORE=/secure/ota-store
export OTA_PUBLIC_ORIGIN=https://ota.example.com
export OTA_CERTIFICATE="$HOME/.config/company-ota/certificate.pem"
export OTA_PRIVATE_KEY_FILE="$HOME/.config/company-ota/private-key.pem"
export OTA_CHANNEL=preview
export OTA_KEY_ID=main
node open-source/deploy/enterprise-ota/cli.mjs publish \
  /secure/ota-export-ios ios company-runtime-1 /secure/public-extra.json
# 输出 candidate UUID，activated=false；先记录源码、runtime、平台、证书指纹、资源摘要。
node open-source/deploy/enterprise-ota/cli.mjs promote CANDIDATE_UUID none
# 已有渠道时，将 none 替换为当前基线 UUID；基线不符则拒绝，不能盲目覆盖。
```

签名机到服务器的传输使用组织已有受控部署通道：**先**上传 `updates/<UUID>/` 完整不可变目录，**再**原子替换对应的 `channels/<channel>/<runtime>/<platform>.json`。不要将半写的 manifest 或 pointer 暴露给客户端。可在隔离分发目录先同步全部内容再原子切换服务挂载目录；本工具不提供跨主机事务 / SSH 凭据 / 自动远程上传。目录内没有私钥，但仍不要对外开放目录索引。备份保留不可变更新和渠道指针；私钥必须单独备份。

先在企业 preview 壳完成真实验收。正式渠道需用同一冻结导出重新签名 production 候选并记录两者资源 hash 一致，再显式激活；不能将 preview 指针直接移到 production，因为签名 manifest 内也记录渠道。Android 单独生成和验收；不复制官方历史 runtime 兼容特例。

## 5. 失败、撤回与回退

- 错误签名、被篡改资源、错误 runtime / 平台 / 渠道不能被当成有效更新；服务也会拒绝无效签名 / 资源。客户端最终验签和恢复由原生 expo-updates 执行，必须真实 release 壳验证。
- 关闭新更新分发只影响未来检查，不会自动撤回已经缓存或运行的代码。**仅移回旧指针不保证回退**：客户端通常选择较新的已缓存更新。回退应将经过验证的旧代码重新签成时间更新的新候选，按原渠道和 runtime 发布；不可回退的原生变化需发新壳。本实现不提供 rollback-to-embedded 指令。
- 初始候选和每次激活保存源码提交、平台 / runtime / 渠道、UUID、证书指纹、基线 UUID、测试证据及回退方案。本地激活带锁、比较基线并拒绝旧时间，不能替代组织 CI 审批和跨主机发布锁。
- 网络失败、错误证书、签名篡改、资源损坏、冷启动、离线缓存、回退与原生运行时不匹配都列入上线前验收。当前提交只完成配置 / 协议处理 / 密码学与发布工具测试，不承诺这些原生行为已验证。

参考：[Expo Updates v1](https://docs.expo.dev/technical-specs/expo-updates-1/)、[Expo 代码签名](https://docs.expo.dev/eas-update/code-signing/)。运行 `node --test open-source/deploy/enterprise-ota/ota.test.mjs` 或公共根的 `pnpm test:deploy` 验证工具；不需要业务 Server 或任何真实 Agent。
