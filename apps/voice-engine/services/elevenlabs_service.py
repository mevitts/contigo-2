import httpx
import websockets
import json
import asyncio
import logging
import uuid  # Import uuid
import base64
import time
from dataclasses import dataclass, field
from datetime import datetime
from typing import AsyncGenerator, Optional, cast, Any, Dict, List
from config.settings import settings


@dataclass
class SessionArtifacts:
    """Local session artifacts for summary generation."""
    transcript: List[Dict[str, Any]] = field(default_factory=list)
    guidance_entries: List[Dict[str, Any]] = field(default_factory=list)
from services.tutor_service import (
    register_user_turn,
    register_agent_turn,
    clear_conversation_state,
    save_adaptive_recommendation,
    record_early_struggle,
)
from services.cerebras_service import cerebras_service
from services.db_service import engine         # <-- YOUR DB ENGINE
from sqlmodel import Session                     # <-- YOUR DB SESSION

logger = logging.getLogger(__name__)
logger.setLevel(logging.DEBUG)

INITIAL_SILENCE_CHUNK = "UklGRiQAAABXQVZFZm10IBAAAAABAAEARKwAAIhYAQACABAAZGF0YQAAAAA="
KEEPALIVE_INTERVAL_SECONDS = 6.0
DIRECTIVE_PREVIEW_LENGTH = 140


def _pcm_base64_to_wav_base64(pcm_b64: str, sample_rate: int = 16000, channels: int = 1, sample_width: int = 2) -> str:
    """Wrap raw PCM16 base64 into a minimal WAV container and return base64.

    ElevenLabs ConvAI returns PCM16 mono by default; browsers need a container.
    """
    pcm_bytes = base64.b64decode(pcm_b64)
    data_size = len(pcm_bytes)
    byte_rate = sample_rate * channels * sample_width
    block_align = channels * sample_width

    # RIFF header (44 bytes)
    header = bytearray()
    header.extend(b"RIFF")
    header.extend((36 + data_size).to_bytes(4, "little"))
    header.extend(b"WAVE")
    header.extend(b"fmt ")
    header.extend((16).to_bytes(4, "little"))  # PCM chunk size
    header.extend((1).to_bytes(2, "little"))   # Audio format PCM
    header.extend((channels).to_bytes(2, "little"))
    header.extend((sample_rate).to_bytes(4, "little"))
    header.extend((byte_rate).to_bytes(4, "little"))
    header.extend((block_align).to_bytes(2, "little"))
    header.extend((sample_width * 8).to_bytes(2, "little"))
    header.extend(b"data")
    header.extend((data_size).to_bytes(4, "little"))

    wav_bytes = bytes(header) + pcm_bytes
    return base64.b64encode(wav_bytes).decode("ascii")


