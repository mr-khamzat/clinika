"""
Docker sidecar proxy — предоставляет read-only доступ к Docker API
для monitoring.py без монтирования docker.sock в backend.
Доступен только внутри docker-сети clinika-net.
"""
from fastapi import FastAPI, HTTPException
import docker
import logging

logging.basicConfig(level=logging.INFO)
log = logging.getLogger("docker-proxy")

app = FastAPI(title="Docker Proxy", docs_url=None, redoc_url=None)

ALLOWED_CONTAINERS = {"clinika-backend", "clinika-frontend", "clinika-db", "clinika-redis", "clinika-bot"}

def _client():
    return docker.DockerClient(base_url="unix:///var/run/docker.sock", timeout=10)


@app.get("/containers")
def list_containers():
    """Список запущенных контейнеров."""
    try:
        client = _client()
        result = []
        for c in client.containers.list(all=False):
            health_data = c.attrs.get("State", {}).get("Health", {})
            health = health_data.get("Status", "ok") if health_data else "ok"
            result.append({"name": c.name, "status": c.status, "health": health})
        client.close()
        return {"containers": result}
    except Exception as e:
        log.error(f"list_containers error: {e}")
        return {"containers": [], "error": str(e)}


@app.get("/containers/{name}/status")
def container_status(name: str):
    """Статус конкретного контейнера."""
    if name not in ALLOWED_CONTAINERS:
        raise HTTPException(status_code=400, detail="Недопустимый контейнер")
    try:
        client = _client()
        try:
            c = client.containers.get(name)
            started = c.attrs.get("State", {}).get("StartedAt")
            return {"status": c.status, "running": c.status == "running", "started_at": started}
        except docker.errors.NotFound:
            return {"status": "not_found", "running": False}
        finally:
            client.close()
    except Exception as e:
        return {"status": "unknown", "running": False, "error": str(e)}


@app.get("/containers/{name}/logs")
def container_logs(name: str, lines: int = 100):
    """Последние N строк логов контейнера."""
    if name not in ALLOWED_CONTAINERS:
        raise HTTPException(status_code=400, detail="Недопустимый контейнер")
    if lines > 500:
        lines = 500
    try:
        client = _client()
        c = client.containers.get(name)
        raw = c.logs(tail=lines, timestamps=True).decode("utf-8", errors="replace")
        client.close()
        log_lines = raw.strip().splitlines()
        return {"container": name, "lines": log_lines, "count": len(log_lines)}
    except docker.errors.NotFound:
        return {"container": name, "lines": [f"Контейнер {name} не найден"], "count": 1}
    except Exception as e:
        return {"container": name, "lines": [str(e)], "count": 1}


@app.get("/health")
def health():
    return {"status": "ok"}
