import asyncio
import logging
import uuid
import redis
from typing import Awaitable, Callable, Dict, List, Optional

from sqlmodel import Session

from services.db_service import engine, save_learning_note
from services.cerebras_service import cerebras_service
from services.memory_service import memory_service
from config.settings import settings

# Gemini service for hackathon integration (lazy import to avoid startup errors if SDK missing)
gemini_service = None
def _get_gemini_service():
    global gemini_service
    if gemini_service is None:
        try:
            from services.gemini_service import gemini_service as _gs
            gemini_service = _gs
        except ImportError as e:
            logging.getLogger(__name__).warning(f"Gemini service unavailable: {e}")
    return gemini_service

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

GuidanceCallback = Callable[[dict], Awaitable[None]]

CLUSTER_SIZE = max(2, settings.TURN_ANALYSIS_CLUSTER_SIZE)
TurnExchange = Dict[str, str]

# Global cache for analysis results, could also be moved to Redis if needed
_cluster_results: Dict[uuid.UUID, List[dict]] = {}

try:
    redis_client = redis.from_url(settings.REDIS_URL, decode_responses=True)
    redis_client.ping()
    logger.info("Tutor service connected to Redis for transcript caching.")
except redis.exceptions.ConnectionError as e:
    logger.error(f"Tutor service could not connect to Redis: {e}", exc_info=True)
    redis_client = None

def _get_transcript_key(conversation_id: uuid.UUID) -> str:
    return f"transcript:{conversation_id}"

def _get_turn_counter_key(conversation_id: uuid.UUID) -> str:
    return f"turn_count:{conversation_id}"

def _get_recommendations_key(conversation_id: uuid.UUID) -> str:
    """Key for storing adaptive recommendations per session."""
    return f"recommendations:{conversation_id}"

def _get_user_insights_key(user_id: uuid.UUID) -> str:
    """Key for cross-session user insights."""
    return f"user_insights:{user_id}"


def _get_struggle_pattern_key(user_id: uuid.UUID) -> str:
    """Key for tracking early struggle patterns across sessions."""
    return f"struggle_pattern:{user_id}"


def record_early_struggle(user_id: uuid.UUID, conversation_id: uuid.UUID, turn: int) -> None:
    """Record struggle for cross-session learning."""
    if not redis_client:
        return
    import json
    key = _get_struggle_pattern_key(user_id)
    entry = json.dumps({"conversation_id": str(conversation_id), "turn": turn})
    redis_client.rpush(key, entry)
    redis_client.expire(key, 30 * 24 * 3600)  # 30 days
    logger.info(
        "Early struggle recorded",
        extra={
            "user_id": str(user_id),
            "conversation_id": str(conversation_id),
            "turn": turn,
        }
    )


def should_preactivate_soft_beginner(user_id: uuid.UUID) -> bool:
    """Check if user historically struggles (3+ of last 5 sessions)."""
    if not redis_client:
        return False
    key = _get_struggle_pattern_key(user_id)
    entries = redis_client.lrange(key, -5, -1)
    should_preactivate = len(entries) >= 3
    if should_preactivate:
        logger.info(
            "Soft beginner pre-activation recommended",
            extra={
                "user_id": str(user_id),
                "struggle_count": len(entries),
            }
        )
    return should_preactivate


