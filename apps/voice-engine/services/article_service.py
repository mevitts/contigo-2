"""
Article Service — Weekly Reading Spotlight

Handles importing, parsing, and analyzing Spanish articles
for the Weekly Reading Spotlight feature.
"""
import json
import logging
import uuid
from datetime import datetime, timedelta
from typing import Any, Dict, Optional

import trafilatura
from sqlmodel import Session, select, desc

from models.db_models import WeeklyArticles, UserArticleAnalyses
from services.db_service import engine

logger = logging.getLogger(__name__)


def fetch_and_parse(url: str) -> Dict[str, Any]:
    """
    Fetch and extract article content from a URL using trafilatura.

    Returns:
        Dictionary with title, author, content_text, source_name, image_url
    """
    downloaded = trafilatura.fetch_url(url)
    if not downloaded:
        raise ValueError(f"Could not fetch URL: {url}")

    content = trafilatura.extract(
        downloaded,
        include_comments=False,
        include_tables=False,
        favor_precision=True,
    )

    if not content or len(content.strip()) < 100:
        raise ValueError("Article content too short or could not be extracted")

    metadata = trafilatura.extract(
        downloaded,
        include_comments=False,
        output_format="json",
    )

    meta = {}
    if metadata:
        try:
            meta = json.loads(metadata) if isinstance(metadata, str) else metadata
        except (json.JSONDecodeError, TypeError):
            pass

    title = meta.get("title") or "Untitled Article"
    author = meta.get("author") or None
    source_name = meta.get("sitename") or None
    image_url = meta.get("image") or None

    return {
        "title": title,
        "author": author,
        "content_text": content,
        "source_name": source_name,
        "image_url": image_url,
    }


async def import_article(
    url: str,
    gemini_service,
    image_url_override: Optional[str] = None,
) -> Dict[str, Any]:
    """
    Full import flow: fetch, parse, summarize via Gemini, store in DB.

    Returns:
        Dictionary with the created article's data.
    """
    parsed = fetch_and_parse(url)

    # Generate summary and key points via Gemini
    summary_data = await gemini_service.generate_article_summary(
        title=parsed["title"],
        content_text=parsed["content_text"],
    )

    # Deactivate any currently active articles
    with Session(engine) as db_session:
        active_articles = db_session.exec(
            select(WeeklyArticles).where(WeeklyArticles.is_active == True)  # noqa: E712
        ).all()
        for article in active_articles:
            article.is_active = False
            db_session.add(article)
        db_session.commit()

    now = datetime.utcnow()
    # Calculate week_end: 7 days from now
    week_end = now + timedelta(days=7)

    new_article = WeeklyArticles(
        id=uuid.uuid4(),
        url=url,
        title=parsed["title"],
        author=parsed["author"],
        source_name=parsed["source_name"],
        content_text=parsed["content_text"],
        summary=summary_data.get("summary"),
        key_points=json.dumps(summary_data.get("key_points", [])),
        image_url=image_url_override or parsed.get("image_url"),
        difficulty_level=summary_data.get("difficulty_level", "intermediate"),
        tags=json.dumps(summary_data.get("tags", [])),
        is_active=True,
        week_start=now,
        week_end=week_end,
        created_at=now,
    )

    with Session(engine) as db_session:
        db_session.add(new_article)
        db_session.commit()
        db_session.refresh(new_article)

    logger.info(f"Imported weekly article: {new_article.title} (id={new_article.id})")

    return _article_to_dict(new_article)


def get_active_spotlight() -> Optional[Dict[str, Any]]:
    """Get the currently active weekly article."""
    with Session(engine) as db_session:
        article = db_session.exec(
            select(WeeklyArticles)
            .where(WeeklyArticles.is_active == True)  # noqa: E712
            .order_by(desc(WeeklyArticles.created_at))
            .limit(1)
        ).first()

        if not article:
            return None

        return _article_to_dict(article)


def get_article_by_id(article_id: str) -> Optional[Dict[str, Any]]:
    """Get a single article by ID, including full content."""
    try:
        article_uuid = uuid.UUID(article_id)
    except ValueError:
        return None

    with Session(engine) as db_session:
        article = db_session.exec(
            select(WeeklyArticles).where(WeeklyArticles.id == article_uuid)
        ).first()

        if not article:
            return None

        return _article_to_dict(article, include_content=True)


