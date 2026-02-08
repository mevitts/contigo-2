"""
Gemini 3 Inference Service

Handles AI inference using Google's Gemini 3 API with Thought Signatures
for reasoning continuity across multi-turn conversations and sessions.

Key Features:
- Thought Signatures: Maintains reasoning context across conversation turns
- Thinking Levels: Adaptive reasoning depth (low, medium, high)
- 1M Token Context: Supports full session history analysis
- Structured Outputs: JSON response parsing for learning analytics
- Cross-Session Persistence: Redis-backed thought signature storage

Hackathon: Google DeepMind Gemini 3 Hackathon
"""
import logging
import json
import re
import redis
from typing import Dict, Any, List, Optional
from config.settings import settings

logger = logging.getLogger(__name__)

# Will be imported when SDK is available
genai = None
types = None

# Redis client for cross-session thought signature persistence
_redis_client = None
THOUGHT_SIGNATURE_TTL = 30 * 24 * 3600  # 30 days


def _get_redis_client():
    """Get or create Redis client for thought signature storage."""
    global _redis_client
    if _redis_client is None:
        try:
            _redis_client = redis.from_url(settings.REDIS_URL, decode_responses=True)
            _redis_client.ping()
            logger.info("Gemini service connected to Redis for thought signature persistence")
        except redis.exceptions.ConnectionError as e:
            logger.warning(f"Redis unavailable for thought signatures: {e}")
            _redis_client = False  # Mark as unavailable
    return _redis_client if _redis_client else None


def _get_thought_signature_key(user_id: str) -> str:
    """Redis key for user's thought signature."""
    return f"gemini_thought_signature:{user_id}"


def _init_genai():
    """Lazy initialization of the Gemini SDK."""
    global genai, types
    if genai is None:
        try:
            from google import genai as _genai
            from google.genai import types as _types
            genai = _genai
            types = _types
            logger.info("Gemini SDK initialized successfully")
        except ImportError as e:
            logger.error(f"Failed to import google-genai: {e}")
            raise


