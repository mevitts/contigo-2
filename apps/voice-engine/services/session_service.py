import logging
import uuid
from datetime import datetime
from typing import Optional, Dict
from sqlmodel import Session, select
from domain.models import VoiceSession
from services.db_service import engine
from models.db_models import Conversations, Users
from config.settings import settings

logger = logging.getLogger(__name__)

# Lazy import for Gemini service
_gemini_service = None
def _get_gemini_service():
    global _gemini_service
    if _gemini_service is None:
        try:
            from services.gemini_service import gemini_service
            _gemini_service = gemini_service
        except ImportError:
            pass
    return _gemini_service

class SessionService:
    """Service for managing voice session lifecycle"""
    
    def __init__(self):
        self.active_sessions: Dict[str, VoiceSession] = {}
    
    def create_session(
        self,
        user_id: uuid.UUID,
        agent_id: str,
        agent_name: str,
        language: str,
        model: Optional[str] = None,
        custom_context: Optional[Dict] = None,
        conversation_id: Optional[str] = None,
    ) -> VoiceSession:
        """
        Create a new voice session.
        
        Args:
            user_id: User UUID
            agent_id: ElevenLabs agent ID
            agent_name: Human-readable agent name
            language: Language code (e.g., 'es', 'en')
            model: GPT model for analysis (default: gpt-4-turbo)
            custom_context: Additional context for the session
            
        Returns:
            VoiceSession object
        """
        resolved_id = conversation_id or str(uuid.uuid4())
        try:
            conversation_uuid = uuid.UUID(str(resolved_id))
        except ValueError:
            logger.warning("Invalid conversation_id provided (%s); generating a new one", conversation_id)
            conversation_uuid = uuid.uuid4()
            resolved_id = str(conversation_uuid)
        
        adaptive_flag = custom_context.get("adaptive") if custom_context else None
        difficulty_value = custom_context.get("difficulty") if custom_context else None
        topic_value = custom_context.get("topic") if custom_context else None

        resolved_start = datetime.utcnow()

        # Store/merge in database
        with Session(engine) as db:
            self._ensure_user_exists(db, user_id)

            db_conversation = db.get(Conversations, conversation_uuid)
            if db_conversation:
                if db_conversation.user_id != user_id:
                    logger.warning(
                        "Conversation %s belongs to %s but user %s requested it; creating new record",
                        resolved_id,
                        db_conversation.user_id,
                        user_id,
                    )
                    db_conversation = None

            if db_conversation:
                resolved_start = db_conversation.start_time or resolved_start
                db_conversation.agent_display_name = agent_name
                db_conversation.language = language
                if difficulty_value is not None:
                    db_conversation.difficulty = difficulty_value
                if adaptive_flag is not None:
                    db_conversation.adaptive = bool(adaptive_flag)
                if topic_value is not None:
                    db_conversation.topic = topic_value
                if not db_conversation.start_time:
                    db_conversation.start_time = resolved_start
                db.add(db_conversation)
            else:
                resolved_start = datetime.utcnow()
                db_conversation = Conversations(
                    id=conversation_uuid,
                    user_id=user_id,
                    start_time=resolved_start,
                    agent_display_name=agent_name,
                    language=language,
                    adaptive=bool(adaptive_flag) if adaptive_flag is not None else False,
                    topic=topic_value,
                    difficulty=difficulty_value,
                )
                db.add(db_conversation)

            db.commit()

        session = VoiceSession(
            conversation_id=resolved_id,
            user_id=user_id,
            agent_id=agent_id,
            agent_name=agent_name,
            language=language,
            status="active",
            start_time=resolved_start,
            model=model or "gpt-4-turbo",
            custom_context=custom_context,
        )
        
        self.active_sessions[resolved_id] = session

        # Load thought signature for returning users (Gemini cross-session continuity)
        if settings.ENABLE_GEMINI_ANALYSIS:
            gs = _get_gemini_service()
            if gs:
                prior_signature = gs.load_user_thought_signature(str(user_id))
                if prior_signature:
                    logger.info(
                        f"Loaded prior thought signature for returning user",
                        extra={"user_id": str(user_id), "conversation_id": resolved_id}
                    )

        logger.info(f"Created session {resolved_id} for user {user_id}")
        return session
    
    def get_session(self, conversation_id: str) -> Optional[VoiceSession]:
        """Get an active session by ID"""
        return self.active_sessions.get(conversation_id)
    
    def end_session(self, conversation_id: str) -> bool:
        """
        End a voice session.
        
        Args:
            conversation_id: The session to end
            
        Returns:
            True if session was found and ended, False otherwise
        """
        session = self.active_sessions.pop(conversation_id, None)
        
        if session:
            session.status = "completed"

            with Session(engine) as db:
                conversation = db.get(Conversations, uuid.UUID(conversation_id))
                if conversation:
                    conversation.end_time = datetime.utcnow()
                    db.add(conversation)
                    db.commit()

            logger.info(f"Ended session {conversation_id}")
            return True
        
        logger.warning(f"Session {conversation_id} not found")
        return False
    
    def get_active_session_count(self) -> int:
        """Get count of currently active sessions"""
        return len(self.active_sessions)
    
    def list_active_sessions(self, user_id: Optional[uuid.UUID] = None) -> list[VoiceSession]:
        """
        List active sessions, optionally filtered by user.
        
        Args:
            user_id: Optional user ID to filter by
            
        Returns:
            List of active sessions
        """
        sessions = list(self.active_sessions.values())
        
        if user_id:
            sessions = [s for s in sessions if s.user_id == user_id]
        
        return sessions

    def _ensure_user_exists(self, db: Session, user_id: uuid.UUID) -> Users:
        """Guarantee that the user row exists before creating a conversation."""
        user = db.exec(select(Users).where(Users.id == user_id)).first()
        if user:
            return user

        placeholder_email = f"voice+{user_id}@contigo.local"
        placeholder_external_id = f"voice-placeholder-{user_id}"

        user = Users(
            id=user_id,
            workos_id=placeholder_external_id,
            email=placeholder_email,
            name=None,
        )
        db.add(user)
        db.flush()  # ensure ID available for FK before conversation insert
        logger.info(f"Created placeholder user record for {user_id}")
        return user

# Singleton instance
session_service = SessionService()
