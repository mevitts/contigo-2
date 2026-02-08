"""
Cerebras Inference Service

Handles ultra-low latency AI inference using Cerebras Cloud API.
Used for real-time conversation analysis with sub-second response times.

Rate Limits: Up to 1M tokens/day per model (hackathon tier)
Models: llama-3.3-70b, llama-3.1-70b, llama-3.1-8b
"""
import httpx
import logging
import json
import re
from typing import Dict, Any, List, Optional
from config.settings import settings
from services.opus_translation_service import opus_translation_service

logger = logging.getLogger(__name__)

_LANGUAGE_LABELS = {
    "en": "English",
    "es": "Spanish",
    "fr": "French",
    "de": "German",
    "it": "Italian",
    "pt": "Portuguese",
}


def _language_label(code: str) -> str:
    base = (code or "").split("-")[0].lower()
    return _LANGUAGE_LABELS.get(base, code.upper() or "TARGET LANGUAGE")


def _looks_untranslated(original: str, translated: str) -> bool:
    return translated.strip().lower() == original.strip().lower()


class CerebrasService:
    """Service for ultra-fast inference via Cerebras Cloud API."""

    BASE_URL = "https://api.cerebras.ai/v1/chat/completions"

    @staticmethod
    def _strip_reasoning_wrappers(content: str) -> str:
        """Remove hidden reasoning tags (e.g., <think>...</think>) from model output."""
        if "<think" not in content.lower():
            return content.strip()

        cleaned = re.sub(r"<think>.*?</think>", "", content, flags=re.IGNORECASE | re.DOTALL)
        # Handle streams that never closed the tag
        cleaned = re.sub(r"<think>.*", "", cleaned, flags=re.IGNORECASE | re.DOTALL)
        return cleaned.strip()
    
    def __init__(self, api_key: str = ""):
        """
        Initialize the Cerebras service.
        
        Args:
            api_key: Cerebras API key (defaults to settings)
        """
        self.api_key = api_key or settings.CEREBRAS_API_KEY
        
        if not self.api_key:
            logger.warning("CEREBRAS_API_KEY not configured - analysis will use fallback")
    
    async def _chat_request(
        self,
        *,
        system_prompt: str,
        user_prompt: str,
        model: str,
        timeout: float,
        temperature: float,
        max_tokens: int,
        response_format: Dict[str, str],
    ) -> str:
        async with httpx.AsyncClient(timeout=timeout) as client:
            try:
                response = await client.post(
                    self.BASE_URL,
                    headers={
                        "Authorization": f"Bearer {self.api_key}",
                        "Content-Type": "application/json",
                    },
                    json={
                        "model": model,
                        "messages": [
                            {"role": "system", "content": system_prompt},
                            {"role": "user", "content": user_prompt},
                        ],
                        "temperature": temperature,
                        "max_tokens": max_tokens,
                        "response_format": response_format,
                    },
                )
                response.raise_for_status()
            except httpx.HTTPStatusError as exc:
                body_preview = exc.response.text[:600] if exc.response else ""
                logger.error(
                    "Cerebras request failed",
                    extra={
                        "status_code": getattr(exc.response, "status_code", None),
                        "model": model,
                        "body": body_preview,
                    },
                )
                raise
            result = response.json()
            content = result["choices"][0]["message"]["content"]
            # Strip <think>...</think> reasoning blocks that some models emit
            content = re.sub(r"<think>.*?</think>", "", content, flags=re.DOTALL).strip()
            return content

    async def analyze_conversation(
        self,
        user_text: str,
        agent_response: str = "",
        model: str = "llama-3.3-70b",
        timeout: float = 5.0
    ) -> Dict[str, Any]:
        """
        Analyze a conversation turn for learning opportunities.
        
        Uses Cerebras ultra-low latency inference to provide real-time feedback
        on grammar, vocabulary, and conversation quality.
        
        Args:
            user_text: What the learner said in Spanish
            agent_response: What the tutor agent replied (optional context)
            model: Cerebras model to use (llama-3.3-70b recommended)
            timeout: Request timeout in seconds
            
        Returns:
            Dictionary containing:
            - note_type: Category (GRAMMAR, VOCABULARY, PRONUNCIATION, etc.)
            - priority: 1 (critical), 2 (important), 3 (minor)
            - error_category: Specific error type
            - suggestion: Corrected version or learning tip
            - explanation: Why this matters for learning
            
        Raises:
            httpx.HTTPStatusError: If the API returns an error
            httpx.RequestError: If the request fails
        """
        if not self.api_key:
            logger.warning("Cerebras API key not configured - returning mock analysis")
            return self._mock_analysis(user_text)
        
        system_prompt = """You are an expert Spanish language tutor analyzing student speech.

Analyze the student's Spanish and respond ONLY with valid JSON (no markdown, no explanation).

Format:
{
  "note_type": "GRAMMAR" | "VOCABULARY" | "PRONUNCIATION" | "FLUENCY",
  "priority": 1-3 (1=critical error, 2=important, 3=minor suggestion),
  "error_category": "specific error type (e.g., 'Preterite vs. Imperfect', 'Gender Agreement')",
  "suggestion": "corrected version or learning tip",
  "explanation": "why this matters for learning"
}

If the Spanish is perfect, return:
{
  "note_type": "FLUENCY",
  "priority": 3,
  "error_category": "Well done",
  "suggestion": "Great job! Natural and correct.",
  "explanation": "No errors detected."
}"""

        user_prompt = f"Student said: \"{user_text}\""
        if agent_response:
            user_prompt += f"\nTutor replied: \"{agent_response}\""
        
        try:
            content = await self._chat_request(
                system_prompt=system_prompt,
                user_prompt=user_prompt,
                model=model,
                timeout=timeout,
                temperature=0.1,
                max_tokens=300,
                response_format={"type": "json_object"},
            )
            analysis = json.loads(content)

            # Validate required fields
            required_fields = ["note_type", "priority", "error_category", "suggestion", "explanation"]
            if not all(field in analysis for field in required_fields):
                logger.error(f"Invalid Cerebras response schema: {analysis}")
                return self._mock_analysis(user_text)

            logger.info(f"Cerebras analysis completed for: {user_text[:50]}...")
            return analysis
                
        except httpx.HTTPStatusError as e:
            logger.error(f"Cerebras API error {e.response.status_code}: {e.response.text}")
            return self._mock_analysis(user_text)
        except httpx.RequestError as e:
            logger.error(f"Cerebras request failed: {e}")
            return self._mock_analysis(user_text)
        except (json.JSONDecodeError, KeyError) as e:
            logger.error(f"Failed to parse Cerebras response: {e}")
            return self._mock_analysis(user_text)
    
    async def analyze_turn_cluster(
        self,
        cluster_turns: List[Dict[str, str]],
        model: str = "llama-3.3-70b",
        timeout: float = 6.0,
    ) -> Dict[str, Any]:
        if not cluster_turns:
            raise ValueError("Cluster turns required for analysis")

        if not self.api_key:
            logger.warning("Cerebras API key missing for cluster analysis; returning mock")
            return self._mock_analysis(cluster_turns[-1].get("user_text", ""))

        history = "\n\n".join(
            f"Learner: {turn.get('user_text', '').strip()}\nTutor: {turn.get('agent_text', '').strip()}"
            for turn in cluster_turns
        )

        system_prompt = """You are monitoring a spoken Spanish tutoring session.
Identify repeated or emerging issues across the most recent turns and respond ONLY with valid JSON:
{
  "note_type": "CLUSTER" | "GRAMMAR" | "VOCAB" | "FLUENCY",
  "priority": 1-3,
  "error_category": "short label",
  "suggestion": "learner-facing practice tip — written directly TO the student, e.g. 'Try expanding beyond single-word answers into full sentences' NOT 'Encourage the learner to expand...' Combine related issues into one concise tip.",
  "guidance": "instruction for the tutor on how to adapt mid-session"
}
The 'suggestion' field is shown directly to the learner in their session summary, so write it as friendly advice TO them (second person). The 'guidance' field is for the tutor AI only.
Focus guidance on how the tutor should adjust speed, difficulty, or topic emphasis right now."""

        try:
            content = await self._chat_request(
                system_prompt=system_prompt,
                user_prompt=history,
                model=model,
                timeout=timeout,
                temperature=0.2,
                max_tokens=320,
                response_format={"type": "json_object"},
            )
            analysis = json.loads(content)
            required_fields = ["note_type", "priority", "error_category", "suggestion", "guidance"]
            if not all(field in analysis for field in required_fields):
                raise ValueError(f"Invalid cluster analysis schema: {analysis}")
            return analysis
        except Exception as exc:
            logger.error(f"Cluster analysis failed, falling back: {exc}")
            fallback = self._mock_analysis(cluster_turns[-1].get("user_text", ""))
            fallback["guidance"] = fallback["suggestion"]
            return fallback

    def _mock_analysis(self, user_text: str) -> Dict[str, Any]:
        """Fallback analysis that feels like a real tutor insight."""
        excerpt = (user_text or "").strip()[:70]
        if excerpt:
            excerpt += "..." if len(excerpt) == 70 else ""
        return {
            "note_type": "FLUENCY",
            "priority": 2,
            "error_category": "Pace & Confidence",
            "suggestion": (
                "Keep one complete sentence before pausing. Try rephrasing like: "
                f"\"{excerpt or 'Sí, me gusta practicar cada tarde.'}\" and focus on a steady tempo."
            ),
            "explanation": "Fallback guidance used when the real-time analyzer is unavailable."
        }

    async def _fallback_translate_local(
        self,
        text: str,
        source_language: str,
        target_language: str,
    ) -> Optional[str]:
        """Fallback to local OPUS-MT model for es->en translation."""
        # OPUS-MT only supports es->en
        if source_language != "es" or target_language != "en":
            logger.debug(
                f"Local OPUS fallback only supports es->en, got {source_language}->{target_language}"
            )
            return None
        try:
            translation = await opus_translation_service.translate(
                text,
                target_language=target_language,
                source_language=source_language,
            )
            return translation or None
        except ValueError as exc:
            logger.warning(
                "Local OPUS translation unsupported language pair",
                extra={"error": str(exc)},
            )
        except Exception as exc:  # pragma: no cover - defensive
            logger.warning(
                "Local OPUS translation failed unexpectedly",
                extra={"error": str(exc)},
            )
        return None

    async def translate_text(
        self,
        text: str,
        target_language: str = "en",
        source_language: str = "es",
        timeout: float = 5.0,
        fail_on_untranslated: bool = False,
    ) -> str:
        """Translate learner text using Cerebras (plain text output)."""
        cleaned = (text or "").strip()
        if not cleaned:
            return ""

        target_code = (target_language or "en").lower()
        source_code = (source_language or "es").lower()
        target_label = _language_label(target_code)

        async def _request_translation(strict: bool = False) -> str:
            system_prompt = (
                "You translate conversational Spanish into natural {target} with no extra commentary. "
                "Respond with plain text only."
            ).format(target=target_label)
            if strict:
                system_prompt += " Always rewrite the entire response in {target_label} even if the input already matches it.".format(
                    target_label=target_label
                )

            user_prompt = (
                f"Source ({source_code}): {cleaned}\n"
                f"Target ({target_code}):"
            )

            async with httpx.AsyncClient(timeout=timeout) as client:
                response = await client.post(
                    self.BASE_URL,
                    headers={
                        "Authorization": f"Bearer {self.api_key}",
                        "Content-Type": "application/json"
                    },
                    json={
                        "model": settings.CEREBRAS_MODEL,
                        "messages": [
                            {"role": "system", "content": system_prompt},
                            {"role": "user", "content": user_prompt}
                        ],
                        "temperature": 0.0,
                        "max_tokens": 200,
                        "response_format": {"type": "text"}
                    }
                )
                response.raise_for_status()
                result = response.json()
                content = result["choices"][0]["message"]["content"].strip()
                return self._strip_reasoning_wrappers(content)

        last_error: Optional[Exception] = None
        if not self.api_key:
            logger.warning("Cerebras translation unavailable - using fallback translator")
        try:
            if self.api_key:
                translation = await _request_translation()
                if _looks_untranslated(cleaned, translation):
                    logger.warning("Translation output matched source; retrying with stricter instructions")
                    translation = await _request_translation(strict=True)
                if _looks_untranslated(cleaned, translation):
                    raise RuntimeError("Cerebras returned untranslated text")
                return translation
        except Exception as exc:
            last_error = exc
            logger.error(f"Cerebras translation failed: {exc}")

        fallback = await self._fallback_translate_local(cleaned, source_code, target_code)
        if fallback and not _looks_untranslated(cleaned, fallback):
            return fallback

        if fail_on_untranslated:
            raise RuntimeError("Translation unavailable") from last_error

        return cleaned

    async def summarize_session(
        self,
        transcript_entries: List[Dict[str, Any]],
        model: Optional[str] = None,
        timeout: float = 10.0,
    ) -> Dict[str, Any]:
        """Generate structured session summary and highlights."""
        if not self.api_key:
            logger.warning("Cerebras unavailable for session summary; returning mock payload")
            return {
                "overall_summary": "Session summary unavailable.",
                "topics": [],
                "notable_moments": [],
                "learning_focus": [],
            }

        conversation_text = "\n".join(
            f"{entry.get('agent', 'system').title()}: {entry.get('content', '')}" for entry in transcript_entries
        )
        user_prompt = "Conversation transcript:\n" + conversation_text
        system_prompt = """You summarize Spanish tutoring sessions.
Return ONLY valid JSON:
{
    "overall_summary": "2-3 sentences in English",
    "topics": ["short topic bullets"],
    "notable_moments": ["funny or personal highlights"],
    "learning_focus": ["skills or errors still to practice"],
    "spanish_snippets": [
        {"spanish": "exact Spanish phrase they practiced", "english": "quick meaning", "context": "when it appeared"}
    ],
    "personal_connections": ["facts or preferences you must remember next time"]
}
Always include the Spanish phrases for any new vocabulary or preferences shared so the learner can re-read them."""

        try:
            content = await self._chat_request(
                system_prompt=system_prompt,
                user_prompt=user_prompt,
                model=model or settings.SESSION_SUMMARY_MODEL,
                timeout=timeout,
                temperature=0.2,
                max_tokens=1200,  # Increased from 500 to prevent JSON truncation
                response_format={"type": "json_object"},
            )
            return json.loads(content)
        except Exception as exc:
            logger.error(f"Session summarization failed: {exc}")
            return {
                "overall_summary": "Summary unavailable due to AI error.",
                "topics": [],
                "notable_moments": [],
                "learning_focus": [],
                "spanish_snippets": [],
                "personal_connections": [],
            }
    
    async def assess_difficulty(
        self,
        conversation_history: list[Dict[str, str]],
        current_difficulty: str,
        model: str = "llama-3.3-70b"
    ) -> Dict[str, Any]:
        """
        Assess if learner should move to different difficulty level.
        
        This is a heavier analysis using conversation patterns over time,
        so it's only called periodically (not every turn).
        
        Args:
            conversation_history: List of {"user": "...", "agent": "..."} dicts
            current_difficulty: Current level (beginner, intermediate, advanced)
            model: Cerebras model to use
            
        Returns:
            Dictionary with:
            - recommended_difficulty: beginner | intermediate | advanced
            - confidence: 0.0-1.0 confidence score
            - reasoning: Why this recommendation was made
        """
        if not self.api_key:
            logger.warning("Cerebras not configured - keeping current difficulty")
            return {
                "recommended_difficulty": current_difficulty,
                "confidence": 0.0,
                "reasoning": "Cerebras API not available for assessment"
            }
        
        system_prompt = """You are a Spanish language proficiency assessor.

Analyze the conversation history and determine if the student should change difficulty levels.

Respond ONLY with valid JSON:
{
  "recommended_difficulty": "beginner" | "intermediate" | "advanced",
  "confidence": 0.0-1.0,
  "reasoning": "brief explanation of why"
}

Criteria:
- Beginner: Frequent grammar errors, simple sentences, limited vocabulary
- Intermediate: Occasional errors, can maintain conversation, growing vocabulary
- Advanced: Rare errors, complex sentences, idiomatic expressions, near-native fluency"""

        # Format conversation history
        history_text = "\n".join([
            f"Student: {turn.get('user', '')}\nTutor: {turn.get('agent', '')}"
            for turn in conversation_history[-10:]  # Last 10 turns
        ])
        
        user_prompt = f"Current level: {current_difficulty}\n\nRecent conversation:\n{history_text}"
        
        try:
            async with httpx.AsyncClient(timeout=10.0) as client:
                response = await client.post(
                    self.BASE_URL,
                    headers={
                        "Authorization": f"Bearer {self.api_key}",
                        "Content-Type": "application/json"
                    },
                    json={
                        "model": model,
                        "messages": [
                            {"role": "system", "content": system_prompt},
                            {"role": "user", "content": user_prompt}
                        ],
                        "temperature": 0.2,
                        "max_tokens": 200,
                        "response_format": {"type": "json_object"}
                    }
                )
                response.raise_for_status()
                
                result = response.json()
                content = result["choices"][0]["message"]["content"]
                return json.loads(content)
                
        except Exception as e:
            logger.error(f"Difficulty assessment failed: {e}")
            return {
                "recommended_difficulty": current_difficulty,
                "confidence": 0.0,
                "reasoning": f"Assessment error: {str(e)}"
            }

    async def detect_references(
        self,
        agent_text: str,
        user_text: str = "",
        model: str = "llama-3.3-70b",
        timeout: float = 5.0
    ) -> Dict[str, Any]:
        """
        Detect cultural references, songs, and other saveable content in conversation.

        Fallback detection using Cerebras when Gemini is unavailable.

        Args:
            agent_text: What the tutor agent said
            user_text: What the learner said (optional context)
            model: Cerebras model to use
            timeout: Request timeout in seconds

        Returns:
            Dictionary containing:
            - detected: bool - whether any references were found
            - references: list of {title, type, source, context, confidence}
        """
        if not self.api_key:
            logger.warning("Cerebras API key not configured - skipping reference detection")
            return {"detected": False, "references": []}

        system_prompt = """You detect cultural references, songs, books, and other content worth saving from Spanish tutoring conversations.

Look for:
- Songs mentioned or lyrics discussed
- Book/article excerpts or quotes
- Cultural references (holidays, traditions, idioms explained)
- Videos or media recommendations
- Artists, authors, or cultural figures discussed

Respond ONLY with valid JSON:
{
  "detected": true | false,
  "references": [
    {
      "title": "name of song/book/reference",
      "type": "SONG" | "LYRICS" | "ARTICLE" | "VIDEO" | "BOOK_EXCERPT" | "CULTURAL" | "OTHER",
      "source": "artist/author/origin if known",
      "context": "brief description of how it came up",
      "confidence": 0.0-1.0
    }
  ]
}

Only include references with confidence >= 0.7.
If no clear references are found, return {"detected": false, "references": []}."""

        user_prompt = f"Tutor said: \"{agent_text}\""
        if user_text:
            user_prompt += f"\nLearner said: \"{user_text}\""

        try:
            content = await self._chat_request(
                system_prompt=system_prompt,
                user_prompt=user_prompt,
                model=model,
                timeout=timeout,
                temperature=0.1,
                max_tokens=400,
                response_format={"type": "json_object"},
            )
            result = json.loads(content)

            # Filter by confidence threshold
            threshold = settings.REFERENCE_DETECTION_CONFIDENCE_THRESHOLD
            if result.get("references"):
                result["references"] = [
                    ref for ref in result["references"]
                    if ref.get("confidence", 0) >= threshold
                ]
                result["detected"] = len(result["references"]) > 0

            logger.info(f"Cerebras reference detection: {len(result.get('references', []))} references found")
            return result

        except Exception as exc:
            logger.error(f"Cerebras reference detection failed: {exc}")
            return {"detected": False, "references": []}


cerebras_service = CerebrasService()
