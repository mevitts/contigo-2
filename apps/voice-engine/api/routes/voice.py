import asyncio
import logging
import uuid
import json
from datetime import datetime
from fastapi import APIRouter, WebSocket, WebSocketDisconnect, HTTPException, Depends, Query
from typing import Optional, Tuple, List, Dict
from pydantic import BaseModel
from services.elevenlabs_service import elevenlabs_service
from services.agent_service import agent_service
from services.session_service import session_service
from services.db_service import determine_starting_difficulty, engine
from services.cerebras_service import cerebras_service
from services.opus_translation_service import opus_translation_service
from services.summary_service import generate_session_summary
from services.tutor_service import get_user_insights_for_context, should_preactivate_soft_beginner
from sqlmodel import Session, select, desc, func
from models.db_models import LearningNotes, Conversations, SessionSummaries, UserReferences
from config.settings import settings
from config.agents import DifficultyLevel, get_difficulty_info
from api.auth import require_auth, validate_ws_token

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/voice", tags=["voice"])


class TranslationRequest(BaseModel):
    text: str
    target_language: Optional[str] = "en"


class AudioInterface:
    """Wrapper for WebSocket to match ElevenLabsService interface"""
    def __init__(self, ws: WebSocket):
        self.ws = ws


def _validate_user_id(user_id: str) -> uuid.UUID:
    """
    Validate and parse user ID.
    
    Args:
        user_id: String representation of UUID
        
    Returns:
        Parsed UUID object
        
    Raises:
        ValueError: If user_id format is invalid
    """
    try:
        return uuid.UUID(user_id)
    except ValueError:
        logger.error(f"Invalid user_id format: {user_id}")
        raise ValueError(f"Invalid user_id format: {user_id}")


def _derive_micro_adjustment(notes: list[LearningNotes], is_first_session: bool = False) -> str:
    """Return 'ease', 'steady', or 'challenge' based on recent learning notes."""
    if not notes:
        return "ease" if is_first_session else "steady"  # New users get "ease" instead of "steady"

    severe = 0
    confident = 0
    for note in notes:
        priority = getattr(note, "priority", None)
        note_type = getattr(note, "note_type", None)
        if priority is not None and priority <= 2:
            severe += 1
        if str(note_type).upper() == "FLUENCY" and (priority is None or priority >= 3):
            confident += 1

    total = len(notes)
    if total and severe / total >= 0.5:
        return "ease"
    if total and confident / total >= 0.5:
        return "challenge"
    return "steady"


def _fetch_last_conversation_context(user_id: uuid.UUID) -> Optional[dict]:
    """Return metadata + recent learning notes from the user's last finished conversation."""
    with Session(engine) as db_session:
        last_conversation = db_session.exec(
            select(Conversations)
            .where(Conversations.user_id == user_id)
            .where(Conversations.end_time != None)  # noqa: E711 - SQL comparison
            .order_by(desc(Conversations.end_time))
            .limit(1)
        ).first()

        if not last_conversation:
            return None

        summary_record = db_session.exec(
            select(SessionSummaries)
            .where(SessionSummaries.conversation_id == last_conversation.id)
            .order_by(desc(SessionSummaries.created_at))
            .limit(1)
        ).first()

        recent_notes = list(
            db_session.exec(
                select(LearningNotes)
                .where(LearningNotes.conversation_id == last_conversation.id)
                .order_by(desc(LearningNotes.timestamp))
                .limit(3)
            ).all()
        )

        note_highlights = [
            {
                "type": note.note_type,
                "category": note.error_category,
                "suggestion": note.suggestion,
                "priority": note.priority,
            }
            for note in recent_notes
        ]

        summary_text = None
        highlight_topics: list[str] = []
        highlight_notable: list[str] = []
        highlight_learning: list[str] = []
        highlight_personal: list[str] = []
        highlight_snippets: list[str] = []

        if summary_record:
            summary_text = (summary_record.summary or "").strip() or None
            try:
                highlight_blob = json.loads(summary_record.highlights_json or "{}")
            except json.JSONDecodeError:
                highlight_blob = {}

            def _string_list(value):
                return [str(item).strip() for item in value or [] if str(item).strip()]

            highlight_topics = _string_list(highlight_blob.get("topics"))
            highlight_notable = _string_list(highlight_blob.get("notable_moments"))
            highlight_learning = _string_list(highlight_blob.get("learning_focus"))
            highlight_personal = _string_list(highlight_blob.get("personal_connections"))
            snippet_entries = highlight_blob.get("spanish_snippets") or []
            for entry in snippet_entries:
                if isinstance(entry, dict):
                    spanish = (entry.get("spanish") or "").strip()
                    english = (entry.get("english") or "").strip()
                    context = (entry.get("context") or "").strip()
                    if not spanish:
                        continue
                    snippet_line = spanish
                    if english:
                        snippet_line = f"{snippet_line} ({english})"
                    if context:
                        snippet_line = f"{snippet_line} — {context}"
                    highlight_snippets.append(snippet_line)

        return {
            "conversation_id": str(last_conversation.id),
            "topic": last_conversation.topic,
            "ended_at": last_conversation.end_time,
            "note_highlights": note_highlights,
            "micro_adjustment": _derive_micro_adjustment(recent_notes),
            "summary_text": summary_text,
            "highlight_topics": highlight_topics,
            "highlight_notable": highlight_notable,
            "highlight_learning": highlight_learning,
            "highlight_personal": highlight_personal,
            "highlight_spanish": highlight_snippets,
        }


