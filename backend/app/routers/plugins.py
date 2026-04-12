"""
Роутер плагинов: /plugins/*
Список всех плагинов + health-check каждого.
Доступен только менеджеру.
"""
from fastapi import APIRouter, Depends
from pydantic import BaseModel
from app.core.deps import require_manager
from app.plugins.registry import plugin_registry

router = APIRouter(prefix="/plugins", tags=["plugins"])


class PluginInfo(BaseModel):
    name: str
    display_name: str
    description: str
    enabled: bool


class PluginHealth(BaseModel):
    name: str
    ok: bool
    detail: str


@router.get("", response_model=list[PluginInfo])
async def list_plugins(_=Depends(require_manager)):
    """Список всех зарегистрированных плагинов и их статус."""
    result = []
    for plugin in plugin_registry.all():
        enabled = await plugin.is_enabled()
        result.append(PluginInfo(
            name=plugin.name,
            display_name=plugin.display_name,
            description=plugin.description,
            enabled=enabled,
        ))
    return result


@router.get("/{name}/health", response_model=PluginHealth)
async def plugin_health(name: str, _=Depends(require_manager)):
    """Health-check конкретного плагина."""
    plugin = plugin_registry.get(name)
    if plugin is None:
        return PluginHealth(name=name, ok=False, detail="Плагин не найден")
    result = await plugin.health_check()
    return PluginHealth(
        name=name,
        ok=result.get("ok", False),
        detail=result.get("detail", ""),
    )
