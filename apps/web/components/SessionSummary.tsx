import React from "react";
import { Save, Trash2, RefreshCw, BookOpen, Target, X } from "lucide-react";
import { motion } from "motion/react";
import type { SessionRecord, SessionSummaryDetails, SessionHighlights } from "../lib/types";
import { getSessionSummary } from "../lib/api";

interface SessionSummaryProps {
  session: SessionRecord;
  durationSeconds: number;
  onBackHome: () => void;
  onPracticeAgain: () => void;
  cachedSummary?: SessionSummaryDetails;
  onSummaryFetched?: (sessionId: string, summary: SessionSummaryDetails) => void;
}

const SUMMARY_BADGES = {
  generating: "bg-sky/15 text-sky-900 border border-sky/30",
  ready: "bg-emerald/15 text-emerald-900 border border-emerald/30",
  pending: "bg-amber/20 text-amber-900 border border-amber/30",
} as const;

const HIGHLIGHT_SECTIONS: Array<{ title: string; key: keyof SessionHighlights }> = [
  { title: "Topics Covered", key: "topics" },
  { title: "Standout Moments", key: "notableMoments" },
  { title: "Next Focus", key: "learningFocus" },
];

const SUMMARY_FETCH_DELAYS_MS = [900, 1800, 3200, 5000];

const HIGHLIGHT_ACCENTS = [
  { bg: "bg-[#fff5ed]", border: "border-[#ffd2a0]/70", dot: "bg-[#f68b1f]" },
  { bg: "bg-[#eef6ff]", border: "border-[#a6c8ff]/70", dot: "bg-[#3c82f6]" },
  { bg: "bg-[#f3f1ff]", border: "border-[#c7befa]/70", dot: "bg-[#7156f1]" },
];