def _fetch_pinned_references(user_id: uuid.UUID, limit: int = 5) -> List[dict]:
    """Fetch user's pinned references for agent context."""
    with Session(engine) as db_session:
        pinned = list(
            db_session.exec(
                select(UserReferences)
                .where(UserReferences.user_id == user_id)
                .where(UserReferences.is_pinned == True)  # noqa: E712 - SQL comparison
                .order_by(desc(UserReferences.created_at))
                .limit(limit)
            ).all()
        )

        return [
            {
                "title": ref.title,
                "type": str(ref.reference_type.value) if hasattr(ref.reference_type, 'value') else str(ref.reference_type),
                "source": ref.source,
            }
            for ref in pinned
        ]


async def _collect_memory_breadcrumbs(user_id: uuid.UUID) -> List[str]:
    """Gather personal callbacks from Redis insights and stored summaries."""
    breadcrumbs: List[str] = []
    seen: set[str] = set()

    def _store(value: Optional[str]) -> None:
        normalized = (value or "").strip()
        if normalized and normalized not in seen:
            breadcrumbs.append(normalized)
            seen.add(normalized)

    # Get recent adaptive recommendations from Redis (cross-session insights)
    if settings.ENABLE_ADAPTIVE_RECOMMENDATIONS:
        try:
            redis_insights = get_user_insights_for_context(user_id, limit=3)
            for insight in redis_insights:
                _store(insight)
        except Exception as exc:
            logger.warning("Unable to fetch Redis insights", extra={"error": str(exc)})

    with Session(engine) as db_session:
        recent_summaries = db_session.exec(
            select(SessionSummaries)
            .where(SessionSummaries.user_id == user_id)
            .order_by(desc(SessionSummaries.created_at))
            .limit(5)
        ).all()

        for record in recent_summaries:
            try:
                highlights_blob = json.loads(record.highlights_json or "{}")
            except json.JSONDecodeError:
                continue

            personal_connections = highlights_blob.get("personal_connections") or []
            for detail in personal_connections:
                _store(detail)

            spanish_snippets = highlights_blob.get("spanish_snippets") or []
            for snippet in spanish_snippets:
                if isinstance(snippet, dict):
                    spanish = (snippet.get("spanish") or "").strip()
                    english = (snippet.get("english") or "").strip()
                    context = (snippet.get("context") or "").strip()
                    if not spanish:
                        continue
                    combined = spanish
                    if english:
                        combined = f"{combined} ({english})"
                    if context:
                        combined = f"{combined} — {context}"
                    _store(combined)

    return breadcrumbs[:7]  # Increased to accommodate Redis insights


def _fetch_active_weekly_article() -> Optional[dict]:
    """Fetch the active weekly spotlight article for agent context."""
    from services.article_service import get_active_spotlight
    return get_active_spotlight()