def save_adaptive_recommendation(
    conversation_id: uuid.UUID,
    user_id: uuid.UUID,
    recommendation: str,
    turn_number: int,
    metadata: Optional[Dict] = None
) -> None:
    """
    Store adaptive recommendation in Redis for:
    1. Mid-session tracking
    2. Session summary aggregation
    3. Future session context
    """
    if not redis_client:
        logger.warning("Redis unavailable, recommendation not cached")
        return

    import json
    from datetime import datetime

    rec_entry = {
        "turn": turn_number,
        "recommendation": recommendation,
        "timestamp": datetime.utcnow().isoformat(),
        "metadata": metadata or {}
    }

    # Store in conversation-specific list
    rec_key = _get_recommendations_key(conversation_id)
    redis_client.rpush(rec_key, json.dumps(rec_entry))
    redis_client.expire(rec_key, settings.REDIS_TTL_SECONDS)

    # Also store as user insight (longer TTL for cross-session access)
    insights_key = _get_user_insights_key(user_id)
    redis_client.rpush(insights_key, json.dumps({
        "conversation_id": str(conversation_id),
        **rec_entry
    }))
    # Keep user insights for configured days
    redis_client.expire(insights_key, settings.USER_INSIGHTS_TTL_DAYS * 24 * 3600)

    logger.info(
        "Adaptive recommendation cached",
        extra={
            "conversation_id": str(conversation_id),
            "turn": turn_number,
            "preview": recommendation[:80]
        }
    )


def get_recent_recommendations(
    conversation_id: uuid.UUID,
    limit: int = 5
) -> List[Dict]:
    """Retrieve recent recommendations for this session."""
    if not redis_client:
        return []

    import json

    rec_key = _get_recommendations_key(conversation_id)
    raw_entries = redis_client.lrange(rec_key, -limit, -1)

    recommendations = []
    for entry in raw_entries:
        try:
            recommendations.append(json.loads(entry))
        except json.JSONDecodeError:
            logger.warning(f"Failed to parse recommendation: {entry}")

    return recommendations


def get_user_insights_for_context(
    user_id: uuid.UUID,
    limit: int = 3
) -> List[str]:
    """
    Get recent cross-session insights for building agent context.
    Returns human-readable strings suitable for injection.
    """
    if not redis_client:
        return []

    import json

    insights_key = _get_user_insights_key(user_id)
    raw_entries = redis_client.lrange(insights_key, -limit, -1)

    insights = []
    for entry in raw_entries:
        try:
            data = json.loads(entry)
            recommendation = data.get("recommendation", "").strip()
            if recommendation:
                insights.append(f"Previous session insight: {recommendation}")
        except json.JSONDecodeError:
            continue

    return insights


def _parse_transcript_from_redis(history: List[str]) -> List[TurnExchange]:
    """Parses a flat list of 'Role: Text' strings from Redis into TurnExchange dicts."""
    exchanges: List[TurnExchange] = []
    # Temp holder for a user turn that hasn't been matched with an agent turn yet.
    temp_user_text: Optional[str] = None

    for item in history:
        try:
            role, text = item.split(":", 1)
            text = text.strip()

            if role == "Learner":
                # If there was a previous unmatched user turn, store it as an incomplete exchange.
                if temp_user_text is not None:
                    exchanges.append({"user_text": temp_user_text, "agent_text": ""})
                temp_user_text = text
            elif role == "Tutor":
                if temp_user_text is not None:
                    # Match found, create a complete exchange.
                    exchanges.append({"user_text": temp_user_text, "agent_text": text})
                    temp_user_text = None
                else:
                    # This case (agent speaks first) is unlikely but we can log it.
                    logger.warning(f"Orphan agent turn found in transcript: {text}")

        except ValueError:
            logger.warning(f"Could not parse transcript line: {item}")

    # If the loop ends and there's an unmatched user turn, add it.
    if temp_user_text is not None:
        exchanges.append({"user_text": temp_user_text, "agent_text": ""})

    return exchanges


async def register_user_turn(
    *,
    conversation_id: uuid.UUID,
    user_text: str,
) -> None:
    text = (user_text or "").strip()
    if not text or not redis_client:
        return

    transcript_key = _get_transcript_key(conversation_id)
    redis_client.rpush(transcript_key, f"Learner: {text}")
    redis_client.expire(transcript_key, settings.REDIS_TTL_SECONDS)
    logger.debug("Buffered user turn to Redis", extra={"conversation_id": str(conversation_id)})


