"""
OPUS-MT Translation Service

Uses Helsinki-NLP OPUS-MT models for direct, literal translation.
No LLM reasoning or rephrasing - just fast neural machine translation.

Model: Helsinki-NLP/opus-mt-es-en (~300MB, suitable for laptop)
Caching: Redis-based cache for repeated translations
"""
import logging
import asyncio
import hashlib
from typing import Optional

import redis

from config.settings import settings

logger = logging.getLogger(__name__)

# Model and tokenizer are loaded lazily on first use
_model = None
_tokenizer = None
_model_lock = asyncio.Lock()

# Redis client for translation cache
_redis_client = None
TRANSLATION_CACHE_TTL_DAYS = 30
TRANSLATION_CACHE_PREFIX = "tr:es:en:"


def _get_redis_client():
    """Get or create Redis client for translation cache."""
    global _redis_client
    if _redis_client is None:
        try:
            _redis_client = redis.from_url(settings.REDIS_URL, decode_responses=True)
            _redis_client.ping()
            logger.info("Translation cache connected to Redis")
        except Exception as e:
            logger.warning(f"Translation cache Redis unavailable: {e}")
            _redis_client = False  # Mark as failed, don't retry
    return _redis_client if _redis_client else None


def _cache_key(text: str) -> str:
    """Generate cache key for translation."""
    text_hash = hashlib.sha256(text.encode("utf-8")).hexdigest()[:16]
    return f"{TRANSLATION_CACHE_PREFIX}{text_hash}"


def _get_cached_translation(text: str) -> Optional[str]:
    """Look up translation in Redis cache."""
    client = _get_redis_client()
    if not client:
        return None
    try:
        return client.get(_cache_key(text))
    except Exception as e:
        logger.debug(f"Translation cache read error: {e}")
        return None


def _set_cached_translation(text: str, translation: str) -> None:
    """Store translation in Redis cache."""
    client = _get_redis_client()
    if not client:
        return
    try:
        client.setex(
            _cache_key(text),
            TRANSLATION_CACHE_TTL_DAYS * 24 * 3600,
            translation
        )
    except Exception as e:
        logger.debug(f"Translation cache write error: {e}")


def _load_model():
    """Load the OPUS-MT model (called once, cached)."""
    global _model, _tokenizer

    if _model is not None:
        return _model, _tokenizer

    try:
        from transformers import MarianMTModel, MarianTokenizer

        model_name = "Helsinki-NLP/opus-mt-es-en"
        logger.info(f"Loading translation model: {model_name}")

        _tokenizer = MarianTokenizer.from_pretrained(model_name)
        _model = MarianMTModel.from_pretrained(model_name)

        logger.info("OPUS-MT translation model loaded successfully")
        return _model, _tokenizer

    except ImportError as e:
        logger.error(
            "transformers library not installed. "
            "Run: pip install transformers sentencepiece"
        )
        raise RuntimeError("Translation model dependencies not installed") from e
    except Exception as e:
        logger.error(f"Failed to load translation model: {e}")
        raise RuntimeError(f"Failed to load translation model: {e}") from e


def translate_sync(text: str, use_cache: bool = True) -> str:
    """
    Synchronous translation from Spanish to English.

    Uses Helsinki-NLP OPUS-MT for direct neural machine translation.
    No LLM, no reasoning, no rephrasing - just literal translation.

    Args:
        text: Spanish text to translate
        use_cache: Whether to use Redis cache (default: True)

    Returns:
        English translation (literal, direct)
    """
    cleaned = (text or "").strip()
    if not cleaned:
        return ""

    # Check cache first
    if use_cache:
        cached = _get_cached_translation(cleaned)
        if cached:
            logger.debug(f"Translation cache hit: {cleaned[:30]}...")
            return cached

    model, tokenizer = _load_model()

    # Tokenize and translate
    inputs = tokenizer(cleaned, return_tensors="pt", padding=True, truncation=True, max_length=512)
    translated = model.generate(**inputs)
    result = tokenizer.decode(translated[0], skip_special_tokens=True).strip()

    # Store in cache
    if use_cache and result:
        _set_cached_translation(cleaned, result)

    return result