def _build_agent_custom_instructions(
    user_id: uuid.UUID,
    memory_snippets: Optional[List[str]] = None,
    extra_support: bool = False,
) -> Tuple[str, Optional[dict]]:
    """Generate persona + continuity instructions for the ElevenLabs agent."""
    continuity = _fetch_last_conversation_context(user_id)

    # Check if soft beginner mode should be pre-activated
    # Either from user's setting (extra_support) or from historical struggle detection
    historical_struggle = should_preactivate_soft_beginner(user_id)
    preactivate_soft = settings.ENABLE_SOFT_BEGINNER_MODE and (extra_support or historical_struggle)

    if extra_support:
        logger.info(
            "Extra support mode enabled by user setting",
            extra={"user_id": str(user_id), "preactivate_soft": preactivate_soft},
        )

    lines = [
        "Stay fully in-character as a warm, encouraging Spanish-speaking friend.",
        "Never mention or hint that you are an AI, model, recording, or synthetic voice.",
        "Use natural, colloquial Spanish. Keep the vibe relaxed like a buddy catching up.",
        "If the learner struggles or makes repeated mistakes (not just a one-off mistake, but on repeated occasions), explain them clearly and offer a quick example.",
        "Invite open conversation, ask follow-ups, and only correct when it helps them move forward.",
        "Match the learner's current difficulty band cadence, and immediately slow down and simplify if you notice a lot of hesitation.",
        "Treat each difficulty level as a sliding scale: gently press the challenge up or down inside that band based on our evaluations.",
    ]

    if continuity:
        ended_at = continuity.get("ended_at")
        human_date = ended_at.strftime("%B %d") if isinstance(ended_at, datetime) else "recently"
        topic = continuity.get("topic") or "a general conversation"
        lines.append(
            (
                "You have spoken with this learner before. The most recent session ended on "
                f"{human_date} and focused on {topic}."
            )
        )

        note_highlights = continuity.get("note_highlights") or []
        if note_highlights:
            note_summaries = ", ".join(
                f"{note['category'].lower()}" for note in note_highlights if note.get("category")
            )
            if note_summaries:
                lines.append(
                    "They've been working on these areas recently: " + note_summaries + ". Reinforce them naturally."
                )
            lines.append("When possible, weave in these recent corrections or goals:")
            for note in note_highlights[:3]:
                category_label = (note.get("category") or note.get("type") or "focus").lower()
                suggestion_text = (note.get("suggestion") or "").strip() or "Reforzar el concepto con un ejemplo sencillo."
                priority = note.get("priority")
                urgency = "priority " + str(priority) if priority is not None else ""
                detail = f"- {category_label}: {suggestion_text} {urgency}".rstrip()
                lines.append(detail)
        # Build specific conversation starter from personal callbacks and notable moments
        personal_callbacks = continuity.get("highlight_personal") or []
        notable_moments = continuity.get("highlight_notable") or []
        conversation_starters = personal_callbacks + notable_moments

        if conversation_starters:
            starter_example = conversation_starters[0]
            lines.append(
                f"IMPORTANT - Personalized Greeting: Instead of a generic 'Hola, ¿cómo estás?', open by referencing "
                f"something personal from last time. For example, you could ask about: '{starter_example}'. "
                "Make it feel like catching up with a friend who remembers details about their life."
            )
        else:
            lines.append(
                "Open with a fresh, personal greeting that acknowledges your shared history instead of a scripted intro."
            )

        summary_text = (continuity.get("summary_text") or "").strip()
        if summary_text:
            lines.append("Anchor your next steps in this learner-facing recap from last time:")
            lines.append(f"- {summary_text}")

        highlight_sections = {
            "Topics they covered": continuity.get("highlight_topics") or [],
            "Moments that stood out": continuity.get("highlight_notable") or [],
            "Learning focus areas": continuity.get("highlight_learning") or [],
            "Personal callbacks": continuity.get("highlight_personal") or [],
            "Spanish phrases worth reusing": continuity.get("highlight_spanish") or [],
        }
        for label, items in highlight_sections.items():
            trimmed_items = [entry for entry in items if entry]
            if not trimmed_items:
                continue
            lines.append(f"{label}:")
            for entry in trimmed_items[:3]:
                lines.append(f"- {entry}")

    # First-time users (no continuity) get "ease" instead of "steady" - be gentler with new learners
    micro_adjustment = continuity.get("micro_adjustment") if continuity else "ease"
    if micro_adjustment == "ease":
        lines.append(
            "The learner recently struggled; stay in beginner-friendly vocabulary, break answers into steps, and reassure them before requesting longer replies."
        )
    elif micro_adjustment == "challenge":
        lines.append(
            "The learner cruised through the last turns; gently increase pace and ask follow-ups that require fuller sentences within this level."
        )
    else:
        lines.append("Maintain the current difficulty band but keep nudging the learner with occasional stretch questions.")

    if memory_snippets:
        lines.append(
            "Keep calling back to personal details the learner has shared. When it fits, reference these memories:"
        )
        for snippet in memory_snippets:
            lines.append(f"- {snippet}")

    # Include user's pinned references for cultural context
    pinned_refs = _fetch_pinned_references(user_id, limit=5)
    if pinned_refs:
        lines.append(
            "\nThe learner has saved these cultural references to their library. "
            "If any naturally relate to the conversation, you can reference them:"
        )
        for ref in pinned_refs:
            ref_label = f"- {ref['title']}"
            if ref.get('source'):
                ref_label += f" by {ref['source']}"
            ref_label += f" ({ref['type'].lower()})"
            lines.append(ref_label)

    # Pre-activate soft beginner mode if user historically struggles
    if preactivate_soft:
        from config.agents import SOFT_BEGINNER_OVERLAY
        lines.append("\n## Soft Beginner Mode (Pre-Activated)")
        lines.append("This learner has struggled in past sessions. Start with simplified approach:")
        lines.extend(f"- {instruction}" for instruction in SOFT_BEGINNER_OVERLAY["instructions"])
        logger.warning(
            "[ADAPTIVE] === SOFT BEGINNER MODE PRE-ACTIVATED === User has history of struggling, starting simplified",
            extra={
                "user_id": str(user_id),
                "mode": "soft_beginner",
                "action": "pre_activated",
                "reason": "historical_struggle"
            }
        )

    # Inject weekly article context if available
    weekly_article = _fetch_active_weekly_article()
    if weekly_article:
        lines.append(
            "\n## Weekly Reading Spotlight"
        )
        lines.append(
            f"This week's featured article is \"{weekly_article['title']}\""
            + (f" by {weekly_article['author']}" if weekly_article.get("author") else "")
            + "."
        )
        if weekly_article.get("summary"):
            lines.append(f"Summary: {weekly_article['summary']}")
        if weekly_article.get("key_points"):
            points = weekly_article["key_points"][:3]
            lines.append("Key points: " + "; ".join(points))
        lines.append(
            "If the learner mentions the article or wants to discuss it, engage enthusiastically. "
            "Use vocabulary and themes from the article naturally in conversation when relevant."
        )

    lines.append("Keep the energy positive, collaborative, and human.")
    return "\n".join(lines), continuity


