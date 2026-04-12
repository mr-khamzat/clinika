#!/bin/bash
set -e
cd /opt/clinika
echo "=== Clinika Update ==="
echo "Текущая версия: $(cat VERSION)"
git pull origin main
echo "Пересборка контейнеров..."
docker compose build clinika-backend clinika-frontend
docker compose up -d clinika-backend clinika-frontend
echo ""
echo "=== Готово! Новая версия: $(cat VERSION) ==="
