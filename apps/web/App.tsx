import React from "react";
import { Dashboard } from "./components/Dashboard";
import { VoiceSession } from "./components/VoiceSession"; 
import { SessionSummary } from "./components/SessionSummary";
import { Settings } from "./components/Settings";
import { SessionHistory } from "./components/SessionHistory";
import { PreRollView } from "./components/PreRollView";
import { LoginView } from "./components/LoginView";
import { PremiumOffer, type PremiumPlanOption, type PremiumPlanId } from "./components/PremiumOffer";
import { MockStripeCheckout } from "./components/MockStripeCheckout";
import {
  authenticateDemoUser,
  listSessions,
  createSession,
  deleteSession,
  getVoiceWebsocketUrl,
  completeSession,
  ContigoApiError,
} from "./lib/api";
import type { SessionRecord, UserProfile, SessionSummaryDetails } from "./lib/types";
import { appConfig } from "./lib/config";
import { ArrowLeft } from "lucide-react";

type AppView =
  | "loading"
  | "login"
  | "dashboard"
  | "preroll"
  | "session"
  | "summary"
  | "history"
  | "settings"
  | "premium"
  | "checkout";

type DifficultyLevel = "beginner" | "intermediate" | "advanced";

const PREMIUM_LIMIT_FALLBACK_MINUTES = 5;

const premiumPlanOptions: PremiumPlanOption[] = [
  {
    id: "monthly",
    label: "Monthly",
    billingInterval: "Monthly",
    price: 29,
    minutesIncluded: 200,
    subtitle: "Great for weekly coffee chats",
    highlight: "Most Popular",
  },
  {
    id: "yearly",
    label: "Yearly",
    billingInterval: "Yearly",
    price: 299,
    minutesIncluded: 3000,
    subtitle: "Best value for daily immersion",
    highlight: "Best Value",
  },
];

const premiumPlanMap: Record<PremiumPlanId, PremiumPlanOption> = premiumPlanOptions.reduce(
  (acc, plan) => {
    acc[plan.id] = plan;
    return acc;
  },
  {} as Record<PremiumPlanId, PremiumPlanOption>
);

const PREFERENCE_STORAGE_KEY = "contigo:learning-preferences";

const DEFAULT_PREFERENCES: { difficulty: DifficultyLevel; adaptive: boolean } = {
  difficulty: "beginner",
  adaptive: true,
};

const USER_STORAGE_KEY = "contigo:user";

//console.log('dev mode?', import.meta.env.VITE_CONTIGO_DEVELOPER_MODE, appConfig);
//console.log('config', appConfig.developerMode, appConfig.devUserProfile);

function loadStoredUser(): UserProfile | null {
  if (typeof window === "undefined") {
    return null;
  }
  try {
    const raw = window.localStorage.getItem(USER_STORAGE_KEY);
    return raw ? (JSON.parse(raw) as UserProfile) : null;
  } catch (_err) {
    return null;
  }
}

function persistUser(profile: UserProfile | null): void {
  if (typeof window === "undefined") {
    return;
  }
  try {
    if (profile) {
      window.localStorage.setItem(USER_STORAGE_KEY, JSON.stringify(profile));
    } else {
      window.localStorage.removeItem(USER_STORAGE_KEY);
    }
  } catch (_err) {
    // Ignore storage errors (e.g., Safari private mode)
  }
}

function loadStoredPreferences(): { difficulty: DifficultyLevel; adaptive: boolean } {
  if (typeof window === "undefined") {
    return DEFAULT_PREFERENCES;
  }
  try {
    const raw = window.localStorage.getItem(PREFERENCE_STORAGE_KEY);
    if (!raw) {
      return DEFAULT_PREFERENCES;
    }
    const parsed = JSON.parse(raw) as Partial<{ difficulty: DifficultyLevel; adaptive: boolean }>;
    const difficulty = parsed?.difficulty ?? DEFAULT_PREFERENCES.difficulty;
    const adaptive = typeof parsed?.adaptive === "boolean" ? parsed.adaptive : DEFAULT_PREFERENCES.adaptive;
    return { difficulty, adaptive };
  } catch (_err) {
    return DEFAULT_PREFERENCES;
  }
}

function persistPreferences(difficulty: DifficultyLevel, adaptive: boolean): void {
  if (typeof window === "undefined") {
    return;
  }
  try {
    window.localStorage.setItem(
      PREFERENCE_STORAGE_KEY,
      JSON.stringify({ difficulty, adaptive })
    );
  } catch (_err) {
    // Ignore persistence errors (e.g., private browsing)
  }
}

