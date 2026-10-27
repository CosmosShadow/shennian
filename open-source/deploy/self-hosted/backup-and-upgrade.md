# 备份、恢复与升级

备份必须覆盖数据库、附件、Redis 状态、部署配置 / 证书及每台 Client 的本地文件。只有 Server 数据库不够。以下是经过 QA host 单实例演练的操作边界，不是全自动生产灾备工具；容器服务名和目录需由管理员按自己的部署确认。

## 备份范围与一致性

1. 记录 Compose 文件、镜像 ID / 版本、实例 ID、正式 migration 名称与校验和；确认回退镜像仍可取得。不要仅记录可移动的 `latest` 标签。
2. 在维护窗口暂停本实例 Server、Worker、Client 写入；记录原来运行的服务，失败也应恢复原服务。数据库保持可用，使用 `mariadb-dump --single-transaction --routines --triggers --events --hex-blob --databases ...` 导出业务数据库。数据库密码只从容器私有环境读取，不拼到命令参数或日志。若包含非事务表或外部写入者，需另行锁定写入，不能宣称单事务全局一致。
3. 写入者停止后执行 Redis SAVE，再停止 Redis，复制完整 Redis 持久目录（包括 AOF manifest / 分段和 RDB），不能只复制某个正在改写的 AOF 文件。
4. 复制附件目录、Compose / 代理配置、私有运行配置、证书、Client HOME 与工作空间；排除运行时 socket，不跟随符号链接、不复制 Docker socket。不把整台宿主机、其他用户 HOME 或旧产品目录打包。
5. 清单记录逐文件 SHA-256、大小、权限、owner 与镜像 ID，以及数据库各表行数、已完成 migration 名称 / checksum。数据库 dump、附件和文件快照必须属于同一个暂停写入窗口。
6. 完成快照后恢复原服务，再加密归档。临时明文只放权限 `0700` 的本地目录，完成或失败后精确清理自己的临时文件；日志权限 `0600`，不打印内容。文件删除不等于介质级安全擦除。

## 加密归档工具

本目录 `backup-archive.mjs` 只做 AES-256-GCM 加密 / 认证解密，**不采集文件、不解包、不启动容器，也不替代完整备份脚本**。要求 Node.js 与本地可信文件系统。管理员在备份目录外生成并单独保管 32 字节随机二进制 Key，权限 `0600`；Key 丢失无法恢复，Key 和归档同处泄露则失去保密性。

```sh
# 目录先由管理员建好，权限 0700。不要把 key 放进待备份目录。
(umask 077; openssl rand 32 > /protected-key-dir/backup.key)
node backup-archive.mjs seal /protected-staging/snapshot.tar /backups/snapshot.shnbackup /protected-key-dir/backup.key
node backup-archive.mjs open /backups/snapshot.shnbackup /protected-staging/verified.tar /protected-key-dir/backup.key
node --test backup-archive.test.mjs
```

不要对已有 Key 重复执行生成命令；示例中的目录须替换为自己的受限目录。输入须为普通文件，输出必须不存在。工具验证 GCM tag 后才发布解密输出；失败会删除临时输出。认证完成前受限目录内可能存在权限 `0600` 的明文 partial 文件，不应让其他进程读取。Key 不通过 argv 传值，命令行只传路径。输出只报告模式和字节数，不打印归档内容或密钥。

当前格式：`SHNBACK1`、12 字节随机 nonce、密文、16 字节认证 tag；magic 参与 AAD。完整性验证不能代替备份源的可信性、目录权限和异地备份。此工具尚未经过外部密码学审计。

## 隔离恢复，禁止覆盖运行实例

1. 校验归档校验和；认证解密到受限目录。解包前逐项拒绝绝对路径、`..`、重复路径、symlink / hardlink 和特殊设备，只允许普通文件 / 目录。**不要直接对未知归档执行 root tar 解压。**
2. 只恢复到全新空目录 / 卷，逐文件验证 hash 与大小，恢复预期权限和 uid / gid。不覆盖原实例，不复用原数据库卷。
3. 使用匹配的数据库版本、表名大小写和字符集，在无网络 / 无宿主端口的独立容器导入 SQL。核对所有表的行数、迁移记录 / checksum 与约束触发器；另外检查 Redis 持久数据可载入。
4. 不启动复制出来的 Client；同一配对身份同时上线可能互相争用。完整切灾备必须先停止旧实例与旧 Client，再核对 URL、TLS、身份和单活动实例规则。
5. 记录恢复用时、失败步骤和范围，完成后只清理本轮 scratch 容器 / 卷 / 明文目录，保留加密归档与单独保管的 Key。归档不包含镜像时，必须另行保存或可靠获取清单中的镜像，不能称为离线自包含恢复包。

## 升级与回退

- 先完成可恢复备份，再固定候选镜像 ID，验证独立运行清单与 CPU 架构；不在小内存业务机上边编译边升级。
- 停止本实例写入服务，在**独立一次性容器**执行正式 `prisma migrate deploy`，失败不继续启动候选。不要在常驻 Server 容器里同时运行重内存的 migration 子进程。
- 启动 Server / Worker，readiness 通过后启动 Client；核对账号、设备配对、成员权限、附件、历史和真实模型回复，不只检查 Docker `running`。
- 回退只适用于已确认兼容的 schema 与数据格式；不要自动 drop 新表或重写迁移记录。若迁移不可逆，须单独制定停写恢复方案，不能把切旧镜像当作数据库降级。
- 保留旧 Compose 与镜像。回退检查通过后可再次启动同一候选，并验证账号、持久卷与历史未变。当前演练只覆盖一对候选，不代表任意跨版本升级或降级兼容。

功能与平台的精确状态见[验收矩阵](../../docs/self-hosted-acceptance.md)。
