"""Tenant chat settings — defaults + merge."""
import pytest
from unittest.mock import MagicMock


@pytest.mark.asyncio
async def test_get_chat_settings_returns_defaults():
    from app.routers.tenant_settings import _get_chat_settings_dict
    tenant = MagicMock(settings={})
    out = _get_chat_settings_dict(tenant)
    assert out["chat_sla_enabled"] is False
    assert out["chat_sla_minutes_reg"] == 15
    assert out["chat_autoclose_days"] == 7


@pytest.mark.asyncio
async def test_patch_chat_settings_merges():
    from app.routers.tenant_settings import _merge_chat_settings
    tenant = MagicMock(settings={"chat_sla_enabled": False, "chat_sla_minutes_reg": 15})
    merged = _merge_chat_settings(tenant, {"chat_sla_enabled": True, "chat_sla_minutes_reg": 10})
    assert merged["chat_sla_enabled"] is True
    assert merged["chat_sla_minutes_reg"] == 10
    assert merged.get("chat_sla_minutes_manager") in (None, 30)