async def translate_async(text: str) -> str:
    """
    Async wrapper for translation (runs sync translation in thread pool).

    Args:
        text: Spanish text to translate

    Returns:
        English translation (literal, direct)
    """
    cleaned = (text or "").strip()
    if not cleaned:
        return ""

    # Ensure model is loaded (with lock to prevent concurrent loading)
    async with _model_lock:
        if _model is None:
            # Run the blocking load in a thread pool
            loop = asyncio.get_event_loop()
            await loop.run_in_executor(None, _load_model)

    # Run translation in thread pool to avoid blocking
    loop = asyncio.get_event_loop()
    result = await loop.run_in_executor(None, translate_sync, text)
    return result


class OpusTranslationService:
    """
    Service class for OPUS-MT translation.

    Provides direct, literal Spanish-to-English translation using
    Helsinki-NLP/opus-mt-es-en neural machine translation model.

    Model details:
    - Size: ~300MB (suitable for laptop)
    - Architecture: MarianMT (based on Marian NMT)
    - No GPU required, runs on CPU
    - Fast inference (~100-500ms per sentence)
    """

    def __init__(self):
        self._initialized = False

    async def initialize(self) -> None:
        """Pre-load the model (optional, will lazy-load on first translation)."""
        if self._initialized:
            return

        async with _model_lock:
            if _model is None:
                loop = asyncio.get_event_loop()
                await loop.run_in_executor(None, _load_model)

        self._initialized = True
        logger.info("OpusTranslationService initialized")

    async def translate(
        self,
        text: str,
        target_language: str = "en",
        source_language: str = "es",
    ) -> str:
        """
        Translate text from Spanish to English.

        Args:
            text: Text to translate
            target_language: Target language (only 'en' supported)
            source_language: Source language (only 'es' supported)

        Returns:
            Translated text (literal, direct translation)

        Raises:
            ValueError: If unsupported language pair requested
            RuntimeError: If model fails to load
        """
        # Validate language pair (only es->en supported with this model)
        src = (source_language or "es").lower()
        tgt = (target_language or "en").lower()

        if src != "es" or tgt != "en":
            raise ValueError(
                f"Unsupported language pair: {src}->{tgt}. "
                "Only Spanish to English (es->en) is supported."
            )

        return await translate_async(text)

    def is_model_loaded(self) -> bool:
        """Check if the translation model is currently loaded."""
        return _model is not None

    def is_cache_available(self) -> bool:
        """Check if Redis cache is available."""
        client = _get_redis_client()
        return client is not None

    def get_cache_stats(self) -> dict:
        """Get translation cache statistics."""
        client = _get_redis_client()
        if not client:
            return {"available": False, "cached_translations": 0}

        try:
            # Count keys with our prefix
            keys = client.keys(f"{TRANSLATION_CACHE_PREFIX}*")
            return {
                "available": True,
                "cached_translations": len(keys),
                "ttl_days": TRANSLATION_CACHE_TTL_DAYS,
            }
        except Exception as e:
            logger.warning(f"Failed to get cache stats: {e}")
            return {"available": False, "error": str(e)}

    def clear_cache(self) -> int:
        """Clear all cached translations. Returns number of keys deleted."""
        client = _get_redis_client()
        if not client:
            return 0

        try:
            keys = client.keys(f"{TRANSLATION_CACHE_PREFIX}*")
            if keys:
                deleted = client.delete(*keys)
                logger.info(f"Cleared {deleted} cached translations")
                return deleted
            return 0
        except Exception as e:
            logger.error(f"Failed to clear cache: {e}")
            return 0


# Singleton instance
opus_translation_service = OpusTranslationService()
