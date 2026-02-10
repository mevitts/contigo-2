import React from "react";
import { X, Mic, MicOff, HelpCircle, Eye, EyeOff, BookOpen, Loader2, Check, Plus, MessageCircle, ChevronRight } from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import type { SessionRecord, Reference } from "../lib/types";
import {
  translateText,
  createReference,
  listReferences,
} from "../lib/api";

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
        : "Connecting...",
    },
  ]);
  const [showTranscript, setShowTranscript] = React.useState(false);
  const [isSpeaking, setIsSpeaking] = React.useState(false);
  const [helpTranslation, setHelpTranslation] = React.useState<string | null>(null);
  const [helpLoading, setHelpLoading] = React.useState(false);
  const [helpError, setHelpError] = React.useState<string | null>(null);
  const [nudgeTip, setNudgeTip] = React.useState<string | null>(null);
  const nudgeTimeoutRef = React.useRef<number>();

  // Reference sidebar state
  const [showRefSidebar, setShowRefSidebar] = React.useState(false);
  const [savedRefs, setSavedRefs] = React.useState<Reference[]>([]);
  const [refsLoading, setRefsLoading] = React.useState(false);
  const [expandedRefId, setExpandedRefId] = React.useState<string | null>(null);
  const [showAddForm, setShowAddForm] = React.useState(false);
  const [pastedContent, setPastedContent] = React.useState("");
  const [pasteSaving, setPasteSaving] = React.useState(false);
  const [pasteSaved, setPasteSaved] = React.useState(false);

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
          : "Connecting...",
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

  const loadSavedRefs = React.useCallback(async () => {
    if (!userId) return;
    setRefsLoading(true);
    try {
      const refs = await listReferences(userId);
      if (isMountedRef.current) setSavedRefs(refs);
    } catch (error) {
      console.error("Failed to load references:", error);
    } finally {
      if (isMountedRef.current) setRefsLoading(false);
    }
  }, [userId]);

  // Load refs when sidebar opens
  React.useEffect(() => {
    if (showRefSidebar) loadSavedRefs();
  }, [showRefSidebar, loadSavedRefs]);

  const handleSavePastedContent = React.useCallback(async () => {
    const trimmed = pastedContent.trim();
    if (!trimmed || !userId) return;

    setPasteSaving(true);
    try {
      const firstLine = trimmed.split("\n")[0].slice(0, 60);
      const title = firstLine || "Pasted text";

      await createReference({
        userId,
        conversationId: session.id,
        title,
        referenceType: "OTHER",
        contentText: trimmed,
        detectionMethod: "manual",
        source: null,
        detectedContext: null,
      });

      setPastedContent("");
      setPasteSaved(true);
      setShowAddForm(false);
      loadSavedRefs(); // refresh list
      setTimeout(() => {
        if (isMountedRef.current) setPasteSaved(false);
      }, 2000);
    } catch (error) {
      console.error("Failed to save reference:", error);
    } finally {
      if (isMountedRef.current) setPasteSaving(false);
    }
  }, [pastedContent, userId, session.id, loadSavedRefs]);

  const [discussSentId, setDiscussSentId] = React.useState<string | null>(null);

  const handleDiscussReference = React.useCallback((ref: Reference) => {
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({
        type: "reference_context",
        title: ref.title,
        content: ref.contentText || ref.title,
      }));
    }
    // Show "Sent!" confirmation briefly before closing sidebar
    setDiscussSentId(ref.id);
    setTimeout(() => {
      if (isMountedRef.current) {
        setDiscussSentId(null);
        setShowRefSidebar(false);
      }
    }, 1200);
  }, []);

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
            <span className="text-sm font-bold uppercase tracking-widest text-gray-400">
              En Vivo
            </span>
            <span className="font-serif text-2xl text-textMain">{formatTimer(elapsedSeconds)}</span>
            <span className="text-xs font-bold uppercase tracking-[0.4em] text-gray-400">
              {connectionStatus === "connected" && "Live"}
              {connectionStatus === "connecting" && "Connecting"}
              {connectionStatus === "error" && "Offline"}
              {connectionStatus === "idle" && "Standby"}
            </span>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <button
            onClick={() => setShowRefSidebar((prev) => !prev)}
            className={`relative w-10 h-10 rounded-full flex items-center justify-center transition-all ${
              showRefSidebar
                ? "bg-emerald-500 text-white shadow-md"
                : "bg-white border-2 border-gray-200 text-gray-400 hover:border-emerald-400 hover:text-emerald-500"
            }`}
            title="Reference Library"
          >
            <BookOpen size={20} />
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
              className="text-2xl md:text-3xl font-sans italic text-sky-600 leading-relaxed pt-2"
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
              className={`text-3xl md:text-4xl font-serif text-textMain transition-all duration-300 ${
                showTranscript ? "opacity-100 blur-none" : "opacity-20 blur-md"
              }`}
            >
              &ldquo;{lastMessage?.text}&rdquo;
            </p>

            <div className="mt-4 flex items-center justify-center gap-2 text-sm font-bold uppercase tracking-widest text-gray-400">
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
                className="inline-flex items-center gap-2 px-5 py-2.5 rounded-full text-base font-bold uppercase tracking-widest bg-sky-50 border-2 border-sky-200 text-sky-600 hover:bg-sky-100 hover:border-sky-400 transition-colors disabled:opacity-50 shadow-sm"
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

      {/* Reference Library Sidebar */}
      <AnimatePresence>
        {showRefSidebar && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 0.3 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 z-40 bg-black"
              onClick={() => setShowRefSidebar(false)}
            />
            <motion.div
              initial={{ x: "100%" }}
              animate={{ x: 0 }}
              exit={{ x: "100%" }}
              transition={{ type: "spring", damping: 26, stiffness: 300 }}
              className="fixed top-0 right-0 bottom-0 z-50 w-80 md:w-96 bg-white shadow-2xl flex flex-col"
            >
              {/* Header */}
              <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
                <span className="text-sm font-bold uppercase tracking-widest text-gray-400">
                  Reference Library
                </span>
                <button
                  onClick={() => setShowRefSidebar(false)}
                  className="w-8 h-8 rounded-full bg-gray-100 flex items-center justify-center hover:bg-gray-200 transition-colors"
                >
                  <X size={16} className="text-gray-500" />
                </button>
              </div>

              {/* Add new button */}
              <div className="px-5 py-3 border-b border-gray-100">
                {!showAddForm ? (
                  <button
                    onClick={() => setShowAddForm(true)}
                    className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl border-2 border-dashed border-gray-200 text-gray-400 hover:border-emerald-400 hover:text-emerald-500 transition-colors text-sm font-bold uppercase tracking-widest"
                  >
                    <Plus size={16} />
                    Paste new text
                  </button>
                ) : (
                  <div className="space-y-2">
                    <textarea
                      value={pastedContent}
                      onChange={(e) => setPastedContent(e.target.value)}
                      placeholder="Paste lyrics, a story, article text..."
                      autoFocus
                      className="w-full h-24 p-3 rounded-xl border border-gray-200 bg-gray-50 text-sm text-textMain resize-none focus:outline-none focus:ring-2 focus:ring-emerald-300 focus:border-emerald-300"
                    />
                    <div className="flex items-center justify-end gap-2">
                      {pasteSaved && (
                        <span className="flex items-center gap-1 text-xs text-emerald-600 font-medium">
                          <Check size={12} /> Saved
                        </span>
                      )}
                      <button
                        onClick={() => { setShowAddForm(false); setPastedContent(""); }}
                        className="px-3 py-1.5 rounded-lg text-xs font-bold uppercase tracking-widest text-gray-400 hover:text-gray-600 transition-colors"
                      >
                        Cancel
                      </button>
                      <button
                        onClick={handleSavePastedContent}
                        disabled={!pastedContent.trim() || pasteSaving}
                        className="px-4 py-1.5 rounded-lg bg-emerald-500 text-white text-xs font-bold uppercase tracking-widest hover:bg-emerald-600 disabled:opacity-40 disabled:cursor-not-allowed transition-colors flex items-center gap-1"
                      >
                        {pasteSaving ? <Loader2 size={12} className="animate-spin" /> : null}
                        Save
                      </button>
                    </div>
                  </div>
                )}
              </div>

              {/* Reference list */}
              <div className="flex-1 overflow-y-auto px-5 py-3 space-y-2">
                {refsLoading && (
                  <div className="flex items-center justify-center py-8 text-gray-300">
                    <Loader2 size={20} className="animate-spin" />
                  </div>
                )}
                {!refsLoading && savedRefs.length === 0 && (
                  <p className="text-center text-sm text-gray-300 py-8">
                    No saved references yet. Paste text above to get started.
                  </p>
                )}
                {savedRefs.map((ref) => (
                  <div
                    key={ref.id}
                    className="rounded-xl border border-gray-100 bg-gray-50/50 overflow-hidden"
                  >
                    <button
                      type="button"
                      onClick={() => setExpandedRefId(expandedRefId === ref.id ? null : ref.id)}
                      className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-gray-50 transition-colors"
                    >
                      <ChevronRight
                        size={14}
                        className={`text-gray-300 transition-transform flex-shrink-0 ${expandedRefId === ref.id ? "rotate-90" : ""}`}
                      />
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-textMain truncate">{ref.title}</p>
                        <p className="text-xs text-gray-400 capitalize">{ref.referenceType.toLowerCase()}</p>
                      </div>
                    </button>
                    {expandedRefId === ref.id && (
                      <div className="px-4 pb-3 space-y-2">
                        {ref.contentText && (
                          <p className="text-xs text-gray-500 leading-relaxed whitespace-pre-wrap max-h-32 overflow-y-auto">
                            {ref.contentText}
                          </p>
                        )}
                        <button
                          onClick={() => handleDiscussReference(ref)}
                          disabled={discussSentId === ref.id}
                          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold uppercase tracking-widest transition-all ${
                            discussSentId === ref.id
                              ? "bg-emerald-50 border border-emerald-300 text-emerald-600"
                              : "bg-sky-50 border border-sky-200 text-sky-600 hover:bg-sky-100"
                          }`}
                        >
                          {discussSentId === ref.id ? (
                            <>
                              <Check size={12} />
                              Sent to tutor!
                            </>
                          ) : (
                            <>
                              <MessageCircle size={12} />
                              Discuss this
                            </>
                          )}
                        </button>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
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