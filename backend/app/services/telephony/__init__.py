"""Telephony service package — pluggable provider-абстракция."""
from .base import TelephonyProvider, CallInitiateResult, CallStatusResult  # noqa: F401
from .null import NullProvider  # noqa: F401
from .factory import get_provider  # noqa: F401
