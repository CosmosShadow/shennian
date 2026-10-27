# @arch open-source/docs/system-architecture.md
# Context: pristine build-self-hosted-runtime output in ./runtime/ plus this verifier.
ARG NODE_IMAGE=public.ecr.aws/docker/library/node:24-bookworm-slim@sha256:0e0ff40c39bc087845bfb27465a0df4ea419520094bc35842ff83dd8cbe6f9b6
FROM ${NODE_IMAGE}
ARG DEBIAN_MIRROR=https://deb.debian.org
ARG NPM_REGISTRY=https://registry.npmjs.org
RUN node -e 'const fs=require("fs");fs.mkdirSync("/etc/ssl/certs",{recursive:true});fs.writeFileSync("/etc/ssl/certs/ca-certificates.crt",require("tls").rootCertificates.join("\n"))' \
    && sed -i "s|http://deb.debian.org|${DEBIAN_MIRROR}|g" /etc/apt/sources.list.d/debian.sources \
    && apt-get -o Acquire::Retries=2 -o Acquire::https::Timeout=30 update \
    && apt-get install -y --no-install-recommends openssl ca-certificates \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY --chown=node:node runtime/ /app/
COPY verify-runtime.mjs /opt/shennian/verify-runtime.mjs
RUN node /opt/shennian/verify-runtime.mjs /app \
    && npm install --global --registry="${NPM_REGISTRY}" pnpm@9.15.4 \
    && pnpm install --frozen-lockfile --prod --ignore-scripts --network-concurrency=4 --registry="${NPM_REGISTRY}"
# Only this dependency's reviewed engine download hook is needed for formal migrations.
RUN node --input-type=module -e 'import { createRequire } from "node:module"; import path from "node:path"; import { execFileSync } from "node:child_process"; const server = createRequire(path.resolve("packages/server/package.json")); const prisma = createRequire(server.resolve("prisma/package.json")); const engines = path.dirname(prisma.resolve("@prisma/engines/package.json")); execFileSync(process.execPath, [path.join(engines, "scripts/postinstall.js")], { stdio: "inherit" });'
ENV NODE_ENV=production
USER node
CMD ["node", "packages/server/dist/core-server.js"]
