"""PII shadow-sync: SQLAlchemy event listeners для автоматического заполнения
*_encrypted и *_hash колонок при INSERT/UPDATE.

Подключается из app/database.py или main.py на старте.
"""
from sqlalchemy import event

# Карта моделей → списки (src_attr, enc_attr, hash_attr, hash_type)
_MAP = {
    'User': [
        ('phone_number', 'phone_number_encrypted', 'phone_number_hash', 'phone'),
        ('email', 'email_encrypted', 'email_hash', 'email'),
        ('full_name', 'full_name_encrypted', 'full_name_hash', 'text'),
    ],
    'PatientAccount': [
        ('phone', 'phone_encrypted', 'phone_hash', 'phone'),
        ('email', 'email_encrypted', 'email_hash', 'email'),
    ],
    'PatientOTP': [
        ('phone', 'phone_encrypted', 'phone_hash', 'phone'),
    ],
    'SignupRequest': [
        ('phone', 'phone_encrypted', 'phone_hash', 'phone'),
        ('email', 'email_encrypted', 'email_hash', 'email'),
    ],
    'ContactRequest': [
        ('phone', 'phone_encrypted', 'phone_hash', 'phone'),
        ('email', 'email_encrypted', 'email_hash', 'email'),
    ],
    'Appointment': [
        ('patient_phone', 'patient_phone_encrypted', 'patient_phone_hash', 'phone'),
    ],
    'Doctor': [
        ('full_name', 'full_name_encrypted', 'full_name_hash', 'text'),
    ],
}


def install_pii_sync():
    """Подключает event-listeners к моделям. Вызывается один раз при инициализации."""
    from app.services.encryption_service import (
        encrypt, hash_phone, hash_email, hash_text
    )
    HASH_FN = {'phone': hash_phone, 'email': hash_email, 'text': hash_text}

    def _sync(target, mapping):
        for src, enc_col, hash_col, ht in mapping:
            val = getattr(target, src, None)
            if val is None or val == '':
                setattr(target, enc_col, None)
                setattr(target, hash_col, None)
                continue
            setattr(target, enc_col, encrypt(str(val)))
            setattr(target, hash_col, HASH_FN[ht](str(val)))

    # Маппинг имени класса → класс
    from app.models.user import User
    from app.models.patient_account import PatientAccount
    from app.models.patient_account import PatientOTP
    from app.models.signup_request import SignupRequest
    from app.models.contact_request import ContactRequest
    from app.models.doctor import Appointment
    from app.models.doctor import Doctor

    CLASSES = {
        'User': User, 'PatientAccount': PatientAccount, 'PatientOTP': PatientOTP,
        'SignupRequest': SignupRequest, 'ContactRequest': ContactRequest,
        'Appointment': Appointment, 'Doctor': Doctor,
    }

    for cls_name, cls in CLASSES.items():
        mapping = _MAP[cls_name]

        # Замыкание: фиксируем mapping для каждого класса
        def make_handler(m):
            def handler(mapper, connection, target):
                _sync(target, m)
            return handler

        h = make_handler(mapping)
        event.listen(cls, 'before_insert', h)
        event.listen(cls, 'before_update', h)