def _build_dynamic_variables_payload(
    user_id: uuid.UUID,
    conversation_id: Optional[uuid.UUID],
    difficulty: Optional[str],
    adaptive_enabled: bool,
    continuity_context: Optional[dict],
    memory_snippets: Optional[List[str]],
) -> Dict[str, object]:
    """Map runtime session data into ElevenLabs dynamic variables."""

    payload: Dict[str, object] = {
        "user_id": str(user_id),
        "conversation_id": str(conversation_id) if conversation_id else "",
        "difficulty": (difficulty or "") or "",
        "adaptive_enabled": bool(adaptive_enabled),
    }

    if continuity_context:
        topic = continuity_context.get("topic")
        if topic:
            payload["last_session_topic"] = topic

        ended_at = continuity_context.get("ended_at")
        if isinstance(ended_at, datetime):
            payload["last_session_ended_at"] = ended_at.isoformat()

        highlights = continuity_context.get("note_highlights") or []
        focus_chunks = []
        for note in highlights[:3]:
            label = (note.get("category") or note.get("type") or "focus").strip()
            suggestion = (note.get("suggestion") or "").strip()
            if label and suggestion:
                focus_chunks.append(f"{label}: {suggestion}")
            elif label:
                focus_chunks.append(label)
            elif suggestion:
                focus_chunks.append(suggestion)
        if focus_chunks:
            payload["recent_focus_summary"] = " | ".join(focus_chunks)

        micro_adjustment = continuity_context.get("micro_adjustment")
        if micro_adjustment:
            payload["micro_adjustment"] = micro_adjustment

        summary_text = (continuity_context.get("summary_text") or "").strip()
        if summary_text:
            payload["last_session_summary"] = summary_text

        def _stringify_list(values: Optional[list[str]], key: str):
            entries = [entry.strip() for entry in (values or []) if isinstance(entry, str) and entry.strip()]
            if entries:
                payload[key] = " | ".join(entries)

        _stringify_list(continuity_context.get("highlight_topics"), "highlight_topics")
        _stringify_list(continuity_context.get("highlight_notable"), "highlight_notable")
        _stringify_list(continuity_context.get("highlight_learning"), "highlight_learning")
        _stringify_list(continuity_context.get("highlight_personal"), "highlight_personal")
        _stringify_list(continuity_context.get("highlight_spanish"), "highlight_spanish")

    # Build a personalized greeting prompt from continuity data
    if continuity_context:
        personal_callbacks = continuity_context.get("highlight_personal") or []
        notable_moments = continuity_context.get("highlight_notable") or []
        starters = personal_callbacks + notable_moments
        topic = continuity_context.get("topic")
        if starters:
            payload["greeting_prompt"] = (
                f"Open by referencing something personal from last time: '{starters[0]}'. "
                "Make it feel like catching up with a friend who remembers them."
            )
        elif topic:
            payload["greeting_prompt"] = (
                f"Welcome them back warmly and reference your last conversation about '{topic}'."
            )
    if "greeting_prompt" not in payload:
        payload["greeting_prompt"] = (
            "This is a new learner you haven't met before. "
            "Introduce yourself warmly by name, welcome them, and ask a simple get-to-know-you question "
            "like what their name is, where they are from, or why they want to learn Spanish. "
            "Keep it short and friendly — one or two sentences max."
        )

    if memory_snippets:
        payload["memory_snippets"] = " | ".join(memory_snippets[:5])

    # Remove empty strings to keep payload tidy
    payload = {
        key: value
        for key, value in payload.items()
        if value not in (None, "")
    }

    return payload


