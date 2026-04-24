"""
Структурированное логирование через structlog.
Формат: JSON в production, цветной консольный в dev.
"""
import logging
import sys
import structlog


def setup_logging(json_logs: bool = True) -> None:
    """Инициализировать structlog. Вызывать один раз при старте приложения."""
    shared_processors = [
        structlog.contextvars.merge_contextvars,
        structlog.stdlib.add_logger_name,
        structlog.stdlib.add_log_level,
        structlog.stdlib.PositionalArgumentsFormatter(),
        structlog.processors.TimeStamper(fmt="iso"),
        structlog.processors.StackInfoRenderer(),
    ]

    if json_logs:
        # Production: JSON для log aggregation (ELK, Loki, CloudWatch)
        processors = shared_processors + [
            structlog.processors.dict_tracebacks,
            structlog.processors.JSONRenderer(),
        ]
    else:
        # Development: читаемый цветной вывод
        processors = shared_processors + [
            structlog.dev.ConsoleRenderer(colors=True),
        ]

    structlog.configure(
        processors=processors,
        wrapper_class=structlog.stdlib.BoundLogger,
        context_class=dict,
        logger_factory=structlog.stdlib.LoggerFactory(),
        cache_logger_on_first_use=True,
    )

    # Настраиваем стандартный logging для перехвата uvicorn/sqlalchemy
    logging.basicConfig(
        format="%(message)s",
        stream=sys.stdout,
        level=logging.INFO,
    )
    for noisy in ("sqlalchemy.engine", "httpx", "httpcore"):
        logging.getLogger(noisy).setLevel(logging.WARNING)


def get_logger(name: str):
    """Получить structlog logger для модуля."""
    return structlog.get_logger(name)
