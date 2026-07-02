# syntax=docker/dockerfile:1.7
FROM node:24-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts

FROM deps AS build
RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates curl unzip \
    && rm -rf /var/lib/apt/lists/*
COPY . .
RUN npm run typecheck && npm run test:ci && npm run build

FROM node:24-slim AS prod-deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force

FROM node:24-slim AS runtime
ENV NODE_ENV=production \
    JOBBOT_STATIC_DIR=/app/dist \
    JOBBOT_WEB_PORT=8080
WORKDIR /app
COPY package.json ./
COPY --from=prod-deps /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/scripts/static-server.js ./scripts/static-server.js
EXPOSE 8080
USER node
CMD ["node", "scripts/static-server.js"]