class ElevenLabsConversationHandler:
    """Maneja la conversación real con ElevenLabs WebSocket"""
    
    def __init__(self, agent_id: str,
                 frontend_websocket,
                 conversation_id: str = "",
                 api_key: str = "",
                 user_id: Optional[uuid.UUID] = None,
                 model: Optional[str] = None,
                 analysis_model: Optional[str] = None,
                 dynamic_variables: Optional[Dict[str, object]] = None
                 ):

        self.agent_id = agent_id
        self.frontend_ws = frontend_websocket
        self.elevenlabs_ws: Optional[Any] = None
        self.is_active = False
        self.conversation_id = conversation_id
        self.api_key = api_key if api_key else settings.ELEVENLABS_API_KEY

        self.user_id = user_id
        self.model = model
        self.analysis_model = analysis_model or settings.CEREBRAS_MODEL
        self.last_agent_text = ""
        self.user_turn_counter = 0
        self.last_user_audio_ts = time.monotonic()
        self.keepalive_task: Optional[asyncio.Task] = None
        self.guidance_history: list[dict] = []
        self.conversation_uuid: Optional[uuid.UUID] = None
        self.local_transcript: list[dict] = []
        self.dynamic_variables: Dict[str, object] = self._normalize_dynamic_variables(dynamic_variables)
        # Soft beginner mode tracking
        self._soft_beginner_activated: bool = False
        self.last_analyzed_turn: int = 0  # Track which turn the agent has guidance for
        if conversation_id:
            try:
                self.conversation_uuid = conversation_id if isinstance(conversation_id, uuid.UUID) else uuid.UUID(str(conversation_id))
            except Exception:
                logger.debug("Failed to coerce conversation id to UUID", exc_info=True)
        # ----------------------------------------

    def _normalize_dynamic_variables(self, values: Optional[Dict[str, object]]) -> Dict[str, object]:
        normalized: Dict[str, object] = {}
        if not values:
            return normalized
        for key, raw_value in values.items():
            if raw_value is None:
                continue
            if isinstance(raw_value, (str, int, float, bool)):
                normalized[key] = raw_value
            else:
                try:
                    normalized[key] = json.dumps(raw_value, ensure_ascii=True)
                except (TypeError, ValueError):
                    normalized[key] = str(raw_value)
        return normalized

    async def _emit_dynamic_variables_event(
        self,
        reason: str,
        extra: Optional[Dict[str, object]] = None,
    ) -> None:
        """
        Send contextual update to ElevenLabs agent.

        Uses the 'contextual_update' message type which injects background
        information into the conversation without interrupting the flow.
        """
        if not self.elevenlabs_ws:
            return

        merged: Dict[str, object] = dict(self.dynamic_variables)
        if extra:
            extra_normalized = self._normalize_dynamic_variables(extra)
            if extra_normalized:
                merged.update(extra_normalized)
                self.dynamic_variables.update(extra_normalized)

        if not merged:
            return

        # Build human-readable context text from the variables
        context_parts = [f"[Coaching Update - {reason}]"]
        for key, value in merged.items():
            if value is None or value == "":
                continue
            # Format key nicely (e.g., "last_guidance_focus" -> "Last guidance focus")
            formatted_key = key.replace("_", " ").capitalize()
            context_parts.append(f"- {formatted_key}: {value}")

        context_text = "\n".join(context_parts)

        # Use correct ElevenLabs message type: contextual_update
        payload = {
            "type": "contextual_update",
            "text": context_text,
        }
        try:
            await self.elevenlabs_ws.send(json.dumps(payload))
            logger.info(
                "Contextual update sent to ElevenLabs",
                extra={
                    "reason": reason,
                    "field_count": len(merged),
                    "keys": sorted(merged.keys()),
                    "text_preview": context_text[:200],
                },
            )
            logger.debug("Full contextual update text:\n%s", context_text)
        except Exception as exc:
            logger.warning(
                "Unable to send contextual update",
                extra={"error": str(exc), "reason": reason},
            )

    async def _generate_and_cache_recommendation(self) -> Optional[str]:
        """
        Generate periodic adaptive recommendation and cache it in Redis.
        This becomes part of the session summary AND future session context.
        """
        if not self.conversation_uuid or not self.user_id:
            return None

        # Get recent exchanges from local transcript
        recent_exchanges = self.local_transcript[-10:]
        recent_guidance = self.guidance_history[-3:]

        if len(recent_exchanges) < 3:
            return None  # Not enough data yet

        # Build prompt for Cerebras
        exchanges_text = "\n".join(
            f"{entry.get('agent', 'system').title()}: {entry.get('content', '')}"
            for entry in recent_exchanges[-8:]
        )

        guidance_text = "\n".join(
            f"- {g.get('focus', 'general')}: {g.get('instruction', '')[:100]}"
            for g in recent_guidance
        ) if recent_guidance else "No recent guidance notes."

        prompt = f"""Based on these recent conversation exchanges:
{exchanges_text}

Recent learning notes:
{guidance_text}

Provide a 2-3 sentence coaching recommendation for the tutor:
- Should they adjust pace (faster/slower)?
- What patterns need reinforcement?
- Should they shift topic focus or simplify?

Be specific and actionable. Focus on what the tutor should do RIGHT NOW."""

        try:
            recommendation = await cerebras_service._chat_request(
                system_prompt="You are an adaptive learning coach analyzing conversation patterns. Provide brief, actionable coaching tips.",
                user_prompt=prompt,
                model=settings.CEREBRAS_MODEL,
                timeout=5.0,
                temperature=0.3,
                max_tokens=180,
                response_format={"type": "text"},
            )

            recommendation = recommendation.strip()

            # Cache in Redis
            save_adaptive_recommendation(
                conversation_id=self.conversation_uuid,
                user_id=self.user_id,
                recommendation=recommendation,
                turn_number=self.user_turn_counter,
                metadata={
                    "exchanges_analyzed": len(recent_exchanges),
                    "guidance_count": len(recent_guidance)
                }
            )

            logger.info(
                "Adaptive recommendation generated",
                extra={
                    "conversation_id": str(self.conversation_uuid),
                    "turn": self.user_turn_counter,
                    "preview": recommendation[:100],
                }
            )

            return recommendation

        except Exception as exc:
            logger.warning(f"Failed to generate adaptive recommendation: {exc}")
            return None

    async def _generate_and_send_recommendation(self) -> None:
        """Generate recommendation and send it as contextual update to ElevenLabs."""
        recommendation = await self._generate_and_cache_recommendation()
        if recommendation:
            await self._emit_dynamic_variables_event(
                "adaptive_recommendation",
                extra={
                    "turn_count": self.user_turn_counter,
                    "adaptive_coaching": recommendation,
                }
            )

    def _cancel_keepalive(self):
        if self.keepalive_task:
            self.keepalive_task.cancel()
            self.keepalive_task = None

    def _schedule_keepalive(self):
        if not self.is_active:
            return
        self._cancel_keepalive()

        async def _wait_and_ping():
            try:
                await asyncio.sleep(KEEPALIVE_INTERVAL_SECONDS)
                if not self.is_active or not self.elevenlabs_ws:
                    return
                time_since_user = time.monotonic() - self.last_user_audio_ts
                if time_since_user < KEEPALIVE_INTERVAL_SECONDS:
                    return
                await self.elevenlabs_ws.send(json.dumps({"user_audio_chunk": INITIAL_SILENCE_CHUNK}))
                logger.debug("Sent keepalive silence chunk to keep ElevenLabs engagement timer alive")
            except asyncio.CancelledError:
                return
            except Exception as exc:
                logger.debug(f"Keepalive ping failed: {exc}")

        self.keepalive_task = asyncio.create_task(_wait_and_ping())

    def _capture_memory(self, role: str, content: str):
        """Legacy method - SmartMemory has been deprecated. Now a no-op."""
        pass

    def _append_local_transcript(self, role: str, text: str) -> None:
        content = (text or "").strip()
        if not content:
            return
        entry = {
            "id": f"{self.conversation_id or 'local'}-{role}-{len(self.local_transcript) + 1}",
            "content": content,
            "timeline": "conversation",
            "agent": role,
            "at": datetime.utcnow().isoformat(),
        }
        self.local_transcript.append(entry)

    def _detect_early_struggle(self, user_transcript: str) -> bool:
        """Lightweight check for turns 1-4 before cluster analysis kicks in."""
        if self.user_turn_counter > settings.SOFT_BEGINNER_TURN_THRESHOLD:
            return False  # Let cluster analysis handle it after threshold

        text = (user_transcript or "").strip().lower()
        word_count = len(text.split())
        trigger_reason = None

        # Signal 1: Very short response (< 2 words)
        if word_count < 2:
            trigger_reason = f"short_response (word_count={word_count})"

        # Signal 2: English markers indicating confusion
        english_markers = ["i don't", "what", "sorry", "help", "english",
                          "understand", "repeat", "confused", "slower"]
        matched_marker = next((m for m in english_markers if m in text), None)
        if matched_marker:
            trigger_reason = f"english_confusion_marker ('{matched_marker}')"

        # Signal 3: Minimal Spanish responses (only knows basics)
        if text in {"si", "no", "hola", "bueno", "ok", "um", "uh"}:
            trigger_reason = f"minimal_spanish_only ('{text}')"

        # Signal 4: Silence/hesitation markers from transcription
        if "..." in text or "[silence]" in text.lower():
            trigger_reason = "silence_or_hesitation"

        if trigger_reason:
            logger.info(
                "[ADAPTIVE] Early struggle detected",
                extra={
                    "trigger": trigger_reason,
                    "turn": self.user_turn_counter,
                    "user_text": text[:50] + "..." if len(text) > 50 else text,
                    "conversation_id": str(self.conversation_uuid) if self.conversation_uuid else None,
                }
            )
            return True

        return False

    async def _activate_soft_beginner_mode(self) -> None:
        """Send contextual update to simplify agent behavior."""
        if self._soft_beginner_activated:
            return

        self._soft_beginner_activated = True
        from config.agents import SOFT_BEGINNER_OVERLAY

        payload = {
            "type": "contextual_update",
            "text": SOFT_BEGINNER_OVERLAY["contextual_update_text"],
        }
        if self.elevenlabs_ws:
            try:
                await self.elevenlabs_ws.send(json.dumps(payload))
                logger.warning(
                    "[ADAPTIVE] === SOFT BEGINNER MODE ACTIVATED === User is struggling, simplifying dramatically",
                    extra={
                        "conversation_id": str(self.conversation_uuid),
                        "user_id": str(self.user_id) if self.user_id else None,
                        "turn": self.user_turn_counter,
                        "mode": "soft_beginner",
                        "action": "activated"
                    }
                )
            except Exception as exc:
                logger.warning(
                    "Unable to activate soft beginner mode",
                    extra={"error": str(exc)}
                )

    def _record_early_struggle(self) -> None:
        """Record early struggle for cross-session learning."""
        if self.conversation_uuid and self.user_id:
            record_early_struggle(
                user_id=self.user_id,
                conversation_id=self.conversation_uuid,
                turn=self.user_turn_counter
            )

    def _detect_beginner_confidence(self, recent_transcripts: list[str]) -> bool:
        """
        Detect if learner is showing sustained confidence.
        Requires MULTIPLE signals before considering graduation.

        Returns True only if learner shows confidence in 3+ of last 4 exchanges.
        """
        if len(recent_transcripts) < 4:
            return False  # Not enough data

        confidence_count = 0
        for text in recent_transcripts[-4:]:
            text = (text or "").strip().lower()
            words = text.split()

            # Confidence signals (must have multiple):
            # - Response is 4+ words
            # - Contains Spanish beyond basic greetings
            # - No English confusion markers
            if len(words) >= 4:
                english_markers = ["i don't", "what", "help", "english", "understand"]
                if not any(marker in text for marker in english_markers):
                    confidence_count += 1

        return confidence_count >= 3  # 3 of 4 exchanges show confidence

    async def _consider_soft_beginner_graduation(self) -> None:
        """
        CAUTIOUSLY check if learner can handle normal beginner mode.
        Only runs if soft_beginner is active AND we have 8+ turns of data.
        """
        if not self._soft_beginner_activated:
            return

        if self.user_turn_counter < settings.SOFT_BEGINNER_GRADUATION_MIN_TURNS:
            return  # Need sustained evidence

        # Get last 4 user transcripts
        user_transcripts = [
            entry.get("content", "")
            for entry in self.local_transcript[-8:]
            if entry.get("agent") == "user"
        ][-4:]

        if self._detect_beginner_confidence(user_transcripts):
            # Graduate back to normal beginner (send lighter contextual update)
            payload = {
                "type": "contextual_update",
                "text": "[SOFT BEGINNER MODE GRADUATED] Learner showing confidence. Return to standard beginner approach - still supportive but can use slightly fuller phrases.",
            }
            if self.elevenlabs_ws:
                try:
                    await self.elevenlabs_ws.send(json.dumps(payload))
                    logger.warning(
                        "[ADAPTIVE] === SOFT BEGINNER MODE GRADUATED === User showing confidence, returning to standard beginner",
                        extra={
                            "conversation_id": str(self.conversation_uuid),
                            "user_id": str(self.user_id) if self.user_id else None,
                            "turn": self.user_turn_counter,
                            "mode": "soft_beginner",
                            "action": "graduated"
                        }
                    )
                except Exception as exc:
                    logger.warning(
                        "Unable to send graduation update",
                        extra={"error": str(exc)}
                    )
            self._soft_beginner_activated = False  # Allow re-activation if they struggle again

    async def get_signed_url(self) -> Optional[str]:
        """Obtiene una URL firmada para conectarse al agente"""
        endpoint = "https://api.elevenlabs.io/v1/convai/conversation/get_signed_url"
        headers = {"xi-api-key": self.api_key}

        try:
            async with httpx.AsyncClient() as client:
                response = await client.get(endpoint, params={"agent_id": self.agent_id}, headers=headers)

                if response.status_code == 200:
                    data = response.json()
                    logger.info(
                        "Got signed URL for agent",
                        extra={
                            "agent_id": self.agent_id,
                            "dynamic_variable_count": len(self.dynamic_variables),
                        },
                    )
                    return data.get("signed_url")

                logger.error(
                    "Failed to get signed URL",
                    extra={"status": response.status_code, "body": response.text[:400]},
                )
                return None

        except Exception as exc:
            logger.error("Error getting signed URL", extra={"error": str(exc)})
            return None
    
    async def start(self):
        """Inicia la conexión con ElevenLabs"""
        try:
            signed_url = await self.get_signed_url()
            if not signed_url:
                raise Exception("Could not get signed URL")
            
            self.elevenlabs_ws = await websockets.connect(signed_url)
            self.is_active = True
            logger.info("Connected to ElevenLabs WebSocket")
            await self._emit_dynamic_variables_event("init")

            # Give ElevenLabs time to ingest context before triggering greeting
            await asyncio.sleep(1.0)
            initial_silence = {"user_audio_chunk": INITIAL_SILENCE_CHUNK}
            if self.elevenlabs_ws:
                await self.elevenlabs_ws.send(json.dumps(initial_silence))
            logger.info("Sent initial silence to trigger agent greeting (context sent 1s prior)")
            
            logger.info("Starting bidirectional audio bridge")
            
            forward_task = asyncio.create_task(self.forward_to_elevenlabs())
            receive_task = asyncio.create_task(self.forward_from_elevenlabs())
            
            done, pending = await asyncio.wait(
                [forward_task, receive_task],
                return_when=asyncio.FIRST_COMPLETED
            )
            
            for task in pending:
                task.cancel()
                
            for task in done:
                exc = task.exception()
                if exc:
                    logger.error(f"Task failed with exception: {exc}")
                    raise exc
            
        except Exception as e:
            logger.error(f"Error in ElevenLabs connection: {str(e)}")
            self.is_active = False
            raise
    
    async def forward_to_elevenlabs(self):
        """Reenvía audio del frontend a ElevenLabs"""
        try:
            chunks_sent = 0
            while self.is_active and self.elevenlabs_ws:
                message = await self.frontend_ws.receive_json()
                logger.debug(f"Received message from frontend: {message.get('type')}")
                
                if message["type"] == "audio":
                    audio_data = message["data"]
                    logger.debug(f"Received audio chunk from frontend, size: {len(audio_data) if audio_data else 0}")
                    self.last_user_audio_ts = time.monotonic()
                    self._cancel_keepalive()

                    audio_message = {"user_audio_chunk": audio_data}
                    await self.elevenlabs_ws.send(json.dumps(audio_message))
                    chunks_sent += 1
                    logger.debug(f"Sent audio chunk #{chunks_sent} to ElevenLabs")
                    
                elif message["type"] == "interrupt":
                    interrupt_message = {
                        "type": "audio_input_override",
                        "audio_input_override_event": {"interrupt_agent": True}
                    }
                    await self.elevenlabs_ws.send(json.dumps(interrupt_message))
                    logger.info("Sent interrupt signal to ElevenLabs")
                    
                elif message["type"] == "end":
                    logger.info("Received end signal from frontend")
                    self.is_active = False
                    break
                    
        except Exception as e:
            logger.error(f"Error forwarding to ElevenLabs: {str(e)}")
            self.is_active = False
    
    async def forward_from_elevenlabs(self):
        """Reenvía respuestas de ElevenLabs al frontend Y activa el 'Tutor Brain'"""
        try:
            while self.is_active and self.elevenlabs_ws:
                message = await self.elevenlabs_ws.recv()
                data = json.loads(message)
                
                logger.debug(
                    "ElevenLabs event received",
                    extra={
                        "event_type": data.get("type", "unknown"),
                        "conversation_id": str(self.conversation_uuid) if self.conversation_uuid else None,
                    },
                )
                
                message_type = data.get("type", "")
                
                if message_type == "conversation_initiation_metadata":
                    metadata = data.get("conversation_initiation_metadata_event", {})
                    conversation_id = metadata.get("conversation_id")
                    logger.info(f"Conversation started: {conversation_id}")
                    await self.frontend_ws.send_json({
                        "type": "conversation_started",
                        "conversation_id": conversation_id
                    })
                    
                elif "audio_event" in data:
                    audio_event = data["audio_event"]
                    audio_base64 = audio_event.get("audio_base_64")
                    if audio_base64:
                        logger.info(f"Received audio from ElevenLabs, size: {len(audio_base64)}")
                        try:
                            wav_b64 = _pcm_base64_to_wav_base64(audio_base64)
                        except Exception as conv_err:
                            logger.warning(f"Failed to wrap PCM audio, sending raw base64. Error: {conv_err}")
                            wav_b64 = audio_base64

                        await self.frontend_ws.send_json({
                            "type": "audio",
                            "data": wav_b64,
                            "mime": "audio/wav"
                        })
                        self._schedule_keepalive()
                    
                elif message_type == "user_transcript":
                    transcript_event = data.get("user_transcript_event", {})
                    transcript_text = (
                        transcript_event.get("user_transcript", "")
                        or data.get("user_transcription_event", {}).get("user_transcript", "")
                    )
                    if not transcript_text:
                        logger.warning(f"Empty user transcript event. Raw keys: {list(data.keys())}, event: {json.dumps(data)[:500]}")
                    logger.info(f"User transcript: {transcript_text}")
                    
                    # We call your tutor_service as a background task
                    if self.conversation_uuid and self.user_id and transcript_text:
                        logger.info(f"Triggering Tutor Brain for convo: {self.conversation_uuid}")
                        self.user_turn_counter += 1

                        stagger_interval = settings.STAGGER_TURN_INTERVAL
                        if stagger_interval > 0 and self.user_turn_counter % stagger_interval == 0:
                            asyncio.create_task(
                                self._emit_dynamic_variables_event(
                                    "periodic_update",
                                    extra={"analysis_mode": "active_audit"}
                                )
                            )

                        # Generate adaptive recommendation at configured interval
                        rec_interval = settings.ADAPTIVE_RECOMMENDATION_INTERVAL
                        if (settings.ENABLE_ADAPTIVE_RECOMMENDATIONS and
                            rec_interval > 0 and
                            self.user_turn_counter % rec_interval == 0):
                            asyncio.create_task(self._generate_and_send_recommendation())

                        self._capture_memory("user", transcript_text)
                        self._append_local_transcript("user", transcript_text)
                        asyncio.create_task(
                            register_user_turn(
                                conversation_id=self.conversation_uuid,
                                user_text=transcript_text,
                            )
                        )

                        # Early struggle detection for turns 1-4 (before cluster analysis)
                        if (self.user_turn_counter <= settings.SOFT_BEGINNER_TURN_THRESHOLD
                                and settings.ENABLE_SOFT_BEGINNER_MODE):
                            if self._detect_early_struggle(transcript_text):
                                await self._activate_soft_beginner_mode()
                                self._record_early_struggle()

                        # Consider graduation from soft beginner mode (after turn 8+)
                        if settings.ENABLE_SOFT_BEGINNER_MODE and self._soft_beginner_activated:
                            await self._consider_soft_beginner_graduation()
                    # ---------------------------------------------
                    
                    await self.frontend_ws.send_json({
                        "type": "user_transcript",
                        "text": transcript_text
                    })
                    
                elif message_type == "agent_response":
                    response_event = data.get("agent_response_event", {})
                    agent_text = response_event.get("agent_response", "")

                    if agent_text:
                        truncated = agent_text if len(agent_text) <= 300 else agent_text[:297] + "..."
                        logger.info(f"Agent response text: {truncated}")
                        self._capture_memory("tutor", agent_text)
                        self._append_local_transcript("tutor", agent_text)
                    
                    # --- MODIFICATION 5: CACHE AGENT CONTEXT ---
                    self.last_agent_text = agent_text
                    # -------------------------------------------
                    
                    if self.conversation_uuid and self.user_id:
                        asyncio.create_task(
                            register_agent_turn(
                                conversation_id=self.conversation_uuid,
                                user_id=self.user_id,
                                agent_text=agent_text,
                                model=self.analysis_model,
                                guidance_callback=self._handle_guidance,
                            )
                        )

                    await self.frontend_ws.send_json({
                        "type": "agent_response",
                        "text": agent_text
                    })
                    
                elif message_type == "ping":
                    pass  # ElevenLabs keepalive - ignore silently

                elif "error" in data:
                    logger.error(f"ElevenLabs error: {data['error']}")
                    await self.frontend_ws.send_json({
                        "type": "error",
                        "message": data.get("error", "Unknown error")
                    })
                else:
                    try:
                        payload_preview = json.dumps(data)[:500]
                    except Exception:
                        payload_preview = str(data)[:500]
                    logger.warning(
                        f"Unhandled ElevenLabs event: type={message_type or 'unknown'}, payload={payload_preview}",
                    )

        except websockets.exceptions.ConnectionClosed:
            logger.info("ElevenLabs WebSocket closed")
            self.is_active = False
        except Exception as e:
            logger.error(f"Error forwarding from ElevenLabs: {str(e)}")
            self.is_active = False
    
    async def end(self):
        """Termina la conversación"""
        self.is_active = False
        self._cancel_keepalive()
        if self.elevenlabs_ws:
            await self.elevenlabs_ws.close()
        if self.conversation_uuid:
            clear_conversation_state(self.conversation_uuid)
        logger.info("ElevenLabs conversation ended")

    async def _handle_guidance(self, payload: dict):
        enriched = {
            **payload,
            "timestamp": datetime.utcnow().isoformat(),
        }
        self.guidance_history.append(enriched)
        # Track which turn the agent now has guidance for (latency handling)
        self.last_analyzed_turn = self.user_turn_counter
        instruction_preview = (enriched.get("instruction") or enriched.get("suggestion") or "").strip()
        truncated = ""
        if instruction_preview:
            truncated = (
                instruction_preview
                if len(instruction_preview) <= DIRECTIVE_PREVIEW_LENGTH
                else instruction_preview[: DIRECTIVE_PREVIEW_LENGTH - 3] + "..."
            )
            logger.info(
                "Injecting guidance into agent context",
                extra={
                    "focus": enriched.get("focus"),
                    "severity": enriched.get("severity"),
                    "instruction_preview": truncated,
                },
            )
        await self._emit_dynamic_variables_event(
            "guidance_update",
            extra={
                "last_guidance_focus": enriched.get("focus"),
                "last_guidance_severity": enriched.get("severity"),
                "last_guidance_preview": truncated or None,
            },
        )
        await self._send_agent_directive(enriched)
        # Send a user-visible nudge for medium/high severity guidance
        severity = enriched.get("severity", "low")
        if severity in ("high", "medium") and truncated:
            await self._send_user_nudge(enriched)

    async def _send_agent_directive(self, payload: dict):
        if not self.elevenlabs_ws:
            return
        instruction = (payload or {}).get("instruction")
        if not instruction:
            return
        directive = {
            "type": "agent_instruction",
            "agent_instruction_event": {
                "instruction": instruction,
                "focus": payload.get("focus"),
                "severity": payload.get("severity", "medium"),
            },
        }
        try:
            await self.elevenlabs_ws.send(json.dumps(directive))
            preview = instruction if len(instruction) <= DIRECTIVE_PREVIEW_LENGTH else instruction[: DIRECTIVE_PREVIEW_LENGTH - 3] + "..."
            logger.info(
                "Agent directive pushed",
                extra={
                    "focus": payload.get("focus"),
                    "severity": payload.get("severity", "medium"),
                    "preview": preview,
                },
            )
        except Exception as exc:
            logger.warning(
                "Unable to push agent directive",
                extra={
                    "error": str(exc),
                    "focus": payload.get("focus"),
                },
            )

    async def _send_user_nudge(self, payload: dict):
        """Send a subtle coaching tip to the frontend for user display."""
        if not self.frontend_ws:
            return
        suggestion = (payload.get("instruction") or payload.get("suggestion") or "").strip()
        if not suggestion:
            return
        # Build a short, user-friendly tip (max ~80 chars)
        tip = suggestion if len(suggestion) <= 80 else suggestion[:77] + "..."
        try:
            await self.frontend_ws.send_json({
                "type": "guidance_nudge",
                "tip": tip,
                "focus": payload.get("focus", ""),
            })
            logger.info(
                "User nudge sent to frontend",
                extra={"tip_preview": tip[:60], "focus": payload.get("focus")},
            )
        except Exception as exc:
            logger.warning("Unable to send user nudge", extra={"error": str(exc)})

    def build_local_summary_artifacts(self) -> Optional[SessionArtifacts]:
        if not self.local_transcript and not self.guidance_history:
            return None

        guidance_entries = []
        for idx, directive in enumerate(self.guidance_history):
            instruction = (directive.get("instruction") or directive.get("suggestion") or "").strip()
            if not instruction:
                continue
            guidance_entries.append(
                {
                    "id": f"{self.conversation_id or 'local'}-guidance-{idx + 1}",
                    "content": instruction,
                    "timeline": settings.GUIDANCE_TIMELINE_NAME,
                    "agent": "system",
                    "at": directive.get("timestamp") or datetime.utcnow().isoformat(),
                }
            )

        return SessionArtifacts(
            transcript=list(self.local_transcript),
            guidance_entries=guidance_entries,
        )


