from pydantic_settings import BaseSettings
from dotenv import load_dotenv
import os
from typing import Optional

load_dotenv()

class Settings(BaseSettings):
    VULTR_DB_CONNECTION_STRING: str = os.getenv("VULTR_DB_CONNECTION_STRING", "")
    VULTR_DB_SSL_CA: Optional[str] = os.getenv("VULTR_DB_SSL_CA")
    VULTR_DB_SSL_CA_PATH: Optional[str] = os.getenv("VULTR_DB_SSL_CA_PATH")

    REDIS_URL: str = os.getenv("REDIS_URL", "redis://redis:6379/0")
    REDIS_TTL_SECONDS: int = int(os.getenv("REDIS_TTL_SECONDS", "3600"))
    
    GOOGLE_CLIENT_ID: str = os.getenv("GOOGLE_CLIENT_ID", "")
    GOOGLE_CLIENT_SECRET: str = os.getenv("GOOGLE_CLIENT_SECRET", "")
    GOOGLE_REDIRECT_URI: str = os.getenv("GOOGLE_REDIRECT_URI", "http://localhost:8000/auth/callback")

    # SmartInference / Raindrop API (same key for both)
    SMART_INFERENCE_API_KEY: str = os.getenv("SMART_INFERENCE_API_KEY", "")
    ANALYSIS_MODEL: str = os.getenv("ANALYSIS_MODEL", "llama-3.3-70b")
    TUTOR_MODEL: str = os.getenv("TUTOR_MODEL", "llama-3.3-70b")
    
    CEREBRAS_API_KEY: str = os.getenv("CEREBRAS_API_KEY", "")
    CEREBRAS_MODEL: str = os.getenv("CEREBRAS_MODEL", "llama-3.3-70b")
    USE_CEREBRAS: bool = os.getenv("USE_CEREBRAS", "true").lower() in ("true", "1", "yes")
    TURN_ANALYSIS_CLUSTER_SIZE: int = int(os.getenv("TURN_ANALYSIS_CLUSTER_SIZE", "4"))  # Changed from 3 to 4 for soft beginner mode

    # Gemini 3 Configuration (Hackathon Integration)
    GEMINI_API_KEY: str = os.getenv("GEMINI_API_KEY", "")
    GEMINI_MODEL: str = os.getenv("GEMINI_MODEL", "gemini-3-flash-preview")
    ENABLE_GEMINI_ANALYSIS: bool = os.getenv("ENABLE_GEMINI_ANALYSIS", "true").lower() in ("true", "1", "yes")
    GEMINI_THINKING_LEVEL: str = os.getenv("GEMINI_THINKING_LEVEL", "medium")  # low, medium, high
    GEMINI_FALLBACK_TO_CEREBRAS: bool = os.getenv("GEMINI_FALLBACK_TO_CEREBRAS", "true").lower() in ("true", "1", "yes")

    # Soft Beginner Mode settings
    ENABLE_SOFT_BEGINNER_MODE: bool = os.getenv("ENABLE_SOFT_BEGINNER_MODE", "true").lower() in ("true", "1", "yes")
    SOFT_BEGINNER_TURN_THRESHOLD: int = int(os.getenv("SOFT_BEGINNER_TURN_THRESHOLD", "4"))
    SOFT_BEGINNER_GRADUATION_MIN_TURNS: int = int(os.getenv("SOFT_BEGINNER_GRADUATION_MIN_TURNS", "8"))
    STAGGER_TURN_INTERVAL: int = int(os.getenv("STAGGER_TURN_INTERVAL", "4"))
    ADAPTIVE_RECOMMENDATION_INTERVAL: int = int(os.getenv("ADAPTIVE_RECOMMENDATION_INTERVAL", "6"))
    ENABLE_ADAPTIVE_RECOMMENDATIONS: bool = os.getenv("ENABLE_ADAPTIVE_RECOMMENDATIONS", "true").lower() in ("true", "1", "yes")
    USER_INSIGHTS_TTL_DAYS: int = int(os.getenv("USER_INSIGHTS_TTL_DAYS", "7"))
    GUIDANCE_TIMELINE_NAME: str = os.getenv("GUIDANCE_TIMELINE_NAME", "guidance")
    SESSION_SUMMARY_MODEL: str = os.getenv("SESSION_SUMMARY_MODEL", "llama-3.3-70b")
    MIN_NOTES_FOR_DIFFICULTY_ESCALATION: int = int(os.getenv("MIN_NOTES_FOR_DIFFICULTY_ESCALATION", "35"))
    SEVERE_PRIORITY_CUTOFF: int = int(os.getenv("SEVERE_PRIORITY_CUTOFF", "2"))
    BEGINNER_MAX_ERROR_RATE: float = float(os.getenv("BEGINNER_MAX_ERROR_RATE", "0.28"))
    ADVANCED_PROMOTION_ERROR_RATE: float = float(os.getenv("ADVANCED_PROMOTION_ERROR_RATE", "0.08"))
    MIN_FLUENCY_NOTES_FOR_PROMOTION: int = int(os.getenv("MIN_FLUENCY_NOTES_FOR_PROMOTION", "8"))
    
    # Reference Library Detection
    ENABLE_REFERENCE_DETECTION: bool = os.getenv("ENABLE_REFERENCE_DETECTION", "true").lower() in ("true", "1", "yes")
    REFERENCE_DETECTION_CONFIDENCE_THRESHOLD: float = float(os.getenv("REFERENCE_DETECTION_CONFIDENCE_THRESHOLD", "0.7"))
    REFERENCE_DETECTION_USE_GEMINI: bool = os.getenv("REFERENCE_DETECTION_USE_GEMINI", "true").lower() in ("true", "1", "yes")

    ELEVENLABS_API_KEY: str = os.getenv("ELEVENLABS_API_KEY", "")
    ELEVENLABS_DEV_API_KEY: str = os.getenv("ELEVENLABS_DEV_API_KEY", "")
    
    ELEVENLABS_BEGINNER_AGENT_ID: str = os.getenv("ELEVENLABS_BEGINNER_AGENT_ID", "")
    ELEVENLABS_INTERMEDIATE_AGENT_ID: str = os.getenv("ELEVENLABS_INTERMEDIATE_AGENT_ID", "")
    ELEVENLABS_ADVANCED_AGENT_ID: str = os.getenv("ELEVENLABS_ADVANCED_AGENT_ID", "")
    
    ENVIRONMENT: str = os.getenv("ENVIRONMENT", "development")
    ENABLE_ADAPTIVE_DIFFICULTY: bool = os.getenv("ENABLE_ADAPTIVE_DIFFICULTY", "true").lower() in ("true", "1", "yes")
    
    TRANSLATION_API_BASE_URL: str = os.getenv("TRANSLATION_API_BASE_URL", "https://libretranslate.de/translate")
    TRANSLATION_API_KEY: str = os.getenv("TRANSLATION_API_KEY", "")
    TRANSLATION_API_TIMEOUT: float = float(os.getenv("TRANSLATION_API_TIMEOUT", "6.0"))
    
    # Auth (shared secret with core-api for JWT validation)
    VOICE_ENGINE_SECRET: str = os.getenv("VOICE_ENGINE_SECRET", "")

    # Session limits
    MAX_SESSION_MINUTES: int = int(os.getenv("MAX_SESSION_MINUTES", "30"))
    MAX_AUDIO_CHUNK_BYTES: int = int(os.getenv("MAX_AUDIO_CHUNK_BYTES", str(1024 * 1024)))  # 1 MB default

    PYTHON_VOICE_SERVICE_URL: str = os.getenv("PYTHON_VOICE_SERVICE_URL", "")
   
    @property
    def elevenlabs_api_key(self) -> str:
        if self.ENVIRONMENT == "production":
            return self.ELEVENLABS_API_KEY
        return self.ELEVENLABS_DEV_API_KEY or self.ELEVENLABS_API_KEY
    
    @property
    def is_production(self) -> bool:
        return self.ENVIRONMENT == "production"
    
    @property
    def is_local(self) -> bool:
        return self.ENVIRONMENT == "development"
    
    @property
    def database_url(self) -> str:
        # Require an explicit connection string for production/remote DBs.
        # We avoid a local SQLite fallback to prevent the build tooling
        # from pulling local DB files into deployment bundles.
        return self.VULTR_DB_CONNECTION_STRING

    class Config:
        env_file = ".env"
        case_sensitive = True

settings = Settings()