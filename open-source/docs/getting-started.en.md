# Installation, builds, and first connection

[简体中文](getting-started.md) · [Feature guide](features.md) · [Docker reference](../deploy/self-hosted/README.md)

## Choose a path

- **Start using Shennian:** use Shennian Cloud with the mobile App and computer Client, without operating a Server.
- **Modify or distribute your own client:** build from source and configure your own signing, provider projects, and update source.
- **Host accounts, messages, and attachments yourself:** deploy a Server and connect App and Client to that same instance.

All paths use the same App/Client implementation. Building agents and local apps does not require self-hosting. Local apps, Client, and the computer must stay online. Model providers receive authorized execution context; HTTPS/WSS is not end-to-end encryption.

## 1. Use Shennian Cloud

1. Download the mobile App for your platform from the [website](https://shennian.net/en/).
2. On the computer running your AI, follow the [installation guide](https://shennian.net/install.md) to install or check Client and Skill. Never paste passwords, model keys, or pairing credentials into public rooms.
3. Select **Shennian Cloud** in the App, confirm your account, and approve pairing with your own computer.
4. Connect one AI tool that is installed, signed in, and capable of a real reply. Add other tools later if needed.
5. Start a conversation or room and create role-based agents. For local-app sharing, try the [feedback form example](examples/feedback-form/README.md).

Visitors can use an existing AI share or room invitation without first installing their own Client. Third-party AI accounts, fees, and quotas follow their providers' rules.

## 2. Build from source

### Prerequisites

| Component | Requirement |
|---|---|
| Node.js | 22.19 or a newer compatible version |
| pnpm | 9.15.4 |
| Complete unit tests | Python 3 as well |
| iOS | macOS, Xcode, and native dependencies |
| Android | Android Studio, Android SDK, and native dependencies |

The computer-side Client/CLI supports macOS, Windows, and Linux. The desktop GUI is not maintained; it is not a required build or release target.

### Install, build, and test

Run from the complete repository root:

```sh
git clone https://github.com/CosmosShadow/shennian.git
cd shennian
pnpm install --frozen-lockfile
pnpm build
pnpm build:app
pnpm test
pnpm test:deploy
```

- `pnpm build`: build Core and type-check the App.
- `pnpm build:app`: generate WebView resources and type-check the App.
- `pnpm test`: run Core and mobile unit tests, not a replacement for device acceptance.
- `pnpm test:deploy`: test deployment, configuration, OTA tools, and app examples.

Choose the native platform you need; building both is not required:

```sh
pnpm ios
# or
pnpm android
```

See the [mobile build guide](mobile-app.md) for native generation, application identities, signing, push, and OTA trust configuration. Official signing keys, model credentials, support-agent credentials, and OTA publishing rights are not included.

## 3. Self-host your Server

### Prepare infrastructure

Prepare a server, Docker/Compose, persistent storage, and a trusted HTTPS domain/reverse proxy. Setting a URL does not configure DNS, certificates, or networking. Do not disable TLS verification or expose database ports publicly.

### Initialize a new instance

From the complete repository root:

```sh
cd open-source
node deploy/self-hosted/init-config.mjs https://your-domain.example
docker compose -f deploy/self-hosted/compose.yaml up -d --build
```

Replace the example domain with your trusted address. The initializer generates independent instance identity, namespace, database credentials, and signing secrets. Registration is invitation-only by default. Compose runs formal migrations before Server/Worker; the API binds locally. The [Docker reference](../deploy/self-hosted/README.md) covers reverse proxies, registration policies, storage, and restricted-network configuration.

**Do not initialize an existing instance again, delete its data volumes, or rewrite applied migrations.** Read [backup, restore, and upgrade instructions](../deploy/self-hosted/backup-and-upgrade.md) before updating.

### Connect App and Client

1. Select **Self-hosted server** on the App login screen and enter the configured HTTPS domain or IP with a trusted certificate, including a custom port if needed.
2. After connection and instance discovery, register or sign in according to the operator's policy.
3. Connect Client to that same instance, confirm the account, pair, and configure your own AI/model.
4. Each installation has one active Server. Do not copy cloud tokens, old pairings, or histories into a company instance. Overwriting an existing binding is not a safe server-switch procedure.

## 4. First acceptance and optional services

Start with one model provider. Send a dedicated test message from your phone and verify a real reply, history, and reopening the conversation. Users decide any required model-processing consent. Then check room access, attachments, and revocation, recording actual results.

Speech, SMS, push, object storage, and enterprise OTA are optional configuration. They are not prerequisites for the basic local-account/pairing flow. Enabling one does not enable all others; never send provider keys to ordinary clients.

## 5. Troubleshooting and deeper guides

| Problem | Check first | Reference |
|---|---|---|
| Cannot connect to Server | DNS, certificate trust, reverse proxy, and WSS; do not disable verification | [Deployment](../deploy/self-hosted/README.md) |
| Cannot register | Closed, invitation-only, or open registration policy; use this instance's administrator-provided channel | [Accounts and initialization](../deploy/self-hosted/README.md) |
| Computer or AI missing | App and Client use the same instance, pairing is complete, and the computer is online | [Connection troubleshooting](https://shennian.net/en/docs#troubleshooting) |
| No AI reply | Tool installation/sign-in, model configuration, authorization, and Client availability | [AI setup](https://shennian.net/en/docs#ai-setup) |
| App loads but cannot submit | Explicit POST allowlist, input validation, and online app/Client | [App playbook](application-examples.md) |
| Upgrade, restore, or own update source | Backups and rollback baseline; business Server selection does not change OTA trust | [Upgrades](../deploy/self-hosted/backup-and-upgrade.md) / [OTA](enterprise-ota.md) |

Consult the [feature guide](features.md) and [acceptance matrix](self-hosted-acceptance.md) for platform, release, and coverage boundaries. SSO is not included in this release.