class ElevenLabsService:
    def __init__(self):
        pass
    
    async def create_conversation(self, agent_id: str,
                                  audio_interface,
                                  conversation_id: str = '',
                                  api_key: str = '',
                                  user_id: Optional[uuid.UUID] = None,
                                  model: Optional[str] = None,
                                  analysis_model: Optional[str] = None,
                                  dynamic_variables: Optional[Dict[str, object]] = None):
        """Crea una conversación con el agente especificado"""
        try:
            conversation = ElevenLabsConversationHandler(
                agent_id,
                audio_interface.ws,
                conversation_id,
                api_key,
                user_id,
                model,
                analysis_model,
                dynamic_variables,
            )
            # Log dynamic variables being sent to ElevenLabs for debugging
            dv_keys = list(dynamic_variables.keys()) if dynamic_variables else []
            continuity_keys = [k for k in dv_keys if 'last_session' in k or 'highlight' in k or 'memory' in k]
            logger.info(
                f"Created conversation handler for agent {agent_id}",
                extra={
                    "dynamic_variable_count": len(dv_keys),
                    "continuity_context_keys": continuity_keys,
                    "has_personal_callbacks": "highlight_personal" in dv_keys,
                    "has_memory_snippets": "memory_snippets" in dv_keys,
                },
            )
            return conversation
            
        except Exception as e:
            logger.error(f"Error creating conversation: {str(e)}")
            raise
    
    async def end_conversation(self, conversation):
        """Termina una conversación"""
        try:
            await conversation.end()
            logger.info("Conversation ended")
        except Exception as e:
            logger.error(f"Error ending conversation: {str(e)}")


elevenlabs_service = ElevenLabsService()
