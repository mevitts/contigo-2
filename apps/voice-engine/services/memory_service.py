"""
SmartMemory integration for conversation persistence and semantic search.

Architecture:
- Working Memory: Active session (each conversation, ~60 turns max)
- Episodic Memory: Searchable conversation history (auto-summarized)
- Semantic Memory: User's learned patterns (ser vs estar struggles, etc.)
- Procedural Memory: Tutor behavior templates (shared across all sessions)

Raindrop SmartMemory handles:
- Semantic search over conversation history
- AI-powered summarization of sessions
- Cross-session learning patterns
- "Replay Button" feature (find all ser/estar mistakes)

SQLite LearningNotes still stores:
- Structured data for analytics
- Turn-by-turn feedback details
- Difficulty progression tracking

Trade-offs accepted:
- Actor resource consumption: OK for hackathon scale (~10 concurrent users)
- Fine-grained memory: Needed for language learning detail
- Cross-session learning: User-specific semantic memory (isolated by user_id)
"""

from typing import Optional, List, Dict, Any
import uuid

from datetime import datetime, timedelta
from dataclasses import dataclass
from config.settings import settings
from config.logging_config import get_logger

logger = get_logger(__name__)

# Check if Raindrop SDK is available
try:
    from raindrop import Raindrop
    from raindrop._exceptions import APIStatusError
    SMARTMEMORY_AVAILABLE = bool(settings.SMART_INFERENCE_API_KEY)
    if SMARTMEMORY_AVAILABLE:
        raindrop_client = Raindrop(api_key=settings.SMART_INFERENCE_API_KEY)
        logger.info("Raindrop SmartMemory SDK initialized")
    else:
        raindrop_client = None
        logger.warning("SMART_INFERENCE_API_KEY not set - using mock memory")
except ImportError:
    SMARTMEMORY_AVAILABLE = False
    raindrop_client = None
    logger.warning("Raindrop SDK not installed - using mock memory")
    class APIStatusError(Exception):
        pass


SMART_MEMORY_CONFIG: Dict[str, Any] = {
    "smartMemory": {
        "name": settings.SMART_MEMORY_NAME,
        "application_name": settings.SMART_MEMORY_APPLICATION,
        "version": settings.SMART_MEMORY_VERSION,
    }
}

if settings.SMART_MEMORY_MODULE:
    SMART_MEMORY_CONFIG["module"] = settings.SMART_MEMORY_MODULE


@dataclass
class MemorySessionArtifacts:
    transcript: List[Dict[str, Any]]
    guidance_entries: List[Dict[str, Any]]
    episodic_summary: Optional[str] = None