async def register_agent_turn(
    *,
    conversation_id: uuid.UUID,
    user_id: uuid.UUID,
    agent_text: str,
    model: str,
    guidance_callback: Optional[GuidanceCallback] = None,
    memory_session_id: Optional[str] = None,
) -> None:
    text = (agent_text or "").strip()
    if not text or not redis_client:
        return

    transcript_key = _get_transcript_key(conversation_id)
    turn_counter_key = _get_turn_counter_key(conversation_id)

    # Store agent turn and increment counter
    redis_client.rpush(transcript_key, f"Tutor: {text}")
    turn_count = redis_client.incr(turn_counter_key)
    
    # Set expiration on first increment
    if turn_count == 1:
        redis_client.expire(transcript_key, settings.REDIS_TTL_SECONDS)
        redis_client.expire(turn_counter_key, settings.REDIS_TTL_SECONDS)


    # Check if it's time to run analysis
    if turn_count % CLUSTER_SIZE != 0:
        return

    # Fetch N*2 items because a turn consists of a user and an agent message.
    history_list = redis_client.lrange(transcript_key, -CLUSTER_SIZE * 2, -1)
    
    if not history_list:
        return

    cluster_slice = _parse_transcript_from_redis(history_list)
    
    # Ensure we have enough turns to form a valid cluster for analysis
    if len(cluster_slice) < CLUSTER_SIZE:
        logger.debug(f"Not enough completed turns in Redis for analysis. Found {len(cluster_slice)}, need {CLUSTER_SIZE}")
        return

    analysis = await _analyze_cluster(
        cluster_slice[-CLUSTER_SIZE:], # Send only the last N turns for analysis
        user_id=user_id,
        conversation_id=conversation_id,
        model=model,
        memory_session_id=memory_session_id,
    )

    if guidance_callback and analysis.get("guidance"):
        await guidance_callback(_build_guidance_payload(analysis))