class GeminiService:
    """
    Service for Gemini 3 inference with Thought Signature continuity.

    Thought Signatures preserve the model's reasoning state across:
    - Multi-turn conversations (within session)
    - Cross-session learning patterns (across days/weeks)
    - Adaptive difficulty orchestration (autonomous agent decisions)
    """

    # Thinking level mapping
    THINKING_LEVELS = {
        "low": "LOW",
        "medium": "MEDIUM",
        "high": "HIGH",
        "minimal": "MINIMAL",
    }

    def __init__(self, api_key: str = ""):
        """
        Initialize the Gemini service.

        Args:
            api_key: Gemini API key (defaults to settings)
        """
        self.api_key = api_key or settings.GEMINI_API_KEY
        self._client = None
        self._chat_sessions: Dict[str, Any] = {}  # Conversation ID -> Chat session
        self._thought_signatures: Dict[str, str] = {}  # User ID -> Last thought signature

        if not self.api_key:
            logger.warning("GEMINI_API_KEY not configured - analysis will use fallback")

    def _get_client(self):
        """Get or create the Gemini client."""
        if self._client is None and self.api_key:
            _init_genai()
            self._client = genai.Client(api_key=self.api_key)
        return self._client

    def _get_thinking_config(self, level: str = None):
        """Get thinking configuration based on level."""
        level = level or settings.GEMINI_THINKING_LEVEL
        level_enum = self.THINKING_LEVELS.get(level.lower(), "MEDIUM")

        _init_genai()
        if hasattr(types, "ThinkingLevel"):
            return types.ThinkingConfig(
                thinking_level=getattr(types.ThinkingLevel, level_enum)
            )
        # Fallback for older SDK versions without ThinkingLevel enum
        budget_map = {"MINIMAL": 1024, "LOW": 2048, "MEDIUM": 4096, "HIGH": 8192}
        return types.ThinkingConfig(thinking_budget=budget_map.get(level_enum, 4096))

    def _get_or_create_chat(self, conversation_id: str, system_instruction: str = None):
        """Get or create a chat session for continuity."""
        if conversation_id not in self._chat_sessions:
            client = self._get_client()
            if client is None:
                return None

            model = settings.GEMINI_MODEL
            config = {
                "thinking_config": self._get_thinking_config(),
                "response_mime_type": "application/json",
            }
            if system_instruction:
                config["system_instruction"] = system_instruction

            self._chat_sessions[conversation_id] = client.chats.create(
                model=model,
                config=types.GenerateContentConfig(**config)
            )
        return self._chat_sessions[conversation_id]

    async def analyze_turn_cluster(
        self,
        cluster_turns: List[Dict[str, str]],
        conversation_id: str = None,
        user_id: str = None,
        model: str = None,
        timeout: float = 6.0,
    ) -> Dict[str, Any]:
        """
        Analyze a cluster of conversation turns using Gemini 3 with Thought Signatures.

        The Thought Signature maintains reasoning continuity, so the model remembers
        "why the learner struggled" across turns and can reference earlier context.

        Args:
            cluster_turns: List of {"user_text": "...", "agent_text": "..."} dicts
            conversation_id: ID for chat session continuity
            user_id: User ID for cross-session signature storage
            model: Model to use (defaults to settings)
            timeout: Request timeout in seconds

        Returns:
            Dictionary containing:
            - note_type: CLUSTER | GRAMMAR | VOCAB | FLUENCY
            - priority: 1-3 priority level
            - error_category: Short label for the issue
            - suggestion: Learner-facing practice tip (shown in session summary)
            - guidance: Instruction for tutor adaptation
            - thought_summary: Summary of model's reasoning (if available)
        """
        if not cluster_turns:
            raise ValueError("Cluster turns required for analysis")

        if not self.api_key:
            logger.warning("Gemini API key missing for cluster analysis; returning mock")
            return self._mock_cluster_analysis(cluster_turns[-1].get("user_text", ""))

        # Format conversation history
        history = "\n\n".join(
            f"Learner: {turn.get('user_text', '').strip()}\nTutor: {turn.get('agent_text', '').strip()}"
            for turn in cluster_turns
        )

        # Include prior session context if available (cross-session continuity)
        prior_context = ""
        prior_signature = self.get_user_thought_signature(user_id) if user_id else None
        if prior_signature:
            prior_context = f"\n[Prior session context: {prior_signature}]\n\n"

        system_prompt = """You are monitoring a spoken Spanish tutoring session.
Identify repeated or emerging issues across the most recent turns.

IMPORTANT: Reference earlier turns when relevant. For example, "You're still mixing up ser/estar like in turn 2" instead of treating each analysis in isolation.

Respond ONLY with valid JSON:
{
  "note_type": "CLUSTER" | "GRAMMAR" | "VOCAB" | "FLUENCY",
  "priority": 1-3,
  "error_category": "short label",
  "suggestion": "learner-facing practice tip — written directly TO the student, e.g. 'Try expanding beyond single-word answers into full sentences' NOT 'Encourage the learner to expand...' Combine related issues into one concise tip. Use a concrete example from the session when possible.",
  "guidance": "instruction for the tutor on how to adapt mid-session",
  "pattern_detected": "description of any recurring pattern across turns",
  "confidence": 0.0-1.0
}

The 'suggestion' field is shown directly to the learner in their session summary, so write it as friendly advice TO them (second person). The 'guidance' field is for the tutor AI only.
Focus guidance on how the tutor should adjust speed, difficulty, or topic emphasis right now."""

        try:
            client = self._get_client()
            if client is None:
                return self._mock_cluster_analysis(cluster_turns[-1].get("user_text", ""))

            response = await self._async_generate(
                client=client,
                model=model or settings.GEMINI_MODEL,
                contents=prior_context + history,
                system_instruction=system_prompt,
                thinking_level="medium",
            )

            analysis = self._parse_json_response(response.text)

            # Track thought summary for cross-session continuity (persisted to Redis)
            if user_id and analysis.get("pattern_detected"):
                self.set_user_thought_signature(user_id, analysis["pattern_detected"])

            # Add token usage metrics
            if hasattr(response, 'usage_metadata'):
                analysis["_thinking_tokens"] = getattr(response.usage_metadata, 'thoughts_token_count', 0)
                analysis["_output_tokens"] = getattr(response.usage_metadata, 'candidates_token_count', 0)

            required_fields = ["note_type", "priority", "error_category", "suggestion", "guidance"]
            if not all(field in analysis for field in required_fields):
                raise ValueError(f"Invalid cluster analysis schema: {analysis}")

            logger.info(f"Gemini cluster analysis completed for {len(cluster_turns)} turns")
            return analysis

        except Exception as exc:
            logger.error(f"Gemini cluster analysis failed: {exc}")
            if settings.GEMINI_FALLBACK_TO_CEREBRAS:
                logger.info("Falling back to Cerebras for cluster analysis")
                from services.cerebras_service import cerebras_service
                return await cerebras_service.analyze_turn_cluster(cluster_turns, model=model or settings.CEREBRAS_MODEL)
            return self._mock_cluster_analysis(cluster_turns[-1].get("user_text", ""))

    async def analyze_conversation(
        self,
        user_text: str,
        agent_response: str = "",
        model: str = None,
        timeout: float = 5.0
    ) -> Dict[str, Any]:
        """
        Analyze a single conversation turn for learning opportunities.

        Args:
            user_text: What the learner said in Spanish
            agent_response: What the tutor agent replied (optional context)
            model: Gemini model to use
            timeout: Request timeout in seconds

        Returns:
            Dictionary containing note_type, priority, error_category, suggestion, explanation
        """
        if not self.api_key:
            logger.warning("Gemini API key not configured - returning mock analysis")
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
            client = self._get_client()
            if client is None:
                return self._mock_analysis(user_text)

            response = await self._async_generate(
                client=client,
                model=model or settings.GEMINI_MODEL,
                contents=user_prompt,
                system_instruction=system_prompt,
                thinking_level="low",  # Single turn doesn't need deep reasoning
            )

            analysis = self._parse_json_response(response.text)

            required_fields = ["note_type", "priority", "error_category", "suggestion", "explanation"]
            if not all(field in analysis for field in required_fields):
                logger.error(f"Invalid Gemini response schema: {analysis}")
                return self._mock_analysis(user_text)

            logger.info(f"Gemini analysis completed for: {user_text[:50]}...")
            return analysis

        except Exception as exc:
            logger.error(f"Gemini analysis failed: {exc}")
            if settings.GEMINI_FALLBACK_TO_CEREBRAS:
                from services.cerebras_service import cerebras_service
                return await cerebras_service.analyze_conversation(user_text, agent_response, model=settings.CEREBRAS_MODEL)
            return self._mock_analysis(user_text)

    async def summarize_session(
        self,
        transcript_entries: List[Dict[str, Any]],
        user_id: str = None,
        prior_sessions: List[Dict[str, Any]] = None,
        model: Optional[str] = None,
        timeout: float = 10.0,
    ) -> Dict[str, Any]:
        """
        Generate structured session summary with cross-session synthesis.

        Uses Gemini's 1M token context to analyze entire conversation history
        and synthesize patterns across multiple sessions.

        Args:
            transcript_entries: List of {"agent": "...", "content": "..."} entries
            user_id: User ID for cross-session pattern tracking
            prior_sessions: Optional list of prior session summaries for longitudinal insights
            model: Model to use
            timeout: Request timeout

        Returns:
            Dictionary with overall_summary, topics, notable_moments, learning_focus, etc.
        """
        if not self.api_key:
            logger.warning("Gemini unavailable for session summary; returning mock payload")
            return {
                "overall_summary": "Session summary unavailable.",
                "topics": [],
                "notable_moments": [],
                "learning_focus": [],
            }

        conversation_text = "\n".join(
            f"{entry.get('agent', 'system').title()}: {entry.get('content', '')}"
            for entry in transcript_entries
        )

        # Build prompt with cross-session context
        user_prompt = ""
        if prior_sessions:
            user_prompt += "Previous session summaries (for context):\n"
            for i, session in enumerate(prior_sessions[-3:], 1):  # Last 3 sessions
                user_prompt += f"Session {i}: {session.get('overall_summary', 'N/A')}\n"
                if session.get('learning_focus'):
                    user_prompt += f"  Focus areas: {', '.join(session['learning_focus'][:3])}\n"
            user_prompt += "\n---\n\n"

        user_prompt += "Current conversation transcript:\n" + conversation_text

        system_prompt = """You summarize Spanish tutoring sessions with longitudinal awareness.

If prior session context is provided, synthesize patterns across sessions (e.g., "You've improved 40% on verb conjugation since last week").

Return ONLY valid JSON:
{
    "overall_summary": "2-3 sentences in English, referencing progress from prior sessions if available",
    "topics": ["short topic bullets"],
    "notable_moments": ["funny or personal highlights"],
    "learning_focus": ["skills or errors still to practice"],
    "spanish_snippets": [
        {"spanish": "exact Spanish phrase they practiced", "english": "quick meaning", "context": "when it appeared"}
    ],
    "personal_connections": ["facts or preferences you must remember next time"],
    "cross_session_insight": "observation about learner's trajectory across sessions (if prior context available)"
}

Always include the Spanish phrases for any new vocabulary or preferences shared so the learner can re-read them."""

        try:
            client = self._get_client()
            if client is None:
                return {"overall_summary": "Summary unavailable.", "topics": [], "notable_moments": [], "learning_focus": []}

            response = await self._async_generate(
                client=client,
                model=model or settings.GEMINI_MODEL,
                contents=user_prompt,
                system_instruction=system_prompt,
                thinking_level="high",  # Deep reasoning for synthesis
            )

            summary = self._parse_json_response(response.text)

            # Store cross-session insight for future reference (persisted to Redis)
            if user_id and summary.get("cross_session_insight"):
                self.set_user_thought_signature(user_id, summary["cross_session_insight"])

            logger.info(f"Gemini session summary generated for user {user_id}")
            return summary

        except Exception as exc:
            logger.error(f"Gemini session summarization failed: {exc}")
            if settings.GEMINI_FALLBACK_TO_CEREBRAS:
                from services.cerebras_service import cerebras_service
                return await cerebras_service.summarize_session(transcript_entries, model=settings.CEREBRAS_MODEL)
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
        conversation_history: List[Dict[str, str]],
        current_difficulty: str,
        user_id: str = None,
        model: str = None
    ) -> Dict[str, Any]:
        """
        Assess if learner should move to different difficulty level.

        This is an agentic decision: Analyze → Assess → Decide → Execute → Verify

        Args:
            conversation_history: List of {"user": "...", "agent": "..."} dicts
            current_difficulty: Current level (beginner, intermediate, advanced)
            user_id: User ID for pattern tracking
            model: Gemini model to use

        Returns:
            Dictionary with recommended_difficulty, confidence, reasoning
        """
        if not self.api_key:
            logger.warning("Gemini not configured - keeping current difficulty")
            return {
                "recommended_difficulty": current_difficulty,
                "confidence": 0.0,
                "reasoning": "Gemini API not available for assessment"
            }

        # Include longitudinal context if available (cross-session continuity)
        prior_context = ""
        prior_signature = self.get_user_thought_signature(user_id) if user_id else None
        if prior_signature:
            prior_context = f"Prior observation: {prior_signature}\n\n"

        system_prompt = """You are a Spanish language proficiency assessor making an autonomous difficulty decision.

Analyze the conversation history and determine if the student should change difficulty levels.
Consider both current performance AND longitudinal trajectory if prior context is available.

Respond ONLY with valid JSON:
{
  "recommended_difficulty": "beginner" | "intermediate" | "advanced",
  "confidence": 0.0-1.0,
  "reasoning": "brief explanation incorporating both current and historical performance",
  "trajectory": "improving" | "stable" | "declining"
}

Criteria:
- Beginner: Frequent grammar errors, simple sentences, limited vocabulary
- Intermediate: Occasional errors, can maintain conversation, growing vocabulary
- Advanced: Rare errors, complex sentences, idiomatic expressions, near-native fluency

Be conservative with changes - require strong evidence before recommending level changes."""

        history_text = "\n".join([
            f"Student: {turn.get('user', '')}\nTutor: {turn.get('agent', '')}"
            for turn in conversation_history[-10:]
        ])

        user_prompt = f"{prior_context}Current level: {current_difficulty}\n\nRecent conversation:\n{history_text}"

        try:
            client = self._get_client()
            if client is None:
                return {"recommended_difficulty": current_difficulty, "confidence": 0.0, "reasoning": "API unavailable"}

            response = await self._async_generate(
                client=client,
                model=model or settings.GEMINI_MODEL,
                contents=user_prompt,
                system_instruction=system_prompt,
                thinking_level="high",  # Deep reasoning for important decisions
            )

            result = self._parse_json_response(response.text)

            # Update longitudinal tracking (persisted to Redis)
            if user_id:
                trajectory = result.get("trajectory", "stable")
                self.set_user_thought_signature(user_id, f"Difficulty: {result.get('recommended_difficulty')} ({trajectory})")

            logger.info(f"Gemini difficulty assessment: {result.get('recommended_difficulty')} (confidence: {result.get('confidence')})")
            return result

        except Exception as exc:
            logger.error(f"Gemini difficulty assessment failed: {exc}")
            if settings.GEMINI_FALLBACK_TO_CEREBRAS:
                from services.cerebras_service import cerebras_service
                return await cerebras_service.assess_difficulty(conversation_history, current_difficulty, model=settings.CEREBRAS_MODEL)
            return {
                "recommended_difficulty": current_difficulty,
                "confidence": 0.0,
                "reasoning": f"Assessment error: {str(exc)}"
            }

    async def _async_generate(
        self,
        client,
        model: str,
        contents: str,
        system_instruction: str,
        thinking_level: str = "medium",
    ):
        """
        Generate content with thinking configuration.

        This wraps the synchronous SDK call for async compatibility.
        """
        import asyncio

        _init_genai()

        thinking_config = self._get_thinking_config(thinking_level)

        config = types.GenerateContentConfig(
            thinking_config=thinking_config,
            response_mime_type="application/json",
            system_instruction=system_instruction,
        )

        # Run in executor since SDK may be synchronous
        loop = asyncio.get_event_loop()
        response = await loop.run_in_executor(
            None,
            lambda: client.models.generate_content(
                model=model,
                contents=contents,
                config=config,
            )
        )
        return response

    def _parse_json_response(self, content: str) -> Dict[str, Any]:
        """Parse JSON from model response, handling potential formatting issues."""
        # Strip markdown code blocks if present
        content = content.strip()
        if content.startswith("```json"):
            content = content[7:]
        if content.startswith("```"):
            content = content[3:]
        if content.endswith("```"):
            content = content[:-3]
        content = content.strip()

        return json.loads(content)

    def _mock_cluster_analysis(self, user_text: str) -> Dict[str, Any]:
        """Fallback cluster analysis."""
        return {
            "note_type": "CLUSTER",
            "priority": 2,
            "error_category": "Pace & Confidence",
            "suggestion": "Focus on maintaining a steady conversational rhythm.",
            "guidance": "Consider slowing down slightly and using more scaffolding.",
            "pattern_detected": None,
            "confidence": 0.0,
        }

    def _mock_analysis(self, user_text: str) -> Dict[str, Any]:
        """Fallback single-turn analysis."""
        excerpt = (user_text or "").strip()[:70]
        return {
            "note_type": "FLUENCY",
            "priority": 2,
            "error_category": "Pace & Confidence",
            "suggestion": f"Keep practicing: \"{excerpt}...\"",
            "explanation": "Fallback guidance used when the real-time analyzer is unavailable."
        }

    # Cross-session signature management (Redis-backed with in-memory fallback)

    def get_user_thought_signature(self, user_id: str) -> Optional[str]:
        """
        Get stored thought signature for a user (for cross-session continuity).

        Checks Redis first for persistence across server restarts,
        falls back to in-memory cache.
        """
        # Check in-memory cache first (fastest)
        if user_id in self._thought_signatures:
            return self._thought_signatures[user_id]

        # Check Redis for cross-session persistence
        redis_client = _get_redis_client()
        if redis_client:
            try:
                key = _get_thought_signature_key(user_id)
                signature = redis_client.get(key)
                if signature:
                    # Cache in memory for faster subsequent access
                    self._thought_signatures[user_id] = signature
                    logger.debug(f"Loaded thought signature from Redis for user {user_id}")
                    return signature
            except Exception as e:
                logger.warning(f"Failed to get thought signature from Redis: {e}")

        return None

    def set_user_thought_signature(self, user_id: str, signature: str):
        """
        Store thought signature for a user (for cross-session continuity).

        Stores in both Redis (for persistence) and in-memory (for speed).
        """
        # Store in memory for fast access
        self._thought_signatures[user_id] = signature

        # Store in Redis for cross-session persistence
        redis_client = _get_redis_client()
        if redis_client:
            try:
                key = _get_thought_signature_key(user_id)
                redis_client.setex(key, THOUGHT_SIGNATURE_TTL, signature)
                logger.debug(f"Stored thought signature to Redis for user {user_id}")
            except Exception as e:
                logger.warning(f"Failed to store thought signature to Redis: {e}")

    def load_user_thought_signature(self, user_id: str) -> Optional[str]:
        """
        Explicitly load thought signature from Redis at session start.

        Call this when a user starts a new session to restore their
        cross-session reasoning context.
        """
        redis_client = _get_redis_client()
        if redis_client:
            try:
                key = _get_thought_signature_key(user_id)
                signature = redis_client.get(key)
                if signature:
                    self._thought_signatures[user_id] = signature
                    logger.info(
                        f"Restored thought signature for returning user",
                        extra={"user_id": user_id, "signature_preview": signature[:50]}
                    )
                    return signature
            except Exception as e:
                logger.warning(f"Failed to load thought signature from Redis: {e}")
        return None

    def clear_conversation_session(self, conversation_id: str):
        """Clear chat session for a conversation (on session end)."""
        if conversation_id in self._chat_sessions:
            del self._chat_sessions[conversation_id]


# Singleton instance
gemini_service = GeminiService()
