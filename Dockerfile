# syntax=docker/dockerfile:1.7
FROM node:20-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts

FROM deps AS build
COPY src ./src
COPY scripts ./scripts
RUN npm run test:ci
RUN npm run build

FROM node:20-slim AS runtime
ENV NODE_ENV=production \
    JOBBOT_STATIC_DIR=/app/dist \
    JOBBOT_WEB_PORT=8080 \
    PORT=8080
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force
COPY --from=build /app/dist ./dist
COPY --from=build /app/scripts/static-server.js ./scripts/static-server.js
EXPOSE 8080
USER node
CMD ["node", "scripts/static-server.js"]
