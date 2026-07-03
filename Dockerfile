# syntax=docker/dockerfile:1.7
FROM node:20-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts

FROM deps AS build
ARG GITHUB_SHA
ARG JOBBOT_GIT_SHA
ARG SOURCE_DATE_EPOCH
ENV GITHUB_SHA=$GITHUB_SHA \
    JOBBOT_GIT_SHA=$JOBBOT_GIT_SHA \
    SOURCE_DATE_EPOCH=$SOURCE_DATE_EPOCH
COPY tsconfig.json ./
COPY scripts/build-static.js ./scripts/build-static.js
COPY src ./src
COPY test ./test
RUN npm run typecheck && npm run build

FROM node:20-slim AS prod-deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force

FROM node:20-slim AS runtime
ENV NODE_ENV=production \
    JOBBOT_STATIC_DIR=/app/dist \
    JOBBOT_WEB_PORT=8080
WORKDIR /app
COPY package.json ./
COPY --from=prod-deps /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY scripts/static-server.js ./scripts/static-server.js
EXPOSE 8080
USER node
CMD ["node", "scripts/static-server.js"]
