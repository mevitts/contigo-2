import json
import uuid
from sqlmodel import SQLModel, create_engine, Session
from config.settings import settings
from config.logging_config import get_db_logger
from models.db_models import LearningNotes, SessionSummaries, NoteType

logger = get_db_logger()

DATABASE_URL = settings.database_url
logger.info(f"Using database: {'PostgreSQL' if 'postgresql' in DATABASE_URL else 'SQLite'}")
engine = create_engine(DATABASE_URL)


def _ensure_note_type_values() -> None:
    """Ensure the Postgres enum contains every value our tutors emit."""
    if "postgresql" not in DATABASE_URL.lower():
        return

    statements = [
        # Ensure pgcrypto extension is available and conversations.id has a UUID default
        """
        DO $$
        BEGIN
            -- Enable pgcrypto for gen_random_uuid if not already present
            IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pgcrypto') THEN
                CREATE EXTENSION pgcrypto;
            END IF;

            -- Make sure conversations.id gets a UUID by default for inserts that omit it
            BEGIN
                ALTER TABLE conversations
                    ALTER COLUMN id SET DEFAULT gen_random_uuid();
            EXCEPTION
                WHEN undefined_table OR undefined_column THEN
                    -- Table or column might not exist yet; safe to ignore here
                    NULL;
            END;
        END
        $$;
        """,
        # First, create the enum type if it doesn't exist
        """
        DO $$
        BEGIN
            IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'notetype') THEN
                CREATE TYPE notetype AS ENUM ('GRAMMAR', 'VOCAB', 'VOCABULARY', 'PRONUNCIATION', 'FLUENCY', 'TOPIC_MENTION', 'CLUSTER');
            END IF;
        END
        $$;
        """,
        # Then add any missing values (for backwards compatibility)
        """
        DO $$
        BEGIN
            IF NOT EXISTS (
                SELECT 1 FROM pg_type t
                JOIN pg_enum e ON t.oid = e.enumtypid
                WHERE t.typname = 'notetype' AND e.enumlabel = 'FLUENCY'
            ) THEN
                ALTER TYPE notetype ADD VALUE 'FLUENCY';
            END IF;
        END
        $$;
        """,
        """
        DO $$
        BEGIN
            IF NOT EXISTS (
                SELECT 1 FROM pg_type t
                JOIN pg_enum e ON t.oid = e.enumtypid
                WHERE t.typname = 'notetype' AND e.enumlabel = 'PRONUNCIATION'
            ) THEN
                ALTER TYPE notetype ADD VALUE 'PRONUNCIATION';
            END IF;
        END
        $$;
        """,
        """
        DO $$
        BEGIN
            IF NOT EXISTS (
                SELECT 1 FROM pg_type t
                JOIN pg_enum e ON t.oid = e.enumtypid
                WHERE t.typname = 'notetype' AND e.enumlabel = 'VOCABULARY'
            ) THEN
                ALTER TYPE notetype ADD VALUE 'VOCABULARY';
            END IF;
        END
        $$;
        """,
    ]

    with engine.connect().execution_options(isolation_level="AUTOCOMMIT") as connection:
        for statement in statements:
            try:
                connection.exec_driver_sql(statement)
            except Exception as exc:  # pragma: no cover - defensive
                logger.warning("Unable to extend notetype enum", extra={"error": str(exc)})
                break


_ensure_note_type_values()


def create_db_and_tables():
    logger.info("Creating database tables...")
    SQLModel.metadata.create_all(engine)
    logger.info("Database tables created successfully")

def get_session():
    with Session(engine) as session:
        yield session

