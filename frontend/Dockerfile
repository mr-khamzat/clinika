FROM node:20-alpine AS builder
WORKDIR /app

# ─── Build ARGs для Vite ──────────────────────────────────────────────────────
# Vite собирает import.meta.env.* во время `npm run build`, поэтому DSN
# должен быть доступен как ENV в этапе билда. Передаются через
# docker compose build --build-arg VITE_SENTRY_DSN=...
ARG VITE_SENTRY_DSN=""
ARG VITE_SENTRY_ENVIRONMENT="production"
ENV VITE_SENTRY_DSN=$VITE_SENTRY_DSN
ENV VITE_SENTRY_ENVIRONMENT=$VITE_SENTRY_ENVIRONMENT

COPY package.json ./
RUN npm install
COPY . .
RUN npm run build

FROM nginx:alpine
COPY --from=builder /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
