"""
JWT authentication dependency for FastAPI routes.
Validates tokens signed by core-api using VOICE_ENGINE_SECRET (HS256).
"""
import logging
from typing import Optional

import jwt
from fastapi import Depends, HTTPException, Request, WebSocket
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from config.settings import settings

logger = logging.getLogger(__name__)

_bearer_scheme = HTTPBearer(auto_error=False)

EXPECTED_ISSUER = "urn:contigo:core-api"
EXPECTED_AUDIENCE = "urn:contigo:voice-engine"


def _decode_token(token: str) -> dict:
    """Decode and validate a JWT token. Raises HTTPException on failure."""
    secret = settings.VOICE_ENGINE_SECRET
    if not secret:
        logger.error("VOICE_ENGINE_SECRET is not configured — cannot validate tokens")
        raise HTTPException(status_code=500, detail="Authentication not configured")

    try:
        payload = jwt.decode(
            token,
            secret,
            algorithms=["HS256"],
            issuer=EXPECTED_ISSUER,
            audience=EXPECTED_AUDIENCE,
        )
        return payload
    except jwt.ExpiredSignatureError:
        raise HTTPException(status_code=401, detail="Token has expired")
    except jwt.InvalidTokenError:
        raise HTTPException(status_code=401, detail="Invalid token")


async def require_auth(
    credentials: Optional[HTTPAuthorizationCredentials] = Depends(_bearer_scheme),
) -> str:
    """FastAPI dependency that extracts and validates JWT, returns user_id (sub claim)."""
    if credentials is None:
        raise HTTPException(status_code=401, detail="Authorization header required")

    payload = _decode_token(credentials.credentials)
    user_id = payload.get("sub")
    if not user_id:
        raise HTTPException(status_code=401, detail="Token missing subject")
    return user_id


def validate_ws_token(token: str) -> str:
    """Validate a JWT for WebSocket connections. Returns user_id or raises ValueError."""
    secret = settings.VOICE_ENGINE_SECRET
    if not secret:
        raise ValueError("VOICE_ENGINE_SECRET not configured")

    try:
        payload = jwt.decode(
            token,
            secret,
            algorithms=["HS256"],
            issuer=EXPECTED_ISSUER,
            audience=EXPECTED_AUDIENCE,
        )
    except jwt.ExpiredSignatureError:
        raise ValueError("Token has expired")
    except jwt.InvalidTokenError:
        raise ValueError("Invalid token")

    user_id = payload.get("sub")
    if not user_id:
        raise ValueError("Token missing subject")
    return user_id
