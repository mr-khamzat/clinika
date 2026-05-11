FROM python:3.11-slim
WORKDIR /app
# Системные зависимости:
#   gcc, libpq-dev — для psycopg2/asyncpg сборки
#   weasyprint и его зависимости (pango, gdk-pixbuf, fontconfig) — для генерации PDF актов
RUN apt-get update && apt-get install -y \
        gcc libpq-dev curl ca-certificates \
        libpango-1.0-0 libpangoft2-1.0-0 libharfbuzz0b libcairo2 \
        libgdk-pixbuf-2.0-0 libffi-dev shared-mime-info fonts-dejavu \
    && rm -rf /var/lib/apt/lists/*
COPY requirements.txt requirements-dev.txt ./
RUN pip install --no-cache-dir -r requirements.txt \
    && pip install --no-cache-dir -r requirements-dev.txt
COPY . .
# Запуск: сначала миграции Alembic, затем приложение
CMD ["sh", "-c", "alembic upgrade heads && uvicorn app.main:app --host 0.0.0.0 --port 8000 --proxy-headers --forwarded-allow-ips=*"]
