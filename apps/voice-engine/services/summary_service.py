import logging
import uuid
from typing import Any, Dict, List, Optional

from sqlmodel import Session, select

from models.db_models import LearningNotes, SessionSummaries
from services.cerebras_service import cerebras_service
from services.db_service import engine, save_session_summary
from services.tutor_service import get_recent_recommendations
from config.settings import settings

logger = logging.getLogger(__name__)

# Gemini service for hackathon integration (lazy import)
gemini_service = None
def _get_gemini_service():
    global gemini_service
    if gemini_service is None:
        try:
            from services.gemini_service import gemini_service as _gs
            gemini_service = _gs
        except ImportError as e:
            logger.warning(f"Gemini service unavailable: {e}")
    return gemini_service


def _get_prior_session_summaries(user_id: uuid.UUID, limit: int = 3) -> List[Dict[str, Any]]:
    """Fetch prior session summaries for cross-session synthesis."""
    try:
        with Session(engine) as session:
            prior_summaries = session.exec(
                select(SessionSummaries)
                .where(SessionSummaries.user_id == user_id)
                .order_by(SessionSummaries.created_at.desc())
                .limit(limit)
            ).all()

            results = []
            for summary in prior_summaries:
                highlights = {}
                if summary.highlights_json:
                    import json
                    try:
                        highlights = json.loads(summary.highlights_json)
                    except json.JSONDecodeError:
                        pass

                results.append({
                    "overall_summary": summary.summary,
                    "learning_focus": highlights.get("learning_focus", []),
                    "topics": highlights.get("topics", []),
                })
            return results
    except Exception as exc:
        logger.warning(f"Failed to fetch prior summaries: {exc}")
        return []


async def generate_session_summary(
    *,
    conversation_id: uuid.UUID,
    user_id: uuid.UUID,
    transcript_entries: List[Dict[str, Any]],
    guidance_entries: List[Dict[str, Any]],
    session_language: Optional[str] = None,
) -> Dict[str, Any]:
    """Create and persist a structured session summary + highlights.

    Uses Gemini 3 with cross-session synthesis when available, falling back to Cerebras.
    """
    merged_transcript = transcript_entries + guidance_entries

    # Primary: Use Gemini 3 with cross-session synthesis (hackathon integration)
    # Fallback: Use Cerebras for summarization
    gs = _get_gemini_service()
    if settings.ENABLE_GEMINI_ANALYSIS and settings.GEMINI_API_KEY and gs:
        # Fetch prior session summaries for longitudinal insights
        prior_sessions = _get_prior_session_summaries(user_id, limit=3)

        summary_payload = await gs.summarize_session(
            transcript_entries=merged_transcript,
            user_id=str(user_id),
            prior_sessions=prior_sessions,
        )
        logger.info(
            "Session summary generated with Gemini 3",
            extra={
                "conversation_id": str(conversation_id),
                "prior_sessions_used": len(prior_sessions),
                "has_cross_session_insight": bool(summary_payload.get("cross_session_insight")),
            }
        )
    else:
        summary_payload = await cerebras_service.summarize_session(
            transcript_entries=merged_transcript,
        )

    localized_summary: Optional[Dict[str, str]] = None
    target_language = (session_language or "en").lower()
    base_summary = summary_payload.get("overall_summary", "")
    if target_language not in ("", "en") and base_summary:
        try:
            localized_text = await cerebras_service.translate_text(
                base_summary,
                target_language=target_language,
                source_language="en",
            )
            if localized_text and localized_text.strip().lower() != base_summary.strip().lower():
                localized_summary = {
                    "language": target_language,
                    "text": localized_text,
                }
        except Exception as exc:  # pragma: no cover - defensive
            logger.warning("Unable to localize session summary", extra={"error": str(exc)})

    # Get adaptive recommendations from Redis
    adaptive_recommendations: List[str] = []
    try:
        recommendations = get_recent_recommendations(conversation_id, limit=5)
        for rec in recommendations:
            turn = rec.get("turn", "?")
            text = rec.get("recommendation", "").strip()
            if text:
                adaptive_recommendations.append(f"Turn {turn}: {text}")
    except Exception as exc:
        logger.warning("Unable to fetch recommendations for summary", extra={"error": str(exc)})

    error_insights: List[str] = []
    with Session(engine) as session:
        learning_notes = session.exec(
            select(LearningNotes)
            .where(LearningNotes.conversation_id == conversation_id)
            .order_by(LearningNotes.priority, LearningNotes.timestamp.desc())
            .limit(3)
        ).all()

        for note in learning_notes:
            label = (note.error_category or note.note_type or "Insight").strip()
            detail = (note.suggestion or note.user_text or "").strip()
            if not detail:
                continue
            severity = f"P{note.priority}" if note.priority is not None else None
            prefix = f"[{severity}] {label}" if severity else label
            error_insights.append(f"{prefix}: {detail}")

    highlights = {
        "topics": summary_payload.get("topics", []),
        "notable_moments": summary_payload.get("notable_moments", []),
        "learning_focus": summary_payload.get("learning_focus", []),
        "personal_connections": summary_payload.get("personal_connections", []),
        "spanish_snippets": summary_payload.get("spanish_snippets", []),
        "error_insights": error_insights,
        "adaptive_recommendations": adaptive_recommendations,
    }
    if localized_summary:
        highlights["localized_summary"] = localized_summary
    # Add cross-session insight from Gemini 3 if available
    if summary_payload.get("cross_session_insight"):
        highlights["cross_session_insight"] = summary_payload["cross_session_insight"]

    with Session(engine) as session:
        save_session_summary(
            session,
            conversation_id=conversation_id,
            user_id=user_id,
            summary=summary_payload.get("overall_summary", ""),
            highlights=highlights,
        )
        session.commit()

    return {
        "overall_summary": summary_payload.get("overall_summary", ""),
        "localized_summary": localized_summary,
        **highlights,
    }
