import asyncio
import os
from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from config.logging_config import get_api_logger

# Environment-based mode: "full" (Docker) or "translation" (local)
VOICE_SERVICE_MODE = os.getenv("VOICE_SERVICE_MODE", "translation")

logger = get_api_logger()

async def _preload_translation_model():
    """Background task to pre-load OPUS translation model (local mode only)."""
    try:
        from services.opus_translation_service import opus_translation_service
        logger.info("Pre-loading OPUS translation model in background...")
        await opus_translation_service.initialize()
        logger.info("OPUS translation model pre-loaded successfully")
    except Exception as exc:
        logger.warning(f"Failed to pre-load translation model: {exc}")

@asynccontextmanager
async def lifespan(app: FastAPI):
    if VOICE_SERVICE_MODE == "full":
        # Docker mode: full service with DB, routes, no local model
        logger.info("Starting Contigo Voice Service (full mode - Docker)...")
        from services.db_service import create_db_and_tables
        try:
            create_db_and_tables()
        except Exception as exc:
            logger.error("Error creating database tables", extra={"error": str(exc)})
        logger.info("Voice service ready for WebSocket connections")
    else:
        # Local mode: translation model only
        logger.info("Starting Contigo Voice Service (translation mode - local)...")
        asyncio.create_task(_preload_translation_model())

    yield
    logger.info("Shutting down...")

app = FastAPI(
    title="Contigo Voice Service",
    description="Full voice service" if VOICE_SERVICE_MODE == "full" else "Translation model only",
    version="0.1.0",
    lifespan=lifespan
)

# CORS - allow requests from Raindrop TypeScript backend
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # TODO: Restrict to Raindrop domain in production
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Include full voice routes in Docker mode
if VOICE_SERVICE_MODE == "full":
    from api.routes import voice
    app.include_router(voice.router)

@app.get("/health")
def health_check():
    """Health check endpoint for monitoring"""
    logger.debug("Health check endpoint accessed")
    return {
        "status": "healthy",
        "service": "contigo-voice" if VOICE_SERVICE_MODE == "full" else "contigo-translation",
        "mode": VOICE_SERVICE_MODE,
        "version": "0.1.0"
    }


# Local dev endpoint for translation (only in translation mode)
if VOICE_SERVICE_MODE == "translation":
    from pydantic import BaseModel
    from typing import Optional

    class TranslationRequest(BaseModel):
        text: str
        target_language: Optional[str] = "en"

    @app.post("/translate")
    async def translate_text(request: TranslationRequest):
        from services.opus_translation_service import opus_translation_service
        translation = await opus_translation_service.translate(
            request.text,
            target_language=request.target_language or "en",
            source_language="es",
        )
        return {"translation": translation, "target_language": request.target_language}