function extractUserFromUrl(): { profile: UserProfile | null; error?: string } {
  if (typeof window === "undefined") {
    return { profile: null };
  }
  const params = new URLSearchParams(window.location.search);
  const authStatus = params.get("auth");
  if (!authStatus) {
    return { profile: null };
  }

  window.history.replaceState({}, document.title, window.location.pathname);

  if (authStatus !== "success") {
    return { profile: null, error: params.get("message") || "Authentication failed" };
  }

  const userId = params.get("user_id");
  if (!userId) {
    return { profile: null, error: "Account missing user ID" };
  }

  const profile: UserProfile = {
    id: userId,
    email: params.get("email") || undefined,
    firstName: params.get("first_name") || undefined,
    lastName: params.get("last_name") || undefined,
    demoMode: params.get("demo_mode") === "1",
  };

  return { profile };
}

function resolveErrorMessage(error: unknown): string {
  if (error instanceof ContigoApiError) {
    return error.message || `Request failed (${error.status})`;
  }
  if (error instanceof Error) {
    return error.message;
  }
  return "Unexpected error occurred.";
}

export default function App() {
  const [view, setView] = React.useState<AppView>("loading");
  const [user, setUser] = React.useState<UserProfile | null>(null);
  const [sessions, setSessions] = React.useState<SessionRecord[]>([]);
  const [sessionsLoading, setSessionsLoading] = React.useState(false);
  const [sessionsError, setSessionsError] = React.useState<string | null>(null);
  const [appError, setAppError] = React.useState<string | null>(null);
  const [activeSession, setActiveSession] = React.useState<SessionRecord | null>(null);
  const [sessionDuration, setSessionDuration] = React.useState(0);
  const [voiceUrl, setVoiceUrl] = React.useState<string | undefined>(undefined);
  const [voiceConnectionError, setVoiceConnectionError] = React.useState<string | null>(null);
  const [isAuthenticating, setIsAuthenticating] = React.useState(false);
  const [isStartingSession, setIsStartingSession] = React.useState(false);
  const [premiumContext, setPremiumContext] = React.useState<{ durationSeconds: number } | null>(null);
  const [selectedPlan, setSelectedPlan] = React.useState<PremiumPlanId | null>(null);
  const [summaryCache, setSummaryCache] = React.useState<Record<string, SessionSummaryDetails>>({});

  const initialPreferences = React.useMemo(() => loadStoredPreferences(), []);
  const [difficultyPreference, setDifficultyPreference] = React.useState<DifficultyLevel>(initialPreferences.difficulty);
  const [adaptivePreference] = React.useState<boolean>(true);
  const [extraSupportMode, setExtraSupportMode] = React.useState<boolean>(false);
  const userMembershipTier = user?.membershipTier ?? (user?.demoMode ? "demo" : "free");
  const isPremiumUser = userMembershipTier === "premium";
  const freeLimitSeconds = React.useMemo(() => {
    const minutes = user?.maxConversationMinutes ?? PREMIUM_LIMIT_FALLBACK_MINUTES;
    return Math.round(Math.max(minutes, 1) * 60);
  }, [user?.maxConversationMinutes]);

  React.useEffect(() => {
    persistPreferences(difficultyPreference, adaptivePreference);
  }, [difficultyPreference, adaptivePreference]);

  const handleDifficultyChange = React.useCallback((level: DifficultyLevel) => {
    setDifficultyPreference(level);
    // Reset extra support when changing away from beginner
    if (level !== "beginner") {
      setExtraSupportMode(false);
    }
  }, []);

  const handleExtraSupportChange = React.useCallback((enabled: boolean) => {
    setExtraSupportMode(enabled);
  }, []);

  const handleSummaryFetched = React.useCallback((sessionId: string, summary: SessionSummaryDetails) => {
    setSummaryCache((prev) => ({ ...prev, [sessionId]: summary }));
  }, []);

  const applyAuthenticatedUser = React.useCallback((profile: UserProfile | null) => {
    setUser(profile);
    persistUser(profile);
  }, []);

  React.useEffect(() => {
    if (appConfig.developerMode && appConfig.devUserProfile?.id) {
      const profile: UserProfile = {
        id: appConfig.devUserProfile.id,
        email: appConfig.devUserProfile.email,
        firstName: appConfig.devUserProfile.firstName,
        lastName: appConfig.devUserProfile.lastName,
        demoMode: appConfig.devUserProfile.demoMode ?? false,
        developerMode: true,
      };
      applyAuthenticatedUser(profile);
      setView("dashboard");
      return;
    }

    const stored = loadStoredUser();
    if (stored) {
      applyAuthenticatedUser(stored);
      setView("dashboard");
      return;
    }

    const { profile, error } = extractUserFromUrl();
    if (profile) {
      applyAuthenticatedUser(profile);
      setView("dashboard");
      return;
    }

    if (error) {
      setAppError(error);
    }
    setView("login");
  }, [applyAuthenticatedUser]);

  const refreshSessions = React.useCallback(async () => {
    if (!user?.id) {
      return;
    }

    setSessionsLoading(true);
    setSessionsError(null);
    try {
      const data = await listSessions(user.id);
      const sorted = [...data].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
      setSessions(sorted);
    } catch (error) {
      setSessionsError(resolveErrorMessage(error));
    } finally {
      setSessionsLoading(false);
    }
  }, [user?.id]);

  React.useEffect(() => {
    if (!user?.id) {
      return;
    }
    void refreshSessions();
  }, [user?.id, refreshSessions]);

  const handleStartSession = React.useCallback(async () => {
    if (!user) {
      setAppError("You need to sign in before starting a session.");
      setView("login");
      return;
    }

    setIsStartingSession(true);
    setVoiceConnectionError(null);
    setAppError(null);
    setPremiumContext(null);
    setSelectedPlan(null);

    try {
      const newSession = await createSession({
        userId: user.id,
        agentId: appConfig.defaultAgentId,
        agentName: appConfig.defaultAgentName,
        language: appConfig.defaultLanguage,
        difficulty: difficultyPreference,
        adaptive: adaptivePreference,
      });

      const sessionWithPrefs: SessionRecord = {
        ...newSession,
        difficulty: newSession.difficulty ?? difficultyPreference,
        adaptive:
          typeof newSession.adaptive === "boolean" ? newSession.adaptive : adaptivePreference,
      };

      setActiveSession(sessionWithPrefs);
      setSessionDuration(0);
      setVoiceUrl(undefined);
      setSessions((prev) => [sessionWithPrefs, ...prev.filter((session) => session.id !== newSession.id)]);
      
      // Start with PreRoll
      setView("preroll");

      try {
        const voiceInfo = await getVoiceWebsocketUrl({
          sessionId: sessionWithPrefs.id,
          userId: user.id,
          difficulty: sessionWithPrefs.difficulty ?? difficultyPreference,
          adaptive:
            typeof sessionWithPrefs.adaptive === "boolean"
              ? sessionWithPrefs.adaptive
              : adaptivePreference,
          extraSupport: extraSupportMode && difficultyPreference === "beginner",
        });
        setVoiceUrl(voiceInfo.websocketUrl || undefined);
        setActiveSession((prev) =>
          prev && prev.id === sessionWithPrefs.id
            ? {
                ...prev,
                difficulty: voiceInfo.difficulty ?? prev.difficulty ?? null,
                adaptive:
                  typeof voiceInfo.adaptive === "boolean" ? voiceInfo.adaptive : prev.adaptive,
              }
            : prev,
        );
        setSessions((prev) =>
          prev.map((session) =>
            session.id === sessionWithPrefs.id
              ? {
                  ...session,
                  difficulty: voiceInfo.difficulty ?? session.difficulty ?? null,
                  adaptive:
                    typeof voiceInfo.adaptive === "boolean"
                      ? voiceInfo.adaptive
                      : session.adaptive,
                }
              : session,
          ),
        );
      } catch (error) {
        setVoiceConnectionError(resolveErrorMessage(error));
      }
    } catch (error) {
      setAppError(resolveErrorMessage(error));
      setActiveSession(null);
      setView("dashboard");
    } finally {
      setIsStartingSession(false);
    }
  }, [user, adaptivePreference, difficultyPreference]);

  const handlePreRollComplete = React.useCallback(() => {
    setView("session");
  }, []);

  const handleEndSession = React.useCallback(
    (durationSeconds: number) => {
      setSessionDuration(durationSeconds);
      setVoiceUrl(undefined);
      setVoiceConnectionError(null);

      const finalize = async () => {
        if (activeSession) {
          try {
            const completed = await completeSession(activeSession.id, {
              endTime: new Date().toISOString(),
              difficulty: activeSession.difficulty ?? difficultyPreference,
              adaptive: typeof activeSession.adaptive === "boolean" ? activeSession.adaptive : adaptivePreference,
              topic: activeSession.topic ?? null,
            });
            setActiveSession(completed);
            setSessions((prev) => prev.map((session) => (session.id === completed.id ? completed : session)));
          } catch (error) {
            setAppError(resolveErrorMessage(error));
          }
        }
        void refreshSessions();
        if (!isPremiumUser && durationSeconds >= freeLimitSeconds) {
          setPremiumContext({ durationSeconds });
          setView("premium");
        } else {
          setView("summary");
        }
      };

      void finalize();
    },
    [activeSession, adaptivePreference, difficultyPreference, refreshSessions, isPremiumUser, freeLimitSeconds],
  );

  const handleSessionSelected = React.useCallback((session: SessionRecord) => {
    setActiveSession(session);
    setSessionDuration(0);
    setView("summary");
  }, []);

  const handlePremiumSkip = React.useCallback(() => {
    setPremiumContext(null);
    setSelectedPlan(null);
    setView("summary");
  }, []);

  const handlePlanSelected = React.useCallback((planId: PremiumPlanId) => {
    setSelectedPlan(planId);
    setView("checkout");
  }, []);

  const handleCheckoutComplete = React.useCallback(() => {
    setUser((prev) => (prev ? { ...prev, membershipTier: "premium" } : prev));
    setPremiumContext(null);
    setSelectedPlan(null);
    setView("summary");
  }, []);

  const handleCheckoutBack = React.useCallback(() => {
    setSelectedPlan(null);
    setView("premium");
  }, []);

  const handleUpgradeFromPassport = React.useCallback(() => {
    setPremiumContext({ durationSeconds: freeLimitSeconds });
    setSelectedPlan(null);
    setView("premium");
  }, [freeLimitSeconds]);

  const handleDiscardSession = React.useCallback(async () => {
    if (!activeSession) {
      setView("dashboard");
      return;
    }

    try {
      await deleteSession(activeSession.id);
      setSessions((prev) => prev.filter((s) => s.id !== activeSession.id));
      setActiveSession(null);
    } catch (error) {
      setAppError(resolveErrorMessage(error));
    } finally {
      setView("dashboard");
      void refreshSessions();
    }
  }, [activeSession, refreshSessions]);

  const handleSaveSession = React.useCallback(async () => {
    // Session already persisted; just refresh and go to notebook/history.
    await refreshSessions();
    setView("history");
  }, [refreshSessions]);

  const handleSessionDeleted = React.useCallback(
    async (sessionId: string) => {
      try {
        await deleteSession(sessionId);
        setSessions((prev) => prev.filter((session) => session.id !== sessionId));
        if (activeSession?.id === sessionId) {
          setActiveSession(null);
        }
      } catch (error) {
        setAppError(resolveErrorMessage(error));
      }
    },
    [activeSession?.id],
  );

  const handleLogout = React.useCallback(() => {
    setUser(null);
    persistUser(null);
    setSessions([]);
    setActiveSession(null);
    setVoiceUrl(undefined);
    setSessionDuration(0);
    setView("login");
    setAppError(null);
  }, []);

  const startGoogleLogin = React.useCallback(() => {
    if (typeof window === "undefined") {
      return;
    }
    const loginUrl = new URL("/auth/login", appConfig.apiBaseUrl);
    loginUrl.searchParams.set("redirect", window.location.origin);
    window.location.href = loginUrl.toString();
  }, []);

  const startDemoLogin = React.useCallback(async () => {
    setIsAuthenticating(true);
    setAppError(null);
    try {
      const profile = await authenticateDemoUser();
      applyAuthenticatedUser(profile);
      setView("dashboard");
    } catch (error) {
      setAppError(resolveErrorMessage(error));
    } finally {
      setIsAuthenticating(false);
    }
  }, [applyAuthenticatedUser]);

  const userName = React.useMemo(() => {
    const { firstName, lastName } = user ?? {};
    if (!firstName && !lastName) {
      return "Explorer";
    }
    return [firstName, lastName].filter(Boolean).join(" ");
  }, [user]);
  const checkoutPlan = selectedPlan ? premiumPlanMap[selectedPlan] : null;

  const handleVoiceConnectionError = React.useCallback((message: string) => {
    setVoiceConnectionError(message);
  }, []);

  // Only show nav for history and settings
  const shouldShowNav = view === "history" || view === "settings";

  return (
    <div className="min-h-screen bg-plaster text-textMain font-sans">
      {shouldShowNav && (
        <header className="sticky top-0 z-40 bg-white/80 backdrop-blur-md border-b border-black/5">
          <div className="max-w-5xl mx-auto px-4 py-3 flex items-center justify-between">
            <button
              onClick={() => setView("dashboard")}
              className="flex items-center gap-2 text-sm font-bold uppercase tracking-widest hover:text-pink transition-colors"
            >
              <ArrowLeft size={16} />
              Back to Dashboard
            </button>
          </div>
        </header>
      )}

      {appError && (
        <div className="fixed top-4 right-4 max-w-sm bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-xl shadow-md z-50">
          {appError}
        </div>
      )}

      {voiceConnectionError && view === "session" && (
        <div className="fixed top-4 left-1/2 -translate-x-1/2 max-w-lg bg-amber-50 border border-amber-200 text-amber-800 px-4 py-3 rounded-xl shadow-md z-50">
          {voiceConnectionError}
        </div>
      )}

      <main>
        {view === "login" && (
          <LoginView
            onGoogleLogin={startGoogleLogin}
            onDemoLogin={startDemoLogin}
            isLoading={isAuthenticating}
            error={appError}
          />
        )}

        {view === "loading" && (
          <div className="flex min-h-screen items-center justify-center text-muted-foreground font-serif text-xl animate-pulse">
            {isAuthenticating ? "Connecting to Contigo..." : "Preparing your experience..."}
          </div>
        )}

        {view === "dashboard" && (
          <Dashboard
            userName={userName}
            onStartSession={handleStartSession}
            onGoToSettings={() => setView("settings")}
            onGoToNotebook={() => setView("history")}
            sessions={sessions}
            isLoading={sessionsLoading || isStartingSession}
          />
        )}

        {view === "preroll" && (
          <PreRollView onComplete={handlePreRollComplete} />
        )}

        {view === "history" && (
          <SessionHistory
            sessions={sessions}
            isLoading={sessionsLoading}
            error={sessionsError}
            onRefresh={() => {
              void refreshSessions();
            }}
            onDelete={(sessionId) => {
              void handleSessionDeleted(sessionId);
            }}
            onSelectSession={handleSessionSelected}
          />
        )}

        {view === "premium" && premiumContext && (
          <PremiumOffer
            durationSeconds={premiumContext.durationSeconds}
            freeLimitSeconds={freeLimitSeconds}
            plans={premiumPlanOptions}
            onSelectPlan={handlePlanSelected}
            onSkip={handlePremiumSkip}
          />
        )}

        {view === "settings" && (
            <Settings
              user={user}
              onLogout={handleLogout}
              difficulty={difficultyPreference}
              adaptiveMode={adaptivePreference}
              extraSupportMode={extraSupportMode}
              onDifficultyChange={handleDifficultyChange}
              onExtraSupportChange={handleExtraSupportChange}
              onUpgrade={handleUpgradeFromPassport}
            />
        )}

        {view === "session" && activeSession && (
          <VoiceSession
            session={activeSession}
            websocketUrl={voiceUrl}
            onEndSession={handleEndSession}
            onConnectionError={handleVoiceConnectionError}
            maxDurationSeconds={isPremiumUser ? undefined : freeLimitSeconds}
          />
        )}

        {view === "session" && !activeSession && (
          <div className="flex min-h-screen items-center justify-center text-muted-foreground">
            Unable to load the current session.
          </div>
        )}

        {view === "summary" && activeSession && (
          <SessionSummary
            session={activeSession}
            durationSeconds={sessionDuration}
            onBackHome={handleDiscardSession}
            onPracticeAgain={handleSaveSession}
            cachedSummary={summaryCache[activeSession.id]}
            onSummaryFetched={handleSummaryFetched}
          />
        )}

        {view === "summary" && !activeSession && (
          <div className="flex min-h-screen items-center justify-center text-muted-foreground">
            Session details are unavailable.
          </div>
        )}
        {view === "checkout" && checkoutPlan && (
          <MockStripeCheckout
            plan={checkoutPlan}
            onBack={handleCheckoutBack}
            onComplete={handleCheckoutComplete}
          />
        )}
      </main>
    </div>
  );
}
