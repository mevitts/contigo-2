import React from "react";
import { X, Mic, MicOff, HelpCircle, Eye, EyeOff, BookOpen, Loader2 } from "lucide-react";
import { motion } from "motion/react";
import type { SessionRecord, DetectedReference, Reference, CreateReferenceRequest } from "../lib/types";
import {
  translateText,
  listReferences,
  listPinnedReferences,
  createReference,
  updateReference,
  deleteReference
} from "../lib/api";
import { ReferencePanel } from "./ReferencePanel";

interface VoiceSessionProps {
  onEndSession: (durationSeconds: number) => void;
  session: SessionRecord;
  websocketUrl?: string;
  onConnectionError?: (message: string) => void;
  maxDurationSeconds?: number;
  userId?: string;
}

interface Message {
  speaker: "tutor" | "user";
  text: string;
  time?: string;
}

const AGENT_AVATARS: Record<string, { src: string; label: string }> = {
  beginner: {
    src: "https://images.unsplash.com/photo-1524504388940-b1c1722653e1?auto=format&fit=crop&w=400&q=80",
    label: "Beginner Tutor",
  },
  intermediate: {
    src: "https://images.unsplash.com/photo-1544723795-3fb6469f5b39?auto=format&fit=crop&w=400&q=80",
    label: "Intermediate Tutor",
  },
  advanced: {
    src: "https://images.unsplash.com/photo-1544005313-94ddf0286df2?auto=format&fit=crop&w=400&q=80",
    label: "Advanced Tutor",
  },
  default: {
    src: "https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&w=200&q=80",
    label: "Contigo Tutor",
  },
};

const AUDIO_SAMPLE_RATE = 16000;
const AUDIO_BUFFER_SIZE = 4096;
const SPEAKING_INDICATOR_TIMEOUT_MS = 1200;

function floatTo16BitPCM(float32Array: Float32Array): ArrayBuffer {
  const buffer = new ArrayBuffer(float32Array.length * 2);
  const view = new DataView(buffer);

  for (let i = 0; i < float32Array.length; i += 1) {
    const sample = Math.max(-1, Math.min(1, float32Array[i]));
    view.setInt16(i * 2, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
  }

  return buffer;
}

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  const chunkSize = 0x8000;
  let binary = "";

  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, i + chunkSize);
    binary += String.fromCharCode(...chunk);
  }

  return btoa(binary);
}

