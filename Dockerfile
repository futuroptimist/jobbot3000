# syntax=docker/dockerfile:1.7
FROM node:20-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts

FROM deps AS build
COPY tsconfig.json ./
COPY src ./src
COPY scripts ./scripts
RUN npm run typecheck && npm run build

FROM node:20-slim AS runtime
ENV NODE_ENV=production \
    JOBBOT_STATIC_DIR=/app/dist \
    JOBBOT_WEB_PORT=8080 \
    JOBBOT_WEB_HEALTH_URL=http://127.0.0.1:8080/healthz
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force
COPY --from=build /app/dist ./dist
COPY --from=build /app/scripts/static-server.js ./scripts/static-server.js
COPY --from=build /app/scripts/docker-healthcheck.js ./scripts/docker-healthcheck.js
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node scripts/docker-healthcheck.js
USER node
CMD ["node", "scripts/static-server.js"]