def _select_agent(
    difficulty: DifficultyLevel,
    adaptive: Optional[bool],
    user_id: uuid.UUID,
    custom_instructions: Optional[str] = None,
):
    """
    Select appropriate agent based on difficulty level.
    
    Args:
        difficulty: Requested difficulty level or "auto"
        adaptive: Override for adaptive difficulty setting
        user_id: User ID for determining difficulty from DB
        
    Returns:
        Selected agent configuration
    """
    if difficulty == "auto":
        # Use DB-based difficulty determination
        with Session(engine) as db_session:
            inferred_difficulty = determine_starting_difficulty(db_session, user_id)

        logger.info(f"Auto-selected difficulty for user {user_id}: {inferred_difficulty}")
        return agent_service.get_agent(
            difficulty=inferred_difficulty,
            custom_instructions=custom_instructions,
            use_adaptive=adaptive
        ), inferred_difficulty
    else:
        # User manually selected difficulty
        return agent_service.get_agent(
            difficulty=difficulty,
            custom_instructions=custom_instructions,
            use_adaptive=adaptive
        ), difficulty


async def _validate_and_notify_agent(
    websocket: WebSocket,
    agent
) -> bool:
    """
    Validate agent configuration and notify client.
    
    Args:
        websocket: WebSocket connection to client
        agent: Agent to validate
        
    Returns:
        True if agent is valid, False otherwise
    """
    if not agent:
        logger.error("Agent not configured")
        await websocket.send_json({
            "type": "error",
            "message": "Spanish agent not configured"
        })
        await websocket.close(code=1008)
        return False
    
    if not agent_service.validate_agent_config(agent):
        logger.error("Spanish agent configuration invalid")
        await websocket.send_json({
            "type": "error",
            "message": "Agent configuration invalid"
        })
        await websocket.close(code=1008)
        return False
    
    return True


async def _handle_session_error(
    websocket: WebSocket,
    error: Exception,
    session = None
):
    """
    Handle errors during session by notifying client and cleaning up.
    
    Args:
        websocket: WebSocket connection
        error: Exception that occurred
        session: Session object to clean up (if exists)
    """
    logger.error(f"Error in voice session: {str(error)}", exc_info=True)
    try:
        await websocket.send_json({
            "type": "error",
            "message": "An unexpected session error occurred. Please try again."
        })
    except Exception:
        pass  # WebSocket may already be closed; nothing more to do
    finally:
        if session:
            session_service.end_session(session.conversation_id)

