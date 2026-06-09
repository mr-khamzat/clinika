FROM node:20-alpine AS builder
WORKDIR /app

ARG VITE_SENTRY_DSN=""
ARG VITE_SENTRY_ENVIRONMENT="production"
ENV VITE_SENTRY_DSN=$VITE_SENTRY_DSN
ENV VITE_SENTRY_ENVIRONMENT=$VITE_SENTRY_ENVIRONMENT

# idx 55: npm ci + lockfile — детерминированная сборка из точных версий package-lock.json
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
ENV NODE_OPTIONS=--max-old-space-size=6144
RUN npm run build

# Pre-gzip ассеты для nginx gzip_static — отдаются без CPU-расходов.
# Шаг ОПЦИОНАЛЬНЫЙ: если apk не достанет gzip (alpine repo недоступен), nginx будет жать на лету.
RUN (apk add --no-cache gzip 2>/dev/null && \
     find /app/dist -type f \( -name '*.js' -o -name '*.css' -o -name '*.woff2' -o -name '*.svg' -o -name '*.json' -o -name '*.html' -o -name '*.map' \) -size +512c \
       -exec sh -c 'gzip -kf9 "$1" 2>/dev/null || true' _ {} \; && \
     echo "=== pre-gzipped OK ===") || echo "=== gzip step skipped (nginx will gzip on the fly) ==="
RUN du -sh /app/dist || echo "size step skipped"

FROM nginx:alpine
COPY --from=builder /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
