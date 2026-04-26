# GitHub Secrets для CI/CD

Добавить в Settings → Secrets and variables → Actions → New repository secret:

| Secret | Значение |
|--------|---------|
| SERVER_HOST | 212.57.118.126 |
| SERVER_USER | root |
| SERVER_PASSWORD | (пароль сервера) |

## Как добавить

1. Перейти в репозиторий на GitHub
2. Settings → Secrets and variables → Actions
3. Нажать "New repository secret"
4. Добавить каждый секрет из таблицы выше

## Как работает pipeline

- **Lint** — запускается при каждом push/PR, проверяет код ruff (ошибки не блокируют деплой)
- **Deploy** — запускается только при push в ветку main
  - Пересобирает только изменившиеся сервисы (backend / frontend / bot / docker-proxy)
  - В конце выводит `docker compose ps` для проверки здоровья контейнеров
