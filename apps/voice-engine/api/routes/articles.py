"""
Article Routes — Weekly Reading Spotlight

Endpoints for importing, viewing, and analyzing weekly articles.
"""
import logging
from typing import Optional
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from services.article_service import (
    import_article,
    get_active_spotlight,
    get_article_by_id,
    get_or_create_analysis,
)
from services.gemini_service import gemini_service

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/articles", tags=["articles"])


class ImportArticleRequest(BaseModel):
    url: str
    image_url: Optional[str] = None


class AnalyzeArticleRequest(BaseModel):
    user_id: str
    difficulty: Optional[str] = "intermediate"


@router.post("/import")
async def import_article_endpoint(request: ImportArticleRequest):
    """Import a Spanish article from URL for the weekly spotlight."""
    if not request.url or not request.url.strip():
        raise HTTPException(status_code=400, detail="URL is required")

    try:
        article = await import_article(
            url=request.url.strip(),
            gemini_service=gemini_service,
            image_url_override=request.image_url,
        )
        return {"article": article}
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    except Exception as exc:
        logger.error(f"Failed to import article: {exc}", exc_info=True)
        raise HTTPException(status_code=500, detail="Failed to import article")


@router.get("/spotlight")
async def get_spotlight():
    """Get the currently active weekly spotlight article."""
    article = get_active_spotlight()
    if not article:
        return {"article": None}
    return {"article": article}


@router.get("/{article_id}")
async def get_article(article_id: str):
    """Get full article details by ID."""
    article = get_article_by_id(article_id)
    if not article:
        raise HTTPException(status_code=404, detail="Article not found")
    return {"article": article}


@router.post("/{article_id}/analyze")
async def analyze_article(article_id: str, request: AnalyzeArticleRequest):
    """Get or generate a personalized analysis for a user + article."""
    if not request.user_id or not request.user_id.strip():
        raise HTTPException(status_code=400, detail="user_id is required")

    try:
        analysis = await get_or_create_analysis(
            article_id=article_id,
            user_id=request.user_id.strip(),
            gemini_service=gemini_service,
            user_difficulty=request.difficulty or "intermediate",
        )
        return {"analysis": analysis}
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc))
    except Exception as exc:
        logger.error(f"Failed to analyze article: {exc}", exc_info=True)
        raise HTTPException(status_code=500, detail="Failed to analyze article")