function formatTimestamp(date: Date = new Date()): string {
  return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

const NoiseOverlay: React.FC = () => (
  <div
    className="pointer-events-none fixed inset-0 z-0 opacity-[0.06] mix-blend-multiply"
    style={{
      backgroundImage: `url("data:image/svg+xml,%3Csvg viewBox='0 0 200 200' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='noiseFilter'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.8' numOctaves='3' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23noiseFilter)' opacity='1'/%3E%3C/svg%3E")`,
    }}
  />
);

export function VoiceSession({ onEndSession, session, websocketUrl, onConnectionError, maxDurationSeconds, userId }: VoiceSessionProps) {
  const [isMuted, setIsMuted] = React.useState(false);
  const [elapsedSeconds, setElapsedSeconds] = React.useState(0);
  const [connectionStatus, setConnectionStatus] = React.useState<"idle" | "connecting" | "connected" | "error">(
    websocketUrl ? "connecting" : "idle"
  );
  const [messages, setMessages] = React.useState<Message[]>([
    {
      speaker: "tutor",
      text: session.topic
        ? `¿Listo para hablar sobre ${session.topic.toLowerCase()}?`
        : "¿Qué hiciste este fin de semana?",
    },
  ]);
  const [showTranscript, setShowTranscript] = React.useState(false);
  const [isSpeaking, setIsSpeaking] = React.useState(false);
  const [helpTranslation, setHelpTranslation] = React.useState<string | null>(null);
  const [helpLoading, setHelpLoading] = React.useState(false);
  const [helpError, setHelpError] = React.useState<string | null>(null);
  const [nudgeTip, setNudgeTip] = React.useState<string | null>(null);
  const nudgeTimeoutRef = React.useRef<number>();

  // Reference Library state
  const [showReferences, setShowReferences] = React.useState(false);
  const [detectedReferences, setDetectedReferences] = React.useState<DetectedReference[]>([]);
  const [sessionReferences, setSessionReferences] = React.useState<Reference[]>([]);
  const [pinnedReferences, setPinnedReferences] = React.useState<Reference[]>([]);

  const wsRef = React.useRef<WebSocket | null>(null);
  const micStreamRef = React.useRef<MediaStream | null>(null);
  const audioContextRef = React.useRef<AudioContext | null>(null);
  const processorRef = React.useRef<ScriptProcessorNode | null>(null);
  const mediaSourceRef = React.useRef<MediaStreamAudioSourceNode | null>(null);
  const gainNodeRef = React.useRef<GainNode | null>(null);
  const playbackQueueRef = React.useRef<Promise<void>>(Promise.resolve());
  const activeAudioElementsRef = React.useRef<Set<HTMLAudioElement>>(new Set());
  const speakingTimeoutRef = React.useRef<number>();
  const isMutedRef = React.useRef(false);
  const isEndingRef = React.useRef(false);
  const isMountedRef = React.useRef(true);
  const timerRef = React.useRef<number>();
  const helpRequestIdRef = React.useRef(0);
  const lastTranslatedTextRef = React.useRef<string>("");

  const lastTutorMessage = React.useMemo(() => {
    for (let i = messages.length - 1; i >= 0; i -= 1) {
      if (messages[i]?.speaker === "tutor") {
        return messages[i];
      }
    }
    return null;
  }, [messages]);
  const lastTutorText = lastTutorMessage?.text ?? "";
  const normalizedDifficulty = (session.difficulty ?? "").toLowerCase();
  const agentAvatar = AGENT_AVATARS[normalizedDifficulty] ?? AGENT_AVATARS.default;
  const agentAlt = session.agentDisplayName ?? agentAvatar.label;

  const [timeLimitReached, setTimeLimitReached] = React.useState(false);
  const timeLimitTriggeredRef = React.useRef(false);

  React.useEffect(() => {
    timerRef.current = window.setInterval(() => {
      setElapsedSeconds((prev) => {
        const next = prev + 1;
        // Check if time limit reached (for demo users)
        if (maxDurationSeconds && next >= maxDurationSeconds && !timeLimitTriggeredRef.current) {
          timeLimitTriggeredRef.current = true;
          setTimeLimitReached(true);
        }
        return next;
      });
    }, 1000);

    return () => {
      if (timerRef.current) {
        window.clearInterval(timerRef.current);
      }
    };
  }, [maxDurationSeconds]);

  React.useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  React.useEffect(() => {
    setMessages([
      {
        speaker: "tutor",
        text: session.topic
          ? `¿Listo para hablar sobre ${session.topic.toLowerCase()}?`
          : "¿Qué hiciste este fin de semana?",
      },
    ]);
    setElapsedSeconds(0);
  }, [session.id, session.topic]);

  React.useEffect(() => {
    isMutedRef.current = isMuted;
    const stream = micStreamRef.current;
    if (stream) {
      stream.getAudioTracks().forEach((track) => {
        track.enabled = !isMuted;
      });
    }
  }, [isMuted]);

  const cleanupMedia = React.useCallback(() => {
    processorRef.current?.disconnect();
    processorRef.current = null;

    mediaSourceRef.current?.disconnect();
    mediaSourceRef.current = null;

    if (gainNodeRef.current) {
      gainNodeRef.current.disconnect();
      gainNodeRef.current = null;
    }

    if (micStreamRef.current) {
      micStreamRef.current.getTracks().forEach((track) => track.stop());
      micStreamRef.current = null;
    }

    if (audioContextRef.current) {
      audioContextRef.current.close().catch(() => undefined);
      audioContextRef.current = null;
    }
  }, []);

  const stopAllAudio = React.useCallback(() => {
    activeAudioElementsRef.current.forEach((audio) => {
      try {
        audio.pause();
        audio.currentTime = 0;
      } catch (_err) {
        /* noop */
      }
      if (audio.dataset.objectUrl) {
        URL.revokeObjectURL(audio.dataset.objectUrl);
        delete audio.dataset.objectUrl;
      }
      audio.src = "";
    });
    activeAudioElementsRef.current.clear();
  }, []);

  const sendMessage = React.useCallback((payload: Record<string, unknown>) => {
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(payload));
    }
  }, []);

  const cleanupTransport = React.useCallback(
    (options?: { notifyServer?: boolean; markEnding?: boolean }) => {
      const notifyServer = options?.notifyServer ?? false;
      const markEnding = options?.markEnding ?? false;

      if (markEnding) {
        isEndingRef.current = true;
      }

      if (notifyServer) {
        sendMessage({ type: "end" });
      }

      const ws = wsRef.current;
      if (ws) {
        wsRef.current = null;
        try {
          ws.close();
        } catch (_error) {
        }
      }

      cleanupMedia();
      stopAllAudio();
      playbackQueueRef.current = Promise.resolve();

      if (speakingTimeoutRef.current) {
        window.clearTimeout(speakingTimeoutRef.current);
        speakingTimeoutRef.current = undefined;
      }

      if (isMountedRef.current) {
        setIsSpeaking(false);
      }
    },
    [cleanupMedia, sendMessage, stopAllAudio]
  );

  const fetchHelpTranslation = React.useCallback(
    async (
      textOverride?: string,
      options?: { background?: boolean; force?: boolean }
    ) => {
      const normalized = (textOverride ?? lastTutorText).trim();
      const isBackground = Boolean(options?.background);
      const forceRefresh = Boolean(options?.force);

      if (!normalized) {
        helpRequestIdRef.current += 1;
        lastTranslatedTextRef.current = "";
        if (!isBackground) {
          setHelpLoading(false);
          setHelpError(null);
        }
        setHelpTranslation(null);
        return;
      }

      if (!forceRefresh && lastTranslatedTextRef.current === normalized && helpTranslation) {
        return;
      }

      const requestId = helpRequestIdRef.current + 1;
      helpRequestIdRef.current = requestId;
      if (!isBackground) {
        setHelpLoading(true);
        setHelpError(null);
      }

      try {
        const translation = await translateText(normalized, "en");
        if (!isMountedRef.current || requestId !== helpRequestIdRef.current) {
          return;
        }
        lastTranslatedTextRef.current = normalized;
        setHelpTranslation(translation);
        setHelpError(null);
      } catch (error) {
        if (!isMountedRef.current || requestId !== helpRequestIdRef.current) {
          return;
        }
        const message = error instanceof Error ? error.message : "No pudimos traducirlo.";
        lastTranslatedTextRef.current = "";
        setHelpError(message);
        setHelpTranslation(null);
      } finally {
        if (!isMountedRef.current || requestId !== helpRequestIdRef.current) {
          return;
        }
        if (!isBackground) {
          setHelpLoading(false);
        }
      }
    },
    [lastTutorText, helpTranslation]
  );

  React.useEffect(() => {
    return () => {
      cleanupTransport({ notifyServer: true, markEnding: true });
      if (timerRef.current) {
        window.clearInterval(timerRef.current);
      }
      if (nudgeTimeoutRef.current) {
        window.clearTimeout(nudgeTimeoutRef.current);
      }
    };
  }, [cleanupTransport]);

  // Auto-fetch translation when transcript is visible and a translation was already shown
  // (re-translate on new tutor message so user doesn't have to keep clicking)
  const hadTranslationRef = React.useRef(false);
  React.useEffect(() => {
    if (helpTranslation) {
      hadTranslationRef.current = true;
    }
  }, [helpTranslation]);

  React.useEffect(() => {
    if (!showTranscript || !hadTranslationRef.current) {
      return;
    }

    const normalized = lastTutorText.trim();
    if (!normalized) {
      lastTranslatedTextRef.current = "";
      setHelpTranslation(null);
      setHelpError(null);
      setHelpLoading(false);
      return;
    }

    // Skip if we already translated this exact text
    if (lastTranslatedTextRef.current === normalized && helpTranslation) {
      return;
    }

    fetchHelpTranslation(normalized, { force: true });
  }, [showTranscript, lastTutorText, fetchHelpTranslation, helpTranslation]);

  // Load pinned references on mount
  React.useEffect(() => {
    if (!userId) return;

    const loadPinnedReferences = async () => {
      try {
        const pinned = await listPinnedReferences(userId);
        if (isMountedRef.current) {
          setPinnedReferences(pinned);
        }
      } catch (error) {
        console.error("Failed to load pinned references:", error);
      }
    };

    loadPinnedReferences();
  }, [userId]);

  // Reference handlers
  const handleSaveDetectedReference = React.useCallback(
    async (ref: DetectedReference) => {
      if (!userId) return;

      try {
        const saved = await createReference({
          userId,
          conversationId: session.id,
          title: ref.title,
          referenceType: ref.type,
          source: ref.source || null,
          detectedContext: ref.context,
          detectionMethod: "auto",
        });

        // Move from detected to session references
        setDetectedReferences((prev) => prev.filter((r) => r.title !== ref.title));
        setSessionReferences((prev) => [...prev, saved]);
      } catch (error) {
        console.error("Failed to save reference:", error);
      }
    },
    [userId, session.id]
  );

  const handlePinReference = React.useCallback(
    async (ref: Reference) => {
      try {
        await updateReference(ref.id, { isPinned: true });
        const updated = { ...ref, isPinned: true };

        setSessionReferences((prev) =>
          prev.map((r) => (r.id === ref.id ? updated : r))
        );
        setPinnedReferences((prev) => {
          if (prev.some((r) => r.id === ref.id)) {
            return prev.map((r) => (r.id === ref.id ? updated : r));
          }
          return [...prev, updated];
        });
      } catch (error) {
        console.error("Failed to pin reference:", error);
      }
    },
    []
  );

  const handleUnpinReference = React.useCallback(
    async (ref: Reference) => {
      try {
        await updateReference(ref.id, { isPinned: false });
        const updated = { ...ref, isPinned: false };

        setSessionReferences((prev) =>
          prev.map((r) => (r.id === ref.id ? updated : r))
        );
        setPinnedReferences((prev) => prev.filter((r) => r.id !== ref.id));
      } catch (error) {
        console.error("Failed to unpin reference:", error);
      }
    },
    []
  );

  const handleDeleteReference = React.useCallback(
    async (ref: Reference) => {
      try {
        await deleteReference(ref.id);
        setSessionReferences((prev) => prev.filter((r) => r.id !== ref.id));
        setPinnedReferences((prev) => prev.filter((r) => r.id !== ref.id));
      } catch (error) {
        console.error("Failed to delete reference:", error);
      }
    },
    []
  );

  const handleManualAddReference = React.useCallback(
    async (data: Omit<CreateReferenceRequest, 'userId' | 'conversationId'>) => {
      if (!userId) return;

      try {
        const saved = await createReference({
          ...data,
          userId,
          conversationId: session.id,
        });
        setSessionReferences((prev) => [...prev, saved]);
      } catch (error) {
        console.error("Failed to add reference:", error);
      }
    },
    [userId, session.id]
  );

  const enqueueAudioPlayback = React.useCallback((base64: string, mime?: string) => {
    if (!base64) {
      return;
    }

    playbackQueueRef.current = playbackQueueRef.current.then(
      () =>
        new Promise<void>((resolve) => {
          const binary = atob(base64);
          const bytes = new Uint8Array(binary.length);
          for (let i = 0; i < binary.length; i += 1) {
            bytes[i] = binary.charCodeAt(i);
          }

          const isWav =
            bytes.length >= 4 &&
            bytes[0] === 0x52 &&
            bytes[1] === 0x49 &&
            bytes[2] === 0x46 &&
            bytes[3] === 0x46; // RIFF

          const blob = new Blob([bytes.buffer], { type: mime || (isWav ? "audio/wav" : "audio/mpeg") });
          const url = URL.createObjectURL(blob);

          const audio = new Audio(url);
          audio.dataset.objectUrl = url;
          activeAudioElementsRef.current.add(audio);
          audio.preload = "auto";
          audio.autoplay = true;
          audio.setAttribute("playsinline", "true");
          audio.crossOrigin = "anonymous";
          const finalize = () => {
            try {
              audio.pause();
            } catch (_err) {
              /* ignore */
            }
            activeAudioElementsRef.current.delete(audio);
            URL.revokeObjectURL(url);
            delete audio.dataset.objectUrl;
            resolve();
          };

          audio.addEventListener("ended", finalize, { once: true });
          audio.addEventListener(
            "error",
            (err) => {
              console.warn("Voice playback failed", err);
              finalize();
            },
            { once: true }
          );

          const playPromise = audio.play();
          if (playPromise && typeof playPromise.then === "function") {
            playPromise.catch((err) => {
              console.warn("Voice playback failed", err);
              finalize();
            });
          }
        })
    );
  }, []);

  const markSpeakingActive = React.useCallback(() => {
    if (!isMountedRef.current) {
      return;
    }

    setIsSpeaking(true);
    if (speakingTimeoutRef.current) {
      window.clearTimeout(speakingTimeoutRef.current);
    }
    speakingTimeoutRef.current = window.setTimeout(() => {
      if (isMountedRef.current) {
        setIsSpeaking(false);
      }
      speakingTimeoutRef.current = undefined;
    }, SPEAKING_INDICATOR_TIMEOUT_MS);
  }, []);

  const handleIncoming = React.useCallback(
    (payload: any) => {
      if (!isMountedRef.current || !payload) {
        return;
      }

      switch (payload.type) {
        case "audio":
          if (typeof payload.data === "string") {
            enqueueAudioPlayback(payload.data, typeof payload.mime === "string" ? payload.mime : undefined);
            markSpeakingActive();
          }
          break;
        case "user_transcript":
          if (typeof payload.text === "string" && payload.text.trim()) {
            setMessages((prev) => [
              ...prev,
              {
                speaker: "user",
                text: payload.text,
                time: formatTimestamp(),
              },
            ]);
          }
          break;
        case "agent_response":
          if (typeof payload.text === "string" && payload.text.trim()) {
            setMessages((prev) => [
              ...prev,
              {
                speaker: "tutor",
                text: payload.text,
                time: formatTimestamp(),
              },
            ]);
          }
          break;
        case "error":
          if (isMountedRef.current) {
            setConnectionStatus("error");
          }
          if (typeof payload.message === "string") {
            onConnectionError?.(payload.message);
          }
          break;
        case "guidance_nudge":
          if (typeof payload.tip === "string" && payload.tip.trim()) {
            setNudgeTip(payload.tip);
            if (nudgeTimeoutRef.current) {
              window.clearTimeout(nudgeTimeoutRef.current);
            }
            nudgeTimeoutRef.current = window.setTimeout(() => {
              if (isMountedRef.current) {
                setNudgeTip(null);
              }
              nudgeTimeoutRef.current = undefined;
            }, 8000);
          }
          break;
        case "references_detected":
          if (Array.isArray(payload.references) && payload.references.length > 0) {
            setDetectedReferences((prev) => {
              // Avoid duplicates by title
              const newRefs = payload.references.filter(
                (r: DetectedReference) => !prev.some((p) => p.title === r.title)
              );
              return [...prev, ...newRefs];
            });
          }
          break;
        default:
          break;
      }
    },
    [enqueueAudioPlayback, markSpeakingActive, onConnectionError]
  );

  const startMicrophone = React.useCallback(async () => {
    if (!navigator.mediaDevices?.getUserMedia) {
      throw new Error("Este navegador no soporta entrada de audio.");
    }

    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        channelCount: 1,
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
    });

    micStreamRef.current = stream;

    const AudioCtx = (window.AudioContext || (window as any).webkitAudioContext) as
      | typeof AudioContext
      | undefined;

    if (!AudioCtx) {
      throw new Error("Web Audio API no está disponible.");
    }

    let context: AudioContext;
    try {
      context = new AudioCtx({ sampleRate: AUDIO_SAMPLE_RATE });
    } catch (_error) {
      context = new AudioCtx();
    }

    audioContextRef.current = context;

    const source = context.createMediaStreamSource(stream);
    mediaSourceRef.current = source;

    const processor = context.createScriptProcessor(AUDIO_BUFFER_SIZE, 1, 1);
    processorRef.current = processor;

    const gain = context.createGain();
    gain.gain.value = 0;
    gainNodeRef.current = gain;

    processor.onaudioprocess = (event) => {
      if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN || isMutedRef.current) {
        return;
      }

      const channelData = event.inputBuffer.getChannelData(0);
      const pcmBuffer = floatTo16BitPCM(channelData);
      const base64Chunk = arrayBufferToBase64(pcmBuffer);
      sendMessage({ type: "audio", data: base64Chunk });
    };

    source.connect(processor);
    processor.connect(gain);
    gain.connect(context.destination);

    if (context.state === "suspended") {
      try {
        await context.resume();
      } catch (_resumeError) {
      }
    }

    stream.getAudioTracks().forEach((track) => {
      track.enabled = !isMutedRef.current;
    });
  }, [sendMessage]);

  // Stable ref for the websocketUrl so the effect only re-runs when the URL truly changes
  const wsUrlRef = React.useRef(websocketUrl);
  wsUrlRef.current = websocketUrl;

  // Stable refs for callbacks to avoid re-running the WebSocket effect on callback identity changes
  const onConnectionErrorRef = React.useRef(onConnectionError);
  onConnectionErrorRef.current = onConnectionError;
  const startMicrophoneRef = React.useRef(startMicrophone);
  startMicrophoneRef.current = startMicrophone;
  const handleIncomingRef = React.useRef(handleIncoming);
  handleIncomingRef.current = handleIncoming;

  React.useEffect(() => {
    let cancelled = false;
    const url = wsUrlRef.current;

    if (!url) {
      setConnectionStatus("error");
      onConnectionErrorRef.current?.("Voice connection unavailable.");
      return;
    }

    // Guard: if a WebSocket is already open/connecting, skip (handles StrictMode double-mount)
    if (wsRef.current && (wsRef.current.readyState === WebSocket.OPEN || wsRef.current.readyState === WebSocket.CONNECTING)) {
      return;
    }

    isEndingRef.current = false;
    setConnectionStatus("connecting");

    const ws = new WebSocket(url);
    wsRef.current = ws;

    ws.onopen = async () => {
      if (cancelled || !isMountedRef.current) {
        return;
      }

      setConnectionStatus("connected");

      try {
        await startMicrophoneRef.current();
      } catch (error) {
        const message = error instanceof Error ? error.message : "Microphone unavailable.";
        onConnectionErrorRef.current?.(message);
        setConnectionStatus("error");
        cleanupTransport({ notifyServer: true, markEnding: true });
      }
    };

    ws.onmessage = (event) => {
      if (cancelled || !isMountedRef.current || typeof event.data !== "string") {
        return;
      }

      try {
        const payload = JSON.parse(event.data);
        handleIncomingRef.current(payload);
      } catch (parseError) {
        console.error("Failed to parse voice payload", parseError);
      }
    };

    ws.onerror = () => {
      if (cancelled || !isMountedRef.current) {
        return;
      }

      setConnectionStatus("error");
      onConnectionErrorRef.current?.("Voice connection encountered an error.");
      cleanupTransport({ markEnding: true });
    };

    ws.onclose = () => {
      if (wsRef.current === ws) {
        wsRef.current = null;
      }

      cleanupMedia();
      playbackQueueRef.current = Promise.resolve();

      if (speakingTimeoutRef.current) {
        window.clearTimeout(speakingTimeoutRef.current);
        speakingTimeoutRef.current = undefined;
      }

      if (!cancelled && !isEndingRef.current && isMountedRef.current) {
        setConnectionStatus("error");
        onConnectionErrorRef.current?.("Voice connection closed.");
      }
    };

    return () => {
      cancelled = true;
      cleanupTransport();
      if (isMountedRef.current) {
        setConnectionStatus("idle");
      }
    };
    // Only re-run when the WebSocket URL actually changes
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [websocketUrl]);

  const handleEndSession = React.useCallback(() => {
    cleanupTransport({ notifyServer: true, markEnding: true });
    setConnectionStatus("idle");
    onEndSession(elapsedSeconds);
  }, [cleanupTransport, elapsedSeconds, onEndSession]);

  // Auto-end session when demo time limit is reached
  React.useEffect(() => {
    if (timeLimitReached && maxDurationSeconds) {
      // Small delay for UX, then auto-end
      const timeout = setTimeout(() => {
        handleEndSession();
      }, 1000);
      return () => clearTimeout(timeout);
    }
  }, [timeLimitReached, maxDurationSeconds, handleEndSession]);

  const lastMessage = messages[messages.length - 1];

  return (
    <div className="min-h-screen bg-plaster relative overflow-hidden flex flex-col">
      <NoiseOverlay />

      <div className="relative z-20 px-6 py-6 flex items-center justify-between">
        <div className="flex items-center gap-4">
          <button
            onClick={handleEndSession}
            className="w-10 h-10 rounded-full bg-white border-2 border-gray-200 flex items-center justify-center hover:bg-gray-50 transition-colors"
          >
            <X size={20} className="text-gray-600" />
          </button>
          <div className="flex flex-col">
            <span className="text-xs font-bold uppercase tracking-widest text-gray-400">
              En Vivo
            </span>
            <span className="font-serif text-xl text-textMain">{formatTimer(elapsedSeconds)}</span>
            <span className="text-[10px] font-bold uppercase tracking-[0.4em] text-gray-400">
              {connectionStatus === "connected" && "Live"}
              {connectionStatus === "connecting" && "Connecting"}
              {connectionStatus === "error" && "Offline"}
              {connectionStatus === "idle" && "Standby"}
            </span>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <button
            onClick={() => setShowReferences(true)}
            className={`relative w-10 h-10 rounded-full flex items-center justify-center transition-all ${
              showReferences
                ? "bg-emerald-500 text-white shadow-md"
                : "bg-white border-2 border-gray-200 text-gray-400 hover:border-emerald-400 hover:text-emerald-500"
            }`}
          >
            <BookOpen size={20} />
            {detectedReferences.length > 0 && (
              <span className="absolute -top-1 -right-1 w-5 h-5 rounded-full bg-amber-400 text-xs font-bold text-white flex items-center justify-center">
                {detectedReferences.length}
              </span>
            )}
          </button>

          <button
            onClick={handleSosToggle}
            className={`w-10 h-10 rounded-full flex items-center justify-center transition-all ${
              sosMode
                ? "bg-yellow text-textMain shadow-md"
                : "bg-white border-2 border-gray-200 text-gray-400 hover:border-yellow hover:text-yellow"
            }`}
          >
            <HelpCircle size={20} />
          </button>
        </div>
      </div>

      <div className="flex-1 relative flex items-center justify-center z-10">
        <div className="relative w-64 h-64 md:w-96 md:h-96">
          <div
            className={`absolute top-0 left-0 w-32 h-32 md:w-48 md:h-48 bg-pink transition-all duration-2000 ease-in-out ${
              isSpeaking ? "translate-x-4 translate-y-4 scale-105" : "translate-x-0 translate-y-0 scale-100"
            }`}
          />

          <div
            className={`absolute bottom-0 right-0 w-40 h-40 md:w-56 md:h-56 bg-yellow rounded-full transition-all duration-3000 ease-in-out ${
              isSpeaking ? "scale-110" : "scale-100"
            }`}
          />

          <div
            className={`absolute bottom-0 left-10 w-24 h-48 md:w-32 md:h-64 bg-sky transition-all duration-2500 ease-in-out ${
              isSpeaking ? "h-56 md:h-72" : "h-48 md:h-64"
            }`}
          />

          <div className="absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 z-20">
            <div
              className={`w-32 h-32 md:w-40 md:h-40 rounded-full border-[6px] border-white shadow-xl overflow-hidden transition-transform duration-500 ${
                isSpeaking ? "scale-105" : "scale-100"
              }`}
            >
              <img src={agentAvatar.src} className="w-full h-full object-cover" alt={agentAlt} />
            </div>
          </div>
        </div>
      </div>

      <div className="relative z-20 px-6 pb-12 space-y-8 max-w-2xl mx-auto w-full">
        {/* Coaching nudge banner */}
        {nudgeTip && (
          <motion.div
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            className="flex items-center justify-center"
          >
            <button
              type="button"
              onClick={() => setNudgeTip(null)}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-amber-50 border border-amber-200 text-amber-800 text-sm font-sans shadow-sm"
            >
              <span className="text-amber-500 font-bold text-xs uppercase tracking-widest">Tip</span>
              <span>{nudgeTip}</span>
              <X size={14} className="text-amber-400 ml-1" />
            </button>
          </motion.div>
        )}

        <div className="text-center space-y-5">
          {/* Translation appears above when triggered */}
          {showTranscript && helpTranslation && (
            <motion.p
              initial={{ opacity: 0, y: -6 }}
              animate={{ opacity: 1, y: 0 }}
              className="text-xl md:text-2xl font-sans italic text-sky-600 leading-relaxed pt-2"
            >
              {helpTranslation}
            </motion.p>
          )}

          {showTranscript && helpError && (
            <p className="text-sm font-sans text-red-500">{helpError}</p>
          )}

          {/* Spanish text (blurred/revealed) */}
          <button
            type="button"
            className="relative group w-full focus:outline-none"
            onClick={() => setShowTranscript((prev) => !prev)}
          >
            <p
              className={`text-2xl md:text-3xl font-serif text-textMain transition-all duration-300 ${
                showTranscript ? "opacity-100 blur-none" : "opacity-20 blur-md"
              }`}
            >
              &ldquo;{lastMessage?.text}&rdquo;
            </p>

            <div className="mt-4 flex items-center justify-center gap-2 text-xs font-bold uppercase tracking-widest text-gray-400">
              {showTranscript ? <Eye size={14} /> : <EyeOff size={14} />}
              <span>{showTranscript ? "Hide captions" : "Show captions"}</span>
            </div>
          </button>

          {/* Translate button appears after reveal */}
          {showTranscript && (
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
              <button
                type="button"
                onClick={() => {
                  if (helpTranslation) {
                    setHelpTranslation(null);
                    lastTranslatedTextRef.current = "";
                  } else {
                    fetchHelpTranslation(lastTutorText, { force: true });
                  }
                }}
                disabled={helpLoading}
                className="inline-flex items-center gap-2 px-5 py-2.5 rounded-full text-sm font-bold uppercase tracking-widest bg-sky-50 border-2 border-sky-200 text-sky-600 hover:bg-sky-100 hover:border-sky-400 transition-colors disabled:opacity-50 shadow-sm"
              >
                {helpLoading ? (
                  <Loader2 size={16} className="animate-spin" />
                ) : (
                  <HelpCircle size={16} />
                )}
                <span>{helpTranslation ? "Hide translation" : "Translate"}</span>
              </button>
            </motion.div>
          )}
        </div>

        <div className="flex justify-center gap-6">
          <button
            onClick={() => setIsMuted((prev) => !prev)}
            className={`w-16 h-16 rounded-2xl flex items-center justify-center shadow-[4px_4px_0px_rgba(0,0,0,0.1)] transition-all active:translate-y-1 active:shadow-none ${
              isMuted ? "bg-red-500 text-white" : "bg-white text-textMain hover:bg-gray-50"
            }`}
          >
            {isMuted ? <MicOff size={24} /> : <Mic size={24} />}
          </button>
        </div>
      </div>

      {/* Reference Library Panel */}
      <ReferencePanel
        isOpen={showReferences}
        onClose={() => setShowReferences(false)}
        detectedReferences={detectedReferences}
        sessionReferences={sessionReferences}
        pinnedReferences={pinnedReferences}
        userId={userId || ""}
        conversationId={session.id}
        onSaveDetected={handleSaveDetectedReference}
        onPin={handlePinReference}
        onUnpin={handleUnpinReference}
        onDelete={handleDeleteReference}
        onManualAdd={handleManualAddReference}
      />
    </div>
  );
}

function formatTimer(seconds: number): string {
  const minutes = Math.floor(seconds / 60)
    .toString()
    .padStart(2, "0");
  const remaining = (seconds % 60).toString().padStart(2, "0");
  return `${minutes}:${remaining}`;
}