@router.websocket("/ws")
async def voice_session(
    websocket: WebSocket,
    token: str,  # Signed JWT from core-api session-token endpoint
    session_id: Optional[str] = None,
    difficulty: DifficultyLevel = "auto",
    model: Optional[str] = "gpt-4-turbo",
    adaptive: Optional[bool] = None,
    extra_support: Optional[bool] = None,
    user_id: Optional[str] = None,  # Deprecated — kept for backwards compat, ignored when token present
):
    """
    WebSocket endpoint for Spanish voice tutoring sessions.

    Requires a signed JWT ``token`` query parameter (issued by ``/v1/session-token``).
    The user identity is extracted from the token's ``sub`` claim.
    """
    # Validate JWT before accepting connection
    try:
        authenticated_user_id = validate_ws_token(token)
    except ValueError as auth_err:
        # Reject with 1008 (Policy Violation) before accepting
        await websocket.close(code=1008)
        logger.warning("WebSocket auth rejected", extra={"reason": str(auth_err)})
        return

    await websocket.accept()
    session = None
    conversation = None

    try:
        user_uuid = _validate_user_id(authenticated_user_id)

        loop = asyncio.get_running_loop()
        memory_breadcrumbs = await _collect_memory_breadcrumbs(user_uuid)
        persona_instructions, continuity_context = await loop.run_in_executor(
            None,
            lambda: _build_agent_custom_instructions(
                user_uuid,
                memory_snippets=memory_breadcrumbs,
                extra_support=extra_support or False,
            ),
        )
        instruction_preview = " ".join(persona_instructions.splitlines()[:5])[:240]

        # Context exchange logging (PII-safe: log counts/flags only, not content)
        if continuity_context:
            logger.info(
                "Session continuity context loaded",
                extra={
                    "user_id": str(user_uuid),
                    "has_topic": bool(continuity_context.get("topic")),
                    "personal_callback_count": len(continuity_context.get("highlight_personal", [])),
                    "notable_moment_count": len(continuity_context.get("highlight_notable", [])),
                    "micro_adjustment": continuity_context.get("micro_adjustment"),
                    "has_summary": bool(continuity_context.get("summary_text")),
                },
            )
        else:
            logger.info(
                "No previous session context - first-time user",
                extra={"user_id": str(user_uuid)},
            )

        logger.info(
            "ElevenLabs agent context prepared",
            extra={
                "user_id": str(user_uuid),
                "memory_snippet_count": len(memory_breadcrumbs),
                "instruction_length": len(persona_instructions),
            },
        )

        # Select and validate agent (also get effective difficulty)
        agent, effective_difficulty = _select_agent(
            difficulty,
            adaptive,
            user_uuid,
            custom_instructions=persona_instructions
        )
        if not await _validate_and_notify_agent(websocket, agent):
            return

        effective_adaptive = adaptive if adaptive is not None else settings.ENABLE_ADAPTIVE_DIFFICULTY
        continuity_topic = continuity_context.get("topic") if continuity_context else None
        continuity_ended_at_iso = None
        if continuity_context:
            ended_at_value = continuity_context.get("ended_at")
            if isinstance(ended_at_value, datetime):
                continuity_ended_at_iso = ended_at_value.isoformat()
        continuity_challenges = continuity_context.get("note_highlights") if continuity_context else None
        continuity_bias = continuity_context.get("micro_adjustment") if continuity_context else None

        # Create session
        session = session_service.create_session(
            user_id=user_uuid,
            agent_id=agent.agent_id,
            agent_name=agent.name,
            language=agent.language,
            model=model,
            custom_context={
                "difficulty": effective_difficulty,
                "adaptive": effective_adaptive,
                "lastSessionTopic": continuity_topic,
                "lastSessionEndedAt": continuity_ended_at_iso,
                "recentChallenges": continuity_challenges,
                "microAdjustment": continuity_bias,
            },
            conversation_id=session_id,
        )
        
        dynamic_variables = _build_dynamic_variables_payload(
            user_uuid,
            session.conversation_id,
            effective_difficulty,
            effective_adaptive,
            continuity_context,
            memory_breadcrumbs,
        )

        logger.info(f"Starting voice session {session.conversation_id}")
        
        # Notify client
        await websocket.send_json({
            "type": "session_created",
            "conversation_id": session.conversation_id,
            "agent_name": agent.name,
            "language": agent.language,
            "difficulty": effective_difficulty,
            "adaptive": effective_adaptive
        })
        
        # Start conversation
        audio_interface = AudioInterface(websocket)
        conversation = await elevenlabs_service.create_conversation(
            agent_id=agent.agent_id,
            audio_interface=audio_interface,
            conversation_id=session.conversation_id,
            api_key=agent.api_key or settings.elevenlabs_api_key,
            user_id=user_uuid,
            model=model,
            analysis_model=settings.ANALYSIS_MODEL or settings.CEREBRAS_MODEL,
            dynamic_variables=dynamic_variables,
        )
        
        # Enforce max session duration
        max_seconds = settings.MAX_SESSION_MINUTES * 60
        try:
            await asyncio.wait_for(conversation.start(), timeout=max_seconds)
        except asyncio.TimeoutError:
            logger.info(
                "Session timed out (max duration reached)",
                extra={"user_id": str(user_uuid), "max_minutes": settings.MAX_SESSION_MINUTES},
            )
            try:
                await websocket.send_json({
                    "type": "session_timeout",
                    "message": f"Session ended after {settings.MAX_SESSION_MINUTES} minutes.",
                })
            except Exception:
                pass

    except ValueError as e:
        logger.error(f"Validation error: {str(e)}")
        await websocket.close(code=1008)

    except WebSocketDisconnect:
        logger.info(f"WebSocket disconnected for user {authenticated_user_id}")
        if session:
            session_service.end_session(session.conversation_id)
    
    except Exception as e:
        await _handle_session_error(websocket, e, session)
    finally:
        # Build session summary from local transcript
        if conversation and session:
            try:
                local_artifacts = conversation.build_local_summary_artifacts()
                if local_artifacts:
                    conversation_uuid = (
                        session.conversation_id
                        if isinstance(session.conversation_id, uuid.UUID)
                        else uuid.UUID(str(session.conversation_id))
                    )
                    logger.info(
                        "Generating session summary from local transcript",
                        extra={
                            "conversation_id": str(conversation_uuid),
                            "transcript_count": len(local_artifacts.transcript),
                            "guidance_count": len(local_artifacts.guidance_entries),
                        },
                    )
                    await generate_session_summary(
                        conversation_id=conversation_uuid,
                        user_id=user_uuid,
                        transcript_entries=local_artifacts.transcript,
                        guidance_entries=local_artifacts.guidance_entries,
                        session_language=session.language,
                    )
                    logger.info(f"Session summary persisted for {conversation_uuid}")
            except Exception as exc:
                logger.error(
                    f"Failed to persist session summary: {exc}",
                    exc_info=True,
                    extra={"conversation_id": str(getattr(session, "conversation_id", "unknown"))},
                )

@router.get("/info")
async def get_agent_info():
    """Get information about the Spanish tutor agent"""
    return agent_service.get_agent_info()

@router.get("/difficulty-levels")
async def get_difficulty_levels():
    """Get information about all difficulty levels"""
    return {
        "levels": get_difficulty_info()
    }

@router.get("/sessions/active")
async def get_active_sessions(
    user_id: Optional[str] = None,
    auth_user_id: str = Depends(require_auth),
):
    """Get active voice sessions, optionally filtered by user"""
    # Users can only see their own sessions
    effective_user_id = auth_user_id
    if user_id:
        try:
            user_uuid = uuid.UUID(user_id)
        except ValueError:
            raise HTTPException(status_code=400, detail="Invalid user_id format")
        if str(user_uuid) != auth_user_id:
            raise HTTPException(status_code=403, detail="Access denied")
        effective_user_id = str(user_uuid)

    user_uuid = uuid.UUID(effective_user_id)
    sessions = session_service.list_active_sessions(user_uuid)

    return {
        "count": len(sessions),
        "sessions": [s.to_dict() for s in sessions]
    }

