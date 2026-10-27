# @arch open-source/docs/enterprise-ota.md
ARG NODE_IMAGE=node:22-alpine
FROM ${NODE_IMAGE}
WORKDIR /app
COPY store.mjs server.mjs ./
USER node
EXPOSE 8080
CMD ["node", "server.mjs"]