async def get_or_create_analysis(
    article_id: str,
    user_id: str,
    gemini_service,
    user_difficulty: str = "intermediate",
) -> Dict[str, Any]:
    """
    Get cached analysis or generate a new one for user + article.

    Returns:
        Dictionary with vocab_items, grammar_patterns, cultural_notes, personalized_tips
    """
    article_uuid = uuid.UUID(article_id)
    user_uuid = uuid.UUID(user_id)

    # Check for existing analysis
    with Session(engine) as db_session:
        existing = db_session.exec(
            select(UserArticleAnalyses)
            .where(UserArticleAnalyses.article_id == article_uuid)
            .where(UserArticleAnalyses.user_id == user_uuid)
        ).first()

        if existing:
            return {
                "id": str(existing.id),
                "article_id": str(existing.article_id),
                "user_id": str(existing.user_id),
                "vocab_items": _safe_json_parse(existing.vocab_items, []),
                "grammar_patterns": _safe_json_parse(existing.grammar_patterns, []),
                "cultural_notes": _safe_json_parse(existing.cultural_notes, []),
                "personalized_tips": _safe_json_parse(existing.personalized_tips, []),
                "created_at": existing.created_at.isoformat(),
            }

    # Fetch article content for analysis
    with Session(engine) as db_session:
        article = db_session.exec(
            select(WeeklyArticles).where(WeeklyArticles.id == article_uuid)
        ).first()

        if not article:
            raise ValueError(f"Article {article_id} not found")

        title = article.title
        content_text = article.content_text

    # Generate analysis via Gemini
    analysis = await gemini_service.analyze_article_for_user(
        title=title,
        content_text=content_text,
        user_difficulty=user_difficulty,
    )

    # Store the analysis
    new_analysis = UserArticleAnalyses(
        id=uuid.uuid4(),
        article_id=article_uuid,
        user_id=user_uuid,
        vocab_items=json.dumps(analysis.get("vocab_items", [])),
        grammar_patterns=json.dumps(analysis.get("grammar_patterns", [])),
        cultural_notes=json.dumps(analysis.get("cultural_notes", [])),
        personalized_tips=json.dumps(analysis.get("personalized_tips", [])),
        created_at=datetime.utcnow(),
    )

    with Session(engine) as db_session:
        db_session.add(new_analysis)
        db_session.commit()
        db_session.refresh(new_analysis)

    logger.info(f"Generated article analysis for user {user_id} on article {article_id}")

    return {
        "id": str(new_analysis.id),
        "article_id": str(new_analysis.article_id),
        "user_id": str(new_analysis.user_id),
        "vocab_items": analysis.get("vocab_items", []),
        "grammar_patterns": analysis.get("grammar_patterns", []),
        "cultural_notes": analysis.get("cultural_notes", []),
        "personalized_tips": analysis.get("personalized_tips", []),
        "created_at": new_analysis.created_at.isoformat(),
    }


def _article_to_dict(article: WeeklyArticles, include_content: bool = False) -> Dict[str, Any]:
    """Convert a WeeklyArticles model to a dict for API responses."""
    data = {
        "id": str(article.id),
        "url": article.url,
        "title": article.title,
        "author": article.author,
        "source_name": article.source_name,
        "summary": article.summary,
        "key_points": _safe_json_parse(article.key_points, []),
        "image_url": article.image_url,
        "difficulty_level": article.difficulty_level,
        "tags": _safe_json_parse(article.tags, []),
        "is_active": article.is_active,
        "week_start": article.week_start.isoformat() if article.week_start else None,
        "week_end": article.week_end.isoformat() if article.week_end else None,
        "created_at": article.created_at.isoformat() if article.created_at else None,
    }

    if include_content:
        data["content_text"] = article.content_text

    return data


def _safe_json_parse(value: Optional[str], default: Any) -> Any:
    """Safely parse a JSON string, returning default on failure."""
    if not value:
        return default
    try:
        return json.loads(value)
    except (json.JSONDecodeError, TypeError):
        return default