export function SessionSummary({ session, durationSeconds, onBackHome, onPracticeAgain, cachedSummary, onSummaryFetched }: SessionSummaryProps) {
  const [summaryData, setSummaryData] = React.useState<SessionSummaryDetails | null>(cachedSummary ?? null);
  const [loading, setLoading] = React.useState(!cachedSummary);
  const [statusMessage, setStatusMessage] = React.useState<string | null>(null);
  const [refreshIndex, setRefreshIndex] = React.useState(0);
  const sessionDate = React.useMemo(() => new Date(session.createdAt), [session.createdAt]);
  const sessionDateLabel = React.useMemo(
    () =>
      sessionDate.toLocaleString(undefined, {
        weekday: "short",
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
      }),
    [sessionDate]
  );
  const displayTopic = React.useMemo(() => {
    const trimmed = session.topic?.trim();
    if (!trimmed) {
      return session.agentDisplayName ? `${session.agentDisplayName} recap` : "Session recap";
    }
    if (trimmed.toLowerCase() === "general practice") {
      return "Session recap";
    }
    return trimmed;
  }, [session.agentDisplayName, session.topic]);

  React.useEffect(() => {
    // Skip fetching if we have a cached summary and this is not a manual refresh
    if (cachedSummary && refreshIndex === 0) {
      setSummaryData(cachedSummary);
      setLoading(false);
      return;
    }

    let cancelled = false;
    let attempt = 0;

    const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

    setLoading(true);
    setStatusMessage(null);
    if (!cachedSummary) {
      setSummaryData(null);
    }

    const fetchWithBackoff = async () => {
      while (!cancelled && attempt < SUMMARY_FETCH_DELAYS_MS.length + 1) {
        const delay = SUMMARY_FETCH_DELAYS_MS[Math.min(attempt, SUMMARY_FETCH_DELAYS_MS.length - 1)];
        if (delay) {
          await wait(delay);
          if (cancelled) {
            return;
          }
        }

        try {
          const data = await getSessionSummary(session.id);
          if (cancelled) {
            return;
          }
          if (data) {
            setSummaryData(data);
            setStatusMessage(null);
            setLoading(false);
            // Cache the summary for future views
            onSummaryFetched?.(session.id, data);
            return;
          }
          setStatusMessage("Your notes are still rendering. Try again in a moment.");
        } catch (error) {
          if (cancelled) {
            return;
          }
          const message = error instanceof Error ? error.message : "We couldn't load your summary.";
          setStatusMessage(message);
        }

        attempt += 1;
      }

      if (!cancelled) {
        setLoading(false);
      }
    };

    void fetchWithBackoff();

    return () => {
      cancelled = true;
    };
  }, [session.id, refreshIndex, cachedSummary, onSummaryFetched]);

  const handleRefresh = React.useCallback(() => {
    setRefreshIndex((prev) => prev + 1);
  }, []);

  const formattedDuration = React.useMemo(() => formatDuration(durationSeconds), [durationSeconds]);

  const highlights = summaryData?.highlights;
  const highlightSections = HIGHLIGHT_SECTIONS.map((section) => ({
    title: section.title,
    items: (highlights?.[section.key] as string[]) ?? [],
  }));
  const spanishSnippets = summaryData?.highlights.spanishSnippets ?? [];
  const personalConnections = summaryData?.highlights.personalConnections ?? [];
  const errorInsights = summaryData?.highlights.errorInsights ?? [];

  const badgeKey = loading ? "generating" : summaryData ? "ready" : "pending";
  const badgeClass = SUMMARY_BADGES[badgeKey];
  const moodMessage = summaryData?.summary
    ? "Ready to file in your notebook."
    : statusMessage || (loading ? "We’re distilling your takeaways." : "Keep practicing while we wrap these notes.");
  const localizedVariant = summaryData?.localizedSummary;
  const localizedSummaryText = localizedVariant?.text?.trim();
  const displaySummary = localizedSummaryText || summaryData?.summary || moodMessage;

  const summaryBackdropClass = loading ? "bg-white border-amber/40 shadow-lg" : "bg-white";

  return (
    <div className="min-h-screen bg-[#f7f2ea] px-4 py-10">
      <motion.div
        initial={{ opacity: 0, y: 24 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.35, ease: "easeOut" }}
        className="mx-auto w-full max-w-5xl rounded-3xl bg-white shadow-[0_35px_120px_rgba(0,0,0,0.08)] border border-black/5"
      >
        <div className="border-b border-black/5 px-6 py-6 md:px-10 relative">
          <button
            type="button"
            onClick={onPracticeAgain}
            className="absolute top-4 right-4 md:top-6 md:right-6 p-2 rounded-full text-gray-400 hover:text-gray-700 hover:bg-black/5 transition-colors"
            aria-label="Close summary"
          >
            <X size={20} />
          </button>
          <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between pr-10">
            <div>
              <p className="text-sm font-bold uppercase tracking-[0.35em] text-gray-500">Session recap</p>
              <h1 className="text-4xl font-serif text-textMain">{displayTopic}</h1>
              <p className="text-base font-semibold text-gray-600">Session length · {formattedDuration}</p>
            </div>
            <div className="flex flex-wrap gap-2 items-center">
              <span className={`inline-flex items-center rounded-full px-3 py-1 text-sm font-bold uppercase tracking-[0.3em] ${badgeClass}`}>
                {badgeKey === "ready" && "Ready"}
                {badgeKey === "generating" && "Drafting"}
                {badgeKey === "pending" && "Pending"}
              </span>
              <span className="text-sm font-semibold uppercase tracking-[0.3em] text-gray-600 border border-dashed border-gray-300 rounded-full px-3 py-1">
                {sessionDateLabel}
              </span>
              <button
                type="button"
                onClick={handleRefresh}
                disabled={loading}
                className="inline-flex items-center gap-1 rounded-full border border-black/10 px-3 py-1 text-sm font-bold uppercase tracking-[0.3em] text-textMain hover:bg-black/5 transition-colors disabled:opacity-40"
              >
                <RefreshCw size={14} />
                Refresh
              </button>
            </div>
          </div>
        </div>

        <div className="px-6 py-8 md:px-10 md:py-10 space-y-8">
          <div className="grid gap-6 md:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
            <div className="space-y-5">
              <section className={`rounded-2xl border border-black/5 p-6 ${summaryBackdropClass}`}>
                <div className="flex items-center justify-between gap-4">
                  <p className="text-sm font-bold uppercase tracking-[0.35em] text-gray-500">Summary</p>
                  {localizedVariant && (
                    <span className="text-xs uppercase tracking-[0.35em] text-sky-600">
                      {localizedVariant.language === "es"
                        ? "Versión en español"
                        : `Localized (${localizedVariant.language})`}
                    </span>
                  )}
                </div>
                <p className="mt-4 text-xl font-serif leading-relaxed text-textMain">
                  {displaySummary}
                </p>
                {summaryData?.episodicSummary && (
                  <div className="mt-6 rounded-2xl border border-sky/25 bg-sky/5 p-4 text-base text-sky-900 flex gap-3">
                    <BookOpen size={18} className="mt-[2px]" />
                    <div>
                      <p className="text-sm font-bold uppercase tracking-[0.35em] text-sky-700 mb-1">Memory pulse</p>
                      <p className="leading-relaxed">{summaryData.episodicSummary}</p>
                    </div>
                  </div>
                )}
              </section>
              {spanishSnippets.length > 0 && (
                <section className="rounded-2xl border border-amber/40 bg-[#fffaf2] p-5 shadow-[0_15px_35px_rgba(255,149,5,0.08)]">
                  <p className="text-sm font-bold uppercase tracking-[0.35em] text-amber-700">
                    Spanish phrases to reuse
                  </p>
                  <ul className="mt-4 space-y-3">
                    {spanishSnippets.map((snippet, idx) => (
                      <li key={`${snippet.spanish}-${idx}`} className="rounded-2xl border border-white/60 bg-white/70 p-3">
                        <p className="font-serif text-xl text-textMain">{snippet.spanish}</p>
                        {(snippet.english || snippet.context) && (
                          <p className="text-base text-gray-600">
                            {snippet.english && <span className="italic">{snippet.english}</span>}
                            {snippet.english && snippet.context ? " · " : ""}
                            {snippet.context}
                          </p>
                        )}
                      </li>
                    ))}
                  </ul>
                </section>
              )}
              {personalConnections.length > 0 && (
                <section className="rounded-2xl border border-emerald/40 bg-[#f0fff6] p-5 shadow-[0_15px_35px_rgba(16,185,129,0.12)]">
                  <p className="text-sm font-bold uppercase tracking-[0.35em] text-emerald-700">
                    Personal callbacks
                  </p>
                  <ul className="mt-3 space-y-2 text-base text-textMain">
                    {personalConnections.map((detail, idx) => (
                      <li key={`${detail}-${idx}`} className="flex items-start gap-2">
                        <span className="mt-1 h-2 w-2 rounded-full bg-emerald-400" />
                        <span>{detail}</span>
                      </li>
                    ))}
                  </ul>
                </section>
              )}
            </div>

            <section className="rounded-2xl border border-black/5 bg-white/95 p-5 space-y-5">
              {errorInsights.length > 0 && (
                <div className="rounded-2xl border border-violet-200 bg-[#f8f5ff] p-4 shadow-[0_12px_30px_rgba(124,58,237,0.08)]">
                  <div className="flex items-center gap-2 text-violet-600">
                    <Target size={18} />
                    <p className="text-sm font-bold uppercase tracking-[0.35em]">Areas to Practice</p>
                  </div>
                  <ul className="mt-3 space-y-2 text-base text-textMain">
                    {errorInsights.map((insight, idx) => (
                      <li key={`${insight}-${idx}`} className="leading-snug">
                        {insight}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {highlightSections.map((section, index) => {
                const accent = HIGHLIGHT_ACCENTS[index % HIGHLIGHT_ACCENTS.length];
                return (
                  <div
                    key={section.title}
                    className={`rounded-2xl border ${accent.border} ${accent.bg} p-4 shadow-[inset_0_0_0_1px_rgba(255,255,255,0.4)]`}
                  >
                    <div className="flex items-center gap-2">
                      <span className={`h-2 w-8 rounded-full ${accent.dot} opacity-80`} />
                      <p className="text-sm font-bold uppercase tracking-[0.35em] text-gray-600">
                        {section.title}
                      </p>
                    </div>
                    {section.items.length ? (
                      <ul className="mt-3 space-y-1.5 text-base text-textMain">
                        {section.items.map((item, itemIndex) => (
                          <li key={`${section.title}-${itemIndex}`} className="leading-snug">
                            • {item}
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <p className="mt-3 text-base text-gray-400">No notes just yet.</p>
                    )}
                  </div>
                );
              })}
            </section>
          </div>

          <div className="flex flex-col gap-3 md:flex-row">
            <button
              onClick={onBackHome}
              className="flex-1 py-3 border-2 border-gray-200 text-gray-600 font-bold uppercase tracking-[0.35em] text-sm hover:border-gray-500 hover:text-gray-800 transition-colors flex items-center justify-center gap-2"
            >
              <Trash2 size={16} />
              Discard Session
            </button>
            <button
              onClick={onPracticeAgain}
              className="flex-1 py-3 bg-black text-white font-bold uppercase tracking-[0.35em] text-sm shadow-[5px_5px_0px_#E6007E] hover:translate-y-1 hover:shadow-none transition-all flex items-center justify-center gap-2"
            >
              <Save size={16} />
              Save & Practice
            </button>
          </div>
        </div>
      </motion.div>
    </div>
  );
}

function formatDuration(seconds: number): string {
  const minutes = Math.floor(seconds / 60)
    .toString()
    .padStart(2, "0");
  const remaining = (seconds % 60).toString().padStart(2, "0");
  return `${minutes}m ${remaining}s`;
}