class MemoryService:
    """
    Manages multi-level memory using Raindrop SmartMemory.
    Falls back to local storage when SmartMemory unavailable.
    
    Memory granularity: Fine-grained (turn-by-turn) for language learning detail.
    Actor scaling: Optimized for hackathon (~10 concurrent users, not thousands).
    Privacy: User-specific semantic memory (isolated by user_id).
    """
    
    def __init__(self):
        self.active_sessions: Dict[str, str] = {}
        self._mock_timelines: Dict[str, Dict[str, List[Dict[str, Any]]]] = {}
        self._force_mock = not SMARTMEMORY_AVAILABLE
        self._strict_mode = settings.SMART_MEMORY_STRICT_MODE
        self._remote_disabled_until: Optional[datetime] = None
        self.last_remote_error: Optional[Dict[str, Any]] = None
        fallback_requested = settings.SMART_MEMORY_ALLOW_MOCK_FALLBACK or not SMARTMEMORY_AVAILABLE
        self._allow_mock_fallback = fallback_requested and not self._strict_mode
        self._cooldown_seconds = max(1, settings.SMART_MEMORY_DISABLE_SECONDS)
        self._client = raindrop_client
        if SMARTMEMORY_AVAILABLE and not self._force_mock:
            logger.info("SmartMemory initialized - full memory features enabled")
        else:
            logger.warning("SmartMemory not configured or temporarily disabled - using mock mode")

    def _use_remote(self) -> bool:
        if not SMARTMEMORY_AVAILABLE or self._force_mock or not self._client:
            return False
        if self._remote_disabled_until and datetime.utcnow() < self._remote_disabled_until:
            return False
        return True

    def _start_mock_session(self, user_id: uuid.UUID) -> str:
        if not self._allow_mock_fallback:
            raise RuntimeError("SmartMemory mock fallback is disabled")
        session_id = f"mock_session_{user_id}_{uuid.uuid4()}"
        self.active_sessions[str(user_id)] = session_id
        self._mock_timelines[session_id] = {}
        logger.info(
            "Mock SmartMemory session started",
            extra={"session_id": session_id, "user_id": str(user_id)},
        )
        return session_id

    def _temporarily_disable_remote(self, seconds: Optional[int] = None) -> None:
        window = seconds if seconds is not None else self._cooldown_seconds
        self._remote_disabled_until = datetime.utcnow() + timedelta(seconds=window)

    def _record_remote_failure(self, stage: str, error: Exception) -> None:
        details: Dict[str, Any] = {
            "stage": stage,
            "error": str(error),
        }
        if isinstance(error, APIStatusError):
            details["status_code"] = getattr(error, "status_code", None)
            body = getattr(error, "body", None)
            if body is not None:
                if isinstance(body, (dict, list)):
                    details["response_body"] = body
                else:
                    details["response_body"] = str(body)[:500]
        self.last_remote_error = details
        logger.error(
            "SmartMemory remote call failed during %s | status=%s | body=%s",
            stage,
            details.get("status_code"),
            details.get("response_body"),
        )
        logger.debug("SmartMemory failure payload", extra=details)
        self._temporarily_disable_remote()

    def get_last_remote_error(self) -> Optional[Dict[str, Any]]:
        return self.last_remote_error
    
    async def start_session(self, user_id: uuid.UUID) -> str:
        """
        Start a new working memory session for active conversation.
        Creates an Actor instance for this session (isolated memory).
        Returns session_id for subsequent memory operations.
        """
        if self._use_remote():
            try:
                client = self._client
                if not client:
                    raise RuntimeError("SmartMemory client unavailable")
                response = client.start_session.create(
                    smart_memory_location=SMART_MEMORY_CONFIG
                )
                session_id = response.session_id or f"smart_session_{uuid.uuid4()}"
                self.active_sessions[str(user_id)] = session_id
                logger.info(
                    "Started SmartMemory session",
                    extra={"session_id": session_id, "user_id": str(user_id)},
                )
                self.last_remote_error = None
                self._remote_disabled_until = None
                return session_id
            except Exception as exc:  # pragma: no cover - defensive network fallback
                self._record_remote_failure("start_session", exc)
                if self._strict_mode:
                    raise RuntimeError("SmartMemory session failed; strict mode prevents mock fallback") from exc
        elif self._strict_mode:
            raise RuntimeError("SmartMemory remote client unavailable while strict mode is enabled")

        if not self._allow_mock_fallback:
            raise RuntimeError("SmartMemory session unavailable and mock fallback disabled")

        session_id = self._start_mock_session(user_id)
        
        return session_id
    
    #think abut cmmenting for now to save some usage
    async def put_turn_memory(
        self,
        session_id: str,
        content: str,
        timeline: str = "conversation",
        agent: str = "system"
    ):
        """
        Store a memory entry during active conversation.
        Fine-grained: Every turn stored for detailed "Replay Button" feature.
        
        Args:
            session_id: Active session ID
            content: What to remember (transcript, feedback, correction)
            timeline: Organize by type (conversation, grammar_patterns, vocabulary)
            agent: Who created this memory (user, tutor, system)
        """
        entry = {
            "content": content,
            "timeline": timeline,
            "agent": agent,
            "timestamp": datetime.utcnow().isoformat(),
        }

        preview = content[:80].replace("\n", " ")

        if self._use_remote():
            client = self._client
            if not client:
                raise RuntimeError("SmartMemory client unavailable")
            try:
                response = client.put_memory.create(
                    content=content,
                    session_id=session_id,
                    timeline=timeline,
                    agent=agent,
                    smart_memory_location=SMART_MEMORY_CONFIG
                )
                self.last_remote_error = None
                self._remote_disabled_until = None
                logger.info(
                    "SmartMemory turn stored",
                    extra={
                        "session_id": session_id,
                        "timeline": timeline,
                        "agent": agent,
                        "preview": preview,
                        "memory_id": getattr(response, "memory_id", None),
                    },
                )
                return
            except Exception as exc:
                self._record_remote_failure("put_turn_memory", exc)
                if not self._allow_mock_fallback:
                    return

        timelines = self._mock_timelines.setdefault(session_id, {})
        timelines.setdefault(timeline, []).append(entry)
        logger.info(
            "Mock SmartMemory turn stored",
            extra={"session_id": session_id, "timeline": timeline, "agent": agent, "preview": preview},
        )


    async def end_session(self, session_id: str, user_id: uuid.UUID, flush: bool = True) -> MemorySessionArtifacts:
        """Close out SmartMemory for a session and return captured artifacts."""
        transcript_entries = await self.search_working_memory(
            session_id,
            "recent conversation",
            timeline="conversation",
        )
        guidance_entries = await self.search_working_memory(
            session_id,
            "guidance cues",
            timeline=settings.GUIDANCE_TIMELINE_NAME,
        )
        logger.info(
            "Collected working memory snapshot",
            extra={
                "session_id": session_id,
                "transcript_entries": len(transcript_entries or []),
                "guidance_entries": len(guidance_entries or []),
            },
        )

        episodic_summary = None

        if self._use_remote():
            client = self._client
            if not client:
                raise RuntimeError("SmartMemory client unavailable")
            try:
                response = client.end_session.create(
                    session_id=session_id,
                    flush=flush,
                    system_prompt="Summarize key grammar mistakes and learning moments from this Spanish conversation.",
                    smart_memory_location=SMART_MEMORY_CONFIG,
                )
                self.last_remote_error = None
                self._remote_disabled_until = None
                if response.success:
                    logger.info(f"Session ended (flush={flush}): {session_id}")
                    if flush:
                        logger.info(f"Episodic memory saved for user {user_id}")
                episodic_summary = getattr(response, "summary", None)
                if episodic_summary:
                    logger.info(
                        "Received episodic summary",
                        extra={"session_id": session_id, "summary_preview": episodic_summary[:120]},
                    )
            except Exception as exc:
                self._record_remote_failure("end_session", exc)
                if not self._allow_mock_fallback:
                    raise
        else:
            logger.debug(f"Mock session ended: {session_id}")

        self.active_sessions.pop(str(user_id), None)
        self._mock_timelines.pop(session_id, None)

        if flush:
            await self.update_semantic_patterns(user_id, session_id)

        return MemorySessionArtifacts(
            transcript=transcript_entries or [],
            guidance_entries=guidance_entries or [],
            episodic_summary=episodic_summary,
        )
    
    async def update_semantic_patterns(self, user_id: uuid.UUID, session_id: str):
        """
        Extract learned patterns from session and store as semantic memory.
        User-specific: Isolated by user_id to prevent cross-user privacy issues.
        Examples: "User struggles with ser vs estar", "Pronunciation of 'rr' improving"
        """
        if self._use_remote():
            # Store user-specific learning pattern
            # In production, query LearningNotes for actual patterns
            document = {
                "user_id": str(user_id),
                "session_id": session_id,
                "timestamp": datetime.utcnow().isoformat(),
                "note": "Session completed - patterns will be extracted from LearningNotes"
            }
            client = self._client
            if not client:
                raise RuntimeError("SmartMemory client unavailable")
            try:
                response = client.put_semantic_memory.create(
                    document=str(document),
                    smart_memory_location=SMART_MEMORY_CONFIG
                )
                self.last_remote_error = None
                self._remote_disabled_until = None
                if response.success:
                    logger.debug(f"Semantic pattern stored: {response.object_id}")
            except Exception as exc:
                self._record_remote_failure("put_semantic_memory", exc)
                if not self._allow_mock_fallback:
                    return
        else:
            logger.debug(f"Mock semantic update for user {user_id}")
    
    async def search_episodic(self, user_id: uuid.UUID, query: str, limit: int = 5) -> List[Dict[str, Any]]:
        """
        Semantic search across all past conversations.
        Powers "Replay Button" feature - e.g., "show all ser/estar mistakes"
        
        Args:
            user_id: User whose history to search (privacy isolation)
            query: Natural language query ("times I confused ser and estar")
            limit: Max results to return
        
        Returns:
            List of conversation episodes with summaries and metadata
        """
        if self._use_remote():
            # Add user_id to query for privacy isolation
            user_query = f"{query} for user {user_id}"
            client = self._client
            if not client:
                raise RuntimeError("SmartMemory client unavailable")
            try:
                response = client.query.episodic_memory.search(
                    terms=user_query,
                    n_most_recent=limit,
                    smart_memory_location=SMART_MEMORY_CONFIG
                )
                self.last_remote_error = None
                self._remote_disabled_until = None
                entries = response.entries or []
                logger.debug(f"Episodic search found {len(entries)} results")
                return [
                    {
                        "session_id": entry.session_id,
                        "summary": entry.summary,
                        "created_at": entry.created_at,
                        "score": entry.score
                    }
                    for entry in entries
                ]
            except Exception as exc:
                self._record_remote_failure("search_episodic", exc)
                return []
        else:
            if self._strict_mode:
                logger.warning(
                    "SmartMemory episodic search skipped; remote service unavailable while strict mode is enabled",
                    extra={"query": query[:80], "user_id": str(user_id)},
                )
            else:
                logger.debug(f"📝 Mock episodic search: {query}")
            return []
    
    async def search_working_memory(self, session_id: str, query: str, timeline: Optional[str] = None) -> List[Dict[str, Any]]:
        """
        Semantic search within active session's working memory.
        Use for finding recent context during conversation.
        
        Args:
            session_id: Active session to search
            query: Natural language query
            timeline: Optional timeline filter
        
        Returns:
            List of memory entries matching query
        """
        if self._use_remote():
            client = self._client
            if not client:
                raise RuntimeError("SmartMemory client unavailable")
            try:
                response = client.query.memory.search(
                    session_id=session_id,
                    terms=query,
                    timeline=timeline,
                    smart_memory_location=SMART_MEMORY_CONFIG
                )
                self.last_remote_error = None
                self._remote_disabled_until = None
                memories = response.memories or []
                logger.debug(f"Working memory search found {len(memories)} results")
                return [
                    {
                        "id": mem.id,
                        "content": mem.content,
                        "timeline": mem.timeline,
                        "agent": mem.agent,
                        "at": mem.at
                    }
                    for mem in memories
                ]
            except Exception as exc:
                self._record_remote_failure("search_working_memory", exc)
                return []
        else:
            if self._strict_mode:
                logger.warning(
                    "SmartMemory working memory search skipped; remote service unavailable while strict mode is enabled",
                    extra={"session_id": session_id, "timeline": timeline, "query": query[:80]},
                )
                return []
            if session_id not in self._mock_timelines:
                return []
            timelines = self._mock_timelines[session_id]
            if timeline:
                return timelines.get(timeline, [])
            results: List[Dict[str, Any]] = []
            for entries in timelines.values():
                results.extend(entries)
            return results
    
    async def get_procedural_template(self, template_name: str) -> Optional[str]:
        """
        Retrieve procedural memory (tutor behavior templates).
        Shared across all sessions for consistency.
        
        Examples: "beginner_correction_style", "advanced_humor_frequency"
        """
        if self._use_remote():
            client = self._client
            if not client:
                raise RuntimeError("SmartMemory client unavailable")
            try:
                response = client.get_procedure.create(
                    key=template_name,
                    smart_memory_location=SMART_MEMORY_CONFIG
                )
                self.last_remote_error = None
                self._remote_disabled_until = None
                if response.found:
                    logger.debug(f"Retrieved template: {template_name}")
                    return response.value
                logger.debug(f"Template not found: {template_name}")
                return None
            except Exception as exc:
                self._record_remote_failure("get_procedure", exc)
                return None
        else:
            logger.debug(f"Mock template: {template_name}")
            return None
    
    async def put_procedural_template(self, template_name: str, template_value: str):
        """
        Store procedural memory (tutor behavior templates).
        Shared across all sessions - use for consistent agent behavior.
        
        Examples:
            - "beginner_correction_style": "Always praise first, then gently correct"
            - "advanced_humor_frequency": "Inject subtle humor 1-2 times per 10 turns"
        """
        if self._use_remote():
            client = self._client
            if not client:
                raise RuntimeError("SmartMemory client unavailable")
            try:
                response = client.put_procedure.create(
                    key=template_name,
                    value=template_value,
                    smart_memory_location=SMART_MEMORY_CONFIG
                )
                self.last_remote_error = None
                self._remote_disabled_until = None
                if response.success:
                    logger.info(f"Stored procedural template: {template_name}")
            except Exception as exc:
                self._record_remote_failure("put_procedure", exc)
        else:
            logger.debug(f"Mock procedural store: {template_name}")


# Global instance
memory_service = MemoryService()
