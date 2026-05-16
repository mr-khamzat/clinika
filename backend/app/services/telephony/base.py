"""TelephonyProvider — pluggable интерфейс. Реальные provider'ы — отдельные модули."""
from abc import ABC, abstractmethod
from dataclasses import dataclass


@dataclass
class CallInitiateResult:
    success: bool
    provider_call_id: str | None = None
    error: str | None = None


@dataclass
class CallStatusResult:
    status: str  # 'ringing'|'answered'|'completed'|'failed'|'unknown'
    duration_sec: int | None = None
    recording_url: str | None = None


class TelephonyProvider(ABC):
    @abstractmethod
    async def initiate_call(self, *, from_user_phone: str, to_number: str) -> CallInitiateResult: ...

    @abstractmethod
    async def get_call_status(self, provider_call_id: str) -> CallStatusResult: ...

    @abstractmethod
    async def fetch_recording(self, provider_call_id: str) -> bytes | None: ...

    @abstractmethod
    async def handle_incoming_webhook(self, payload: dict) -> dict: ...