@router.get("/conversations/{conversation_id}")
async def get_conversation(
    conversation_id: str,
    auth_user_id: str = Depends(require_auth),
):
    """Get a specific conversation with metadata"""
    try:
        conv_uuid = uuid.UUID(conversation_id)
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid conversation_id format")
    
    from sqlmodel import select
    from models.db_models import Conversations
    
    with Session(engine) as session:
        conversation = session.exec(
            select(Conversations).where(Conversations.id == conv_uuid)
        ).first()
        
        if not conversation:
            raise HTTPException(status_code=404, detail="Conversation not found")

        # Ownership check
        if str(conversation.user_id) != auth_user_id:
            raise HTTPException(status_code=403, detail="Access denied")

        # Get note count
        note_count = session.exec(
            select(LearningNotes).where(LearningNotes.conversation_id == conv_uuid)
        ).all()
        
        topic = getattr(conversation, "topic", None)

        return {
            "id": str(conversation.id),
            "user_id": str(conversation.user_id),
            "start_time": conversation.start_time.isoformat() if conversation.start_time else None,
            "topic": topic,
            "agent_display_name": conversation.agent_display_name,
            "note_count": len(note_count)
        }


@router.get("/conversations/{conversation_id}/summary")
async def get_conversation_summary(
    conversation_id: str,
    auth_user_id: str = Depends(require_auth),
):
    """Return the most recent stored summary + highlights for a conversation."""
    try:
        conv_uuid = uuid.UUID(conversation_id)
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid conversation_id format")

    try:
        with Session(engine) as session:
            # First check if conversation exists
            conversation = session.exec(
                select(Conversations).where(Conversations.id == conv_uuid)
            ).first()

            if not conversation:
                logger.warning(f"Summary requested for non-existent conversation: {conversation_id}")
                raise HTTPException(status_code=404, detail="Conversation not found")

            # Ownership check
            if str(conversation.user_id) != auth_user_id:
                logger.warning(
                    "Summary ownership mismatch",
                    extra={
                        "conversation_id": conversation_id,
                        "conversation_user_id": str(conversation.user_id),
                        "auth_user_id": auth_user_id,
                    },
                )
                raise HTTPException(status_code=403, detail="Access denied")

            record = session.exec(
                select(SessionSummaries)
                .where(SessionSummaries.conversation_id == conv_uuid)
                .order_by(desc(SessionSummaries.created_at))
            ).first()

            if not record:
                # Check if session is still active (no end_time)
                if conversation.end_time is None:
                    logger.info(f"Summary requested for active session: {conversation_id}")
                    raise HTTPException(
                        status_code=202,
                        detail="Session still active - summary will be generated when session ends"
                    )
                # Session ended but summary not yet generated
                logger.info(f"Summary pending for completed session: {conversation_id}")
                raise HTTPException(
                    status_code=404,
                    detail="Summary is being generated - please retry in a few seconds"
                )

            try:
                parsed = json.loads(record.highlights_json or "{}")
            except json.JSONDecodeError:
                parsed = {}

            localized_summary = parsed.pop("localized_summary", None)
            highlights = {
                "topics": parsed.get("topics") or [],
                "notable_moments": parsed.get("notable_moments") or [],
                "learning_focus": parsed.get("learning_focus") or [],
                "personal_connections": parsed.get("personal_connections") or [],
                "spanish_snippets": parsed.get("spanish_snippets") or [],
                "error_insights": parsed.get("error_insights") or [],
                "adaptive_recommendations": parsed.get("adaptive_recommendations") or [],
            }

            return {
                "conversation_id": str(record.conversation_id),
                "created_at": record.created_at.isoformat(),
                "summary": record.summary,
                "highlights": highlights,
                "episodic_summary": record.episodic_summary,
                "localized_summary": localized_summary,
            }
    except HTTPException:
        raise
    except Exception as exc:
        logger.error(f"Database error fetching summary for {conversation_id}: {exc}", exc_info=True)
        raise HTTPException(
            status_code=503,
            detail="Database temporarily unavailable - please retry"
        )

