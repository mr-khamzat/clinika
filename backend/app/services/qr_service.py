import qrcode
import io
import base64
from app.core.security import sign_qr

def generate_qr_data(referral_id: str) -> str:
    signature = sign_qr(referral_id)
    return f"REF:{referral_id}:{signature}"

def generate_qr_image_base64(referral_id: str) -> str:
    qr_data = generate_qr_data(referral_id)
    qr = qrcode.QRCode(version=1, box_size=10, border=4)
    qr.add_data(qr_data)
    qr.make(fit=True)
    img = qr.make_image(fill_color="black", back_color="white")
    buffer = io.BytesIO()
    img.save(buffer, format="PNG")
    buffer.seek(0)
    return base64.b64encode(buffer.getvalue()).decode()

def generate_url_qr_base64(url: str) -> str:
    """Генерирует QR-код с URL (для пациентского кабинета)."""
    qr = qrcode.QRCode(version=1, box_size=10, border=4)
    qr.add_data(url)
    qr.make(fit=True)
    img = qr.make_image(fill_color="black", back_color="white")
    buffer = io.BytesIO()
    img.save(buffer, format="PNG")
    buffer.seek(0)
    return base64.b64encode(buffer.getvalue()).decode()


def parse_qr_data(qr_string: str) -> tuple[str, str] | None:
    parts = qr_string.strip().split(":")
    if len(parts) != 3 or parts[0] != "REF":
        return None
    return parts[1], parts[2]  # referral_id, signature
