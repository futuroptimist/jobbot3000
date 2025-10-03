# syntax=docker/dockerfile:1.7
FROM node:20-slim AS base
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

FROM node:20-slim AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY --from=base /app/node_modules ./node_modules
COPY package.json package-lock.json ./
COPY bin ./bin
COPY src ./src
COPY scripts ./scripts
COPY docs ./docs
RUN mkdir -p /data && chown node:node /data
EXPOSE 3000
VOLUME ["/data"]
USER node
CMD ["node", "scripts/web-server.js", "--env", "production", "--host", "0.0.0.0"]