async def _analyze_cluster(
    cluster: List[TurnExchange],
    *,
    user_id: uuid.UUID,
    conversation_id: uuid.UUID,
    model: str,
    memory_session_id: Optional[str],
) -> dict:
    logger.info("Running clustered analysis from Redis", extra={"conversation_id": str(conversation_id), "turns": len(cluster)})
    history_text = "\n".join(
        f"Learner: {turn.get('user_text', '')}\nTutor: {turn.get('agent_text', '')}" for turn in cluster
    )

    # Primary: Use Gemini 3 with Thought Signatures (hackathon integration)
    # Fallback: Use Cerebras for low-latency inference
    gs = _get_gemini_service()
    if settings.ENABLE_GEMINI_ANALYSIS and settings.GEMINI_API_KEY and gs:
        result = await gs.analyze_turn_cluster(
            cluster,
            conversation_id=str(conversation_id),
            user_id=str(user_id),
            model=settings.GEMINI_MODEL,
        )
    elif settings.USE_CEREBRAS and settings.CEREBRAS_API_KEY:
        result = await cerebras_service.analyze_turn_cluster(cluster, model=model)
    else:
        result = await cerebras_service.analyze_conversation(
            user_text=cluster[-1].get("user_text", ""),
            agent_response=cluster[-1].get("agent_text", ""),
            model=settings.CEREBRAS_MODEL,
        )
    logger.debug(
        "Cluster analysis detail",
        extra={"conversation_id": str(conversation_id), "analysis": result},
    )
    logger.info(
        "Cluster insight generated",
        extra={
            "conversation_id": str(conversation_id),
            "focus": result.get("error_category"),
            "note_type": result.get("note_type"),
            "priority": result.get("priority"),
            "guidance_preview": (result.get("guidance") or result.get("suggestion", ""))[:80],
        },
    )

    db_payload = {
        "note_type": result.get("note_type") or "CLUSTER",
        "priority": result.get("priority", 2),
        "error_category": result.get("error_category", "cluster_insight"),
        "suggestion": result.get("suggestion", result.get("guidance", "")),
    }

    with Session(engine) as session:
        save_learning_note(
            session=session,
            user_id=user_id,
            conversation_id=conversation_id,
            user_text=history_text,
            agent_context=cluster[-1].get("agent_text", ""),
            analysis=db_payload,
        )
        session.commit()

    if memory_session_id and db_payload["suggestion"]:
        await memory_service.put_turn_memory(
            session_id=memory_session_id,
            content=db_payload["suggestion"],
            timeline=settings.GUIDANCE_TIMELINE_NAME,
            agent="system",
        )
        logger.info(
            "Guidance stored to SmartMemory",
            extra={
                "conversation_id": str(conversation_id),
                "session_id": memory_session_id,
                "timeline": settings.GUIDANCE_TIMELINE_NAME,
            },
        )

    # Store adaptive recommendation for session summary and cross-session tracking
    if settings.ENABLE_ADAPTIVE_RECOMMENDATIONS:
        turn_count = redis_client.get(_get_turn_counter_key(conversation_id)) if redis_client else 0
        metadata = {
            "source": "gemini" if (settings.ENABLE_GEMINI_ANALYSIS and settings.GEMINI_API_KEY) else "cerebras",
            "pattern_detected": result.get("pattern_detected"),  # Gemini-specific
            "confidence": result.get("confidence"),  # Gemini-specific
        }
        save_adaptive_recommendation(
            conversation_id=conversation_id,
            user_id=user_id,
            recommendation=result.get("guidance", db_payload["suggestion"]),
            turn_number=int(turn_count) if turn_count else 0,
            metadata=metadata,
        )

    insights = _cluster_results.setdefault(conversation_id, [])
    insights.append({
        "focus": db_payload["error_category"],
        "priority": db_payload["priority"],
        "note_type": db_payload["note_type"],
        "suggestion": db_payload["suggestion"],
        "guidance": result.get("guidance", db_payload["suggestion"]),
    })
    if len(insights) > 5:
        _cluster_results[conversation_id] = insights[-5:]

    return {
        **db_payload,
        "guidance": result.get("guidance", db_payload["suggestion"]),
    }


def _build_guidance_payload(analysis: dict) -> dict:
    severity = analysis.get("priority", 2)
    severity_label = "high" if severity <= 1 else ("medium" if severity == 2 else "low")
    return {
        "focus": analysis.get("error_category", ""),
        "severity": severity_label,
        "instruction": analysis.get("guidance") or analysis.get("suggestion", ""),
        "note_type": analysis.get("note_type"),
    }


def get_recent_cluster_insights(conversation_id: uuid.UUID) -> List[dict]:
    return list(_cluster_results.get(conversation_id, []))


def clear_conversation_state(conversation_id: uuid.UUID) -> None:
    """Clears conversation state from Redis, local cache, and Gemini chat session."""
    if redis_client:
        transcript_key = _get_transcript_key(conversation_id)
        turn_counter_key = _get_turn_counter_key(conversation_id)
        redis_client.delete(transcript_key, turn_counter_key)

    _cluster_results.pop(conversation_id, None)

    # Clear Gemini chat session for this conversation
    gs = _get_gemini_service()
    if gs:
        gs.clear_conversation_session(str(conversation_id))

    logger.info(f"Cleared state for conversation {conversation_id}")


async def analyze_turn(
    user_text: str,
    agent_context: str,
    user_id: uuid.UUID,
    conversation_id: uuid.UUID,
    model: str,
) -> dict:
    """Legacy shim to support existing tests until they are migrated."""
    cluster = [{"user_text": user_text, "agent_text": agent_context}]
    return await _analyze_cluster(
        cluster,
        user_id=user_id,
        conversation_id=conversation_id,
        model=model,
        memory_session_id=None,
    )