from fastapi import APIRouter, HTTPException
from config.logging_config import get_auth_logger

logger = get_auth_logger()

router = APIRouter(prefix="/auth", tags=["authentication"])


def _deprecated() -> None:
    logger.warning(
        "FastAPI auth endpoint invoked, but OAuth is now handled by the TypeScript service."
    )
    raise HTTPException(
        status_code=410,
        detail="Auth routes moved to the Hono service. Use the /auth endpoints exposed by the edge API.",
    )


@router.get("/login")
def login():
    _deprecated()


@router.get("/callback")
def callback():
    _deprecated()
