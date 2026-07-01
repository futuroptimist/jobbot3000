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

FROM nginx:1.27-alpine AS runtime
LABEL org.opencontainers.image.title="jobbot3000" \
      org.opencontainers.image.description="Browser-only jobbot3000 static application tracker" \
      org.opencontainers.image.licenses="MIT"
COPY <<'EOF_NGINX' /etc/nginx/conf.d/default.conf
server {
  listen 8080;
  listen [::]:8080;
  server_name _;
  root /usr/share/nginx/html;
  index index.html;

  server_tokens off;

  add_header Content-Security-Policy "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; font-src 'self'; connect-src 'self'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'; object-src 'none'" always;
  add_header Permissions-Policy "accelerometer=(), autoplay=(), camera=(), geolocation=(), gyroscope=(), microphone=(), payment=(), usb=()" always;
  add_header Referrer-Policy "strict-origin-when-cross-origin" always;
  add_header X-Content-Type-Options "nosniff" always;
  add_header Cross-Origin-Opener-Policy "same-origin" always;

  location = /healthz {
    default_type application/json;
    add_header Cache-Control "no-store" always;
    return 200 '{"status":"ok","mode":"static","persistence":"browser-indexeddb"}';
  }

  location = /livez {
    default_type application/json;
    add_header Cache-Control "no-store" always;
    return 200 '{"status":"ok","mode":"static","persistence":"browser-indexeddb"}';
  }

  location = / {
    add_header Cache-Control "no-store" always;
    try_files /index.html =404;
  }

  location = /index.html {
    add_header Cache-Control "no-store" always;
    try_files $uri =404;
  }

  location = /tracker {
    add_header Cache-Control "no-store" always;
    try_files /tracker.html =404;
  }

  location = /tracker.html {
    add_header Cache-Control "no-store" always;
    try_files $uri =404;
  }

  location = /manifest.webmanifest {
    add_header Cache-Control "no-store" always;
    try_files $uri =404;
  }

  location / {
    try_files $uri $uri/ /404.html;
  }
}
EOF_NGINX
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 8080