def determine_starting_difficulty(
    session: Session,
    user_id: uuid.UUID
) -> str:
    """
    Determine difficulty level based on recent performance.
    Called BEFORE starting a new voice session (not during).

    Uses structured heuristics over the last 50 LearningNotes. We intentionally
    keep learners in A1/A2 style prompts longer by requiring both a minimum
    amount of data and consistently low-severity notes before promoting them.
    """
    from sqlmodel import select, desc

    statement = (
        select(LearningNotes)
        .where(LearningNotes.user_id == user_id)
        .order_by(desc(LearningNotes.timestamp))
        .limit(50)
    )
    recent_notes = list(session.exec(statement))

    if not recent_notes:
        logger.info("No learning notes yet; defaulting to beginner difficulty", extra={"user_id": str(user_id)})
        return "beginner"

    note_count = len(recent_notes)
    severe_priority_cutoff = settings.SEVERE_PRIORITY_CUTOFF
    severe_notes = [
        n for n in recent_notes
        if n.priority is not None and n.priority <= severe_priority_cutoff
    ]
    severe_rate = len(severe_notes) / note_count if note_count else 0.0

    if note_count < settings.MIN_NOTES_FOR_DIFFICULTY_ESCALATION:
        logger.info(
            "Locking learner in beginner due to limited history",
            extra={"user_id": str(user_id), "notes": note_count}
        )
        return "beginner"

    if severe_rate >= settings.BEGINNER_MAX_ERROR_RATE:
        logger.info(
            "Recent severe error rate keeps learner in beginner band",
            extra={"user_id": str(user_id), "error_rate": f"{severe_rate:.2f}"}
        )
        return "beginner"

    fluency_notes = [
        n for n in recent_notes
        if getattr(n, "note_type", None) == NoteType.FLUENCY
    ]

    if (
        len(fluency_notes) >= settings.MIN_FLUENCY_NOTES_FOR_PROMOTION
        and severe_rate <= settings.ADVANCED_PROMOTION_ERROR_RATE
    ):
        logger.info(
            "Promoting learner to advanced based on sustained fluency",
            extra={
                "user_id": str(user_id),
                "fluency_notes": len(fluency_notes),
                "error_rate": f"{severe_rate:.2f}",
            },
        )
        return "advanced"

    logger.info(
        "Assigning learner to intermediate band",
        extra={"user_id": str(user_id), "error_rate": f"{severe_rate:.2f}"}
    )
    return "intermediate"

def _normalize_note_type(raw_type: str | None) -> NoteType:
    label = (raw_type or "CLUSTER").strip().upper()
    try:
        return NoteType(label)
    except ValueError:
        # Accept legacy shorthand
        if label == "VOCABULARY":
            return NoteType.VOCABULARY
        if label == "VOCAB":
            return NoteType.VOCAB
        return NoteType.CLUSTER


def save_learning_note(
    session: Session,
    user_id: uuid.UUID,
    conversation_id: uuid.UUID,
    user_text: str,
    agent_context: str,
    analysis: dict
):
    logger.debug(f"Saving learning note for conversation {conversation_id}")
    note_type = _normalize_note_type(analysis.get("note_type"))
    learning_note = LearningNotes(
        user_id=user_id,
        conversation_id=conversation_id,
        user_text=user_text,
        agent_context=agent_context,
        note_type=note_type,
        priority=analysis["priority"],
        error_category=analysis["error_category"],
        suggestion=analysis["suggestion"],
    )
    session.add(learning_note)
    logger.info(
        "Learning note saved",
        extra={
            "note_type": note_type.value,
            "priority": analysis.get("priority"),
            "conversation_id": str(conversation_id),
        },
    )


def save_session_summary(
    session: Session,
    *,
    conversation_id: uuid.UUID,
    user_id: uuid.UUID,
    summary: str,
    highlights: dict,
    episodic_summary: str | None = None,
):
    record = SessionSummaries(
        conversation_id=conversation_id,
        user_id=user_id,
        summary=summary,
        highlights_json=json.dumps(highlights or {}),
        episodic_summary=episodic_summary,
    )
    session.add(record)
    logger.info("Session summary saved", extra={"conversation_id": str(conversation_id)})