# syntax=docker/dockerfile:1.7
FROM node:20-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM deps AS build
COPY src ./src
COPY scripts ./scripts
RUN npm run build

FROM node:20-slim AS runtime
ENV NODE_ENV=production \
    JOBBOT_STATIC_DIR=/app/dist \
    JOBBOT_WEB_PORT=3000
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=build /app/dist ./dist
COPY scripts/static-server.js ./scripts/static-server.js
EXPOSE 3000
USER node
CMD ["node", "scripts/static-server.js"]