@router.get("/conversations/{conversation_id}/analysis")
async def get_conversation_analysis(
    conversation_id: str,
    limit: Optional[int] = Query(default=50, ge=1, le=500),
    auth_user_id: str = Depends(require_auth),
):
    """Get learning notes (analysis) for a specific conversation"""
    try:
        conv_uuid = uuid.UUID(conversation_id)
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid conversation_id format")
    
    from sqlmodel import select, desc
    from models.db_models import Conversations
    
    with Session(engine) as session:
        # Verify conversation exists
        conversation = session.exec(
            select(Conversations).where(Conversations.id == conv_uuid)
        ).first()
        
        if not conversation:
            raise HTTPException(status_code=404, detail="Conversation not found")

        # Ownership check
        if str(conversation.user_id) != auth_user_id:
            raise HTTPException(status_code=403, detail="Access denied")

        # Get learning notes
        notes = session.exec(
            select(LearningNotes)
            .where(LearningNotes.conversation_id == conv_uuid)
            .order_by(desc(LearningNotes.timestamp))
            .limit(limit)
        ).all()
        
        return {
            "conversation_id": str(conv_uuid),
            "total_notes": len(notes),
            "notes": [
                {
                    "note_id": str(note.note_id),
                    "timestamp": note.timestamp.isoformat(),
                    "note_type": note.note_type,
                    "priority": note.priority,
                    "error_category": note.error_category,
                    "user_text": note.user_text,
                    "agent_context": note.agent_context,
                    "suggestion": note.suggestion
                }
                for note in notes
            ]
        }

@router.get("/users/{user_id}/conversations")
async def get_user_conversations(
    user_id: str,
    limit: Optional[int] = Query(default=10, ge=1, le=100),
    auth_user_id: str = Depends(require_auth),
):
    """Get all conversations for a specific user"""
    try:
        user_uuid = uuid.UUID(user_id)
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid user_id format")

    # Ownership check — users can only list their own conversations
    if str(user_uuid) != auth_user_id:
        raise HTTPException(status_code=403, detail="Access denied")
    
    from sqlmodel import select, desc, func
    from models.db_models import Conversations, LearningNotes
    
    with Session(engine) as session:
        conversations = session.exec(
            select(Conversations)
            .where(Conversations.user_id == user_uuid)
            .order_by(desc(Conversations.start_time))
            .limit(limit)
        ).all()
        
        result = []
        for conv in conversations:
            note_count = session.exec(
                select(func.count())
                .select_from(LearningNotes)
                .where(LearningNotes.conversation_id == conv.id)
            ).one()
            
            topic = getattr(conv, "topic", None)

            result.append({
                "id": str(conv.id),
                "created_at": conv.start_time.isoformat() if conv.start_time else None,
                "topic": topic,
                "language": conv.language,
                "agent_display_name": conv.agent_display_name,
                "note_count": note_count
            })
        
        return {
            "user_id": str(user_uuid),
            "total_conversations": len(result),
            "conversations": result
        }


@router.post("/translate")
async def translate_text(
    request: TranslationRequest,
    auth_user_id: str = Depends(require_auth),
):
    """
    Translate tutor text into the requested language for SOS help.

    Uses Helsinki-NLP OPUS-MT model for direct, literal translation.
    No LLM reasoning or rephrasing - just neural machine translation.
    """
    text = (request.text or "").strip()
    if not text:
        raise HTTPException(status_code=400, detail="Text is required for translation")

    target_language = request.target_language or "en"

    try:
        # Use OPUS-MT for direct, literal translation (no LLM)
        translation = await opus_translation_service.translate(
            text,
            target_language=target_language,
            source_language="es",
        )
    except ValueError as exc:
        # Unsupported language pair
        logger.warning(
            "Unsupported translation language pair",
            extra={"error": str(exc), "target_language": target_language},
        )
        raise HTTPException(
            status_code=400,
            detail=str(exc)
        ) from exc
    except RuntimeError as exc:
        logger.warning(
            "Translation model unavailable",
            extra={"error": str(exc), "target_language": target_language},
        )
        raise HTTPException(
            status_code=503,
            detail="Translation model unavailable. Please try again."
        ) from exc
    except Exception as exc:  # pragma: no cover - defensive fallback
        logger.error(
            "Translation failed",
            extra={"error": str(exc), "target_language": target_language},
        )
        raise HTTPException(status_code=502, detail="Translation service unavailable")

    return {"translation": translation, "target_language": target_language}

async def get_db_diagnostics():
    """Quick DB stats endpoint to verify connectivity from the Python service."""
    with Session(engine) as session:
        conversation_count = session.exec(
            select(func.count()).select_from(Conversations)
        ).one()

        note_count = session.exec(
            select(func.count()).select_from(LearningNotes)
        ).one()

        latest_conversation = session.exec(
            select(Conversations)
            .order_by(desc(Conversations.start_time))
            .limit(1)
        ).first()

        return {
            "conversation_count": conversation_count,
            "note_count": note_count,
            "latest_conversation": {
                "id": str(latest_conversation.id),
                "created_at": latest_conversation.start_time.isoformat() if latest_conversation.start_time else None,
                "user_id": str(latest_conversation.user_id),
                "topic": getattr(latest_conversation, "topic", None),
                "language": latest_conversation.language,
                "agent_display_name": latest_conversation.agent_display_name,
            } if latest_conversation else None
        }
