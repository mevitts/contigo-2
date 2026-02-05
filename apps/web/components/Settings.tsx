import { Mic, Settings as SettingsIcon, LogOut, Sparkles } from "lucide-react";
import { motion } from "motion/react";
import type { UserProfile } from "../lib/types";

interface SettingsProps {
  user: UserProfile | null;
  onLogout: () => void;
  difficulty: "beginner" | "intermediate" | "advanced";
  adaptiveMode: boolean;
  extraSupportMode?: boolean;
  onDifficultyChange: (difficulty: "beginner" | "intermediate" | "advanced") => void;
  onExtraSupportChange?: (enabled: boolean) => void;
  onUpgrade?: () => void;
}

export function Settings({
  user,
  onLogout,
  difficulty,
  adaptiveMode,
  extraSupportMode = false,
  onDifficultyChange,
  onExtraSupportChange,
  onUpgrade,
}: SettingsProps) {
  const fullName = [user?.firstName, user?.lastName].filter(Boolean).join(" ") || "Explorer";
  const email = user?.email ?? "demo@contigo.app";
  const accountId = user?.id ?? "demo-user-00000000";
  const membershipTag = user?.demoMode ? "Demo Mode" : "Member";
  const showUpgradeCta = Boolean(user?.demoMode && onUpgrade);

  return (
    <div className="min-h-screen bg-plaster pb-24 px-4 py-8 font-sans">
      <div className="max-w-3xl mx-auto space-y-8">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="space-y-2"
        >
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 bg-yellow rounded-full flex items-center justify-center shadow-lg">
               <SettingsIcon className="w-6 h-6 text-textMain" />
            </div>
            <div>
              <h1 className="text-3xl md:text-4xl font-serif text-textMain">Passport</h1>
              <p className="text-textSoft uppercase tracking-widest text-xs font-bold">Your preferences & account</p>
            </div>
          </div>
        </motion.div>

        {/* Account Card */}
        <motion.section
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1 }}
          className="bg-white rounded-3xl p-8 shadow-lg border-t-8 border-yellow relative overflow-hidden"
        >
          <div className="absolute top-0 right-0 w-32 h-32 bg-yellow opacity-10 rounded-bl-full -mr-8 -mt-8" />
          
          <div className="flex items-center gap-4 mb-8 relative z-10">
            <div className="w-16 h-16 rounded-full border-4 border-yellow overflow-hidden">
              <img src="https://images.unsplash.com/photo-1500648767791-00dcc994a43e?auto=format&fit=crop&w=100&q=80" className="w-full h-full object-cover" alt="Profile" />
            </div>
            <div>
              <h2 className="font-serif text-2xl text-textMain">{fullName}</h2>
              <span className="bg-yellow text-textMain text-xs font-bold px-2 py-1 rounded uppercase tracking-widest">{membershipTag}</span>
            </div>
          </div>

          <div className="space-y-4 relative z-10">
            <div className="flex items-center justify-between py-3 border-b border-gray-100">
              <span className="text-textSoft font-bold text-xs uppercase tracking-widest">Email</span>
              <span className="font-medium text-textMain">{email}</span>
            </div>
            <div className="flex items-center justify-between py-3 border-b border-gray-100">
              <span className="text-textSoft font-bold text-xs uppercase tracking-widest">Account ID</span>
              <span className="font-mono text-xs text-textMain bg-gray-100 px-2 py-1 rounded">{accountId.substring(0, 12)}...</span>
            </div>
          </div>
        </motion.section>
        {showUpgradeCta && (
          <motion.section
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.15 }}
            className="bg-gradient-to-r from-pink to-yellow text-white rounded-3xl p-8 shadow-xl"
          >
            <div className="flex items-start gap-4">
              <div className="w-12 h-12 rounded-2xl bg-white/20 flex items-center justify-center">
                <Sparkles className="w-6 h-6" />
              </div>
              <div className="space-y-3">
                <div>
                  <p className="text-xs uppercase tracking-[0.3em] font-bold text-white/80">Demo Access</p>
                  <h3 className="text-2xl font-serif leading-tight">Upgrade to unlock real coaching time</h3>
                </div>
                <p className="text-white/90 text-sm leading-relaxed">
                  Demo tutors reset every few minutes. Go premium for unlimited live sessions, personalized
                  learning plans, and SOS translations without limits.
                </p>
                <button
                  onClick={onUpgrade}
                  className="inline-flex items-center gap-2 bg-white text-textMain font-bold uppercase tracking-widest text-xs px-4 py-3 rounded-2xl shadow-md hover:-translate-y-0.5 transition-transform"
                >
                  <span>Continue to Premium</span>
                </button>
              </div>
            </div>
          </motion.section>
        )}

        {/* Preferences */}
        <motion.section
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.2 }}
          className="space-y-6"
        >
          <h2 className="font-serif text-2xl text-textMain px-2">Learning Preferences</h2>
          
          <div className="bg-white rounded-3xl p-8 shadow-sm space-y-8">
            {/* Difficulty */}
            <div className="space-y-4">
              <label className="text-xs font-bold uppercase tracking-widest text-textSoft flex items-center gap-2">
                <Mic size={14} />
                Difficulty Level
              </label>
              <div className="text-sm text-gray-600 space-y-1 leading-relaxed">
                <p className="font-medium text-textMain/90">
                  These levels set the opening scene; your tutor keeps adjusting during the chat and across future sessions.
                </p>
                <p>
                  <span className="font-semibold text-textMain">Beginner</span>: gentle A1–B1 prompts, slower pacing, lots of scaffolding.
                </p>
                <p>
                  <span className="font-semibold text-textMain">Intermediate</span>: steady B1–C1 dialogue, natural speed with soft corrections.
                </p>
                <p>
                  <span className="font-semibold text-textMain">Advanced</span>: C1 polish, nuanced debate, idioms, and fast follow-ups.
                </p>
              </div>
              <div className="grid grid-cols-3 gap-3">
                {(["beginner", "intermediate", "advanced"] as const).map((level) => (
                  <button
                    key={level}
                    onClick={() => onDifficultyChange(level)}
                    className={`py-3 rounded-xl text-sm font-bold capitalize transition-all ${
                      difficulty === level
                        ? "bg-pink text-white shadow-md scale-105"
                        : "bg-gray-50 text-gray-400 hover:bg-gray-100"
                    }`}
                  >
                    {level}
                  </button>
                ))}
              </div>
            </div>

            {/* Adaptive Mode */}
            <div className="flex items-center justify-between">
              <div className="space-y-1">
                <label className="text-xs font-bold uppercase tracking-widest text-textSoft">Adaptive Mode</label>
                <p className="text-sm text-gray-500">Always on to auto-adjust your tutor.</p>
              </div>
              <span className={`px-4 py-2 rounded-full text-xs font-bold uppercase tracking-widest ${
                adaptiveMode ? "bg-sky text-white" : "bg-gray-200 text-gray-500"
              }`}>
                {adaptiveMode ? "On" : "Off"}
              </span>
            </div>

            {/* Extra Support Mode (Low Beginner) */}
            {difficulty === "beginner" && onExtraSupportChange && (
              <div className="flex items-center justify-between pt-4 border-t border-gray-100">
                <div className="space-y-1">
                  <label className="text-xs font-bold uppercase tracking-widest text-textSoft">Extra Support</label>
                  <p className="text-sm text-gray-500">
                    Start with simplified phrases, slower pace, and more encouragement.
                    Great for absolute beginners or when you need extra confidence.
                  </p>
                </div>
                <button
                  onClick={() => onExtraSupportChange(!extraSupportMode)}
                  className={`px-4 py-2 rounded-full text-xs font-bold uppercase tracking-widest transition-all ${
                    extraSupportMode
                      ? "bg-pink text-white shadow-md"
                      : "bg-gray-200 text-gray-500 hover:bg-gray-300"
                  }`}
                >
                  {extraSupportMode ? "On" : "Off"}
                </button>
              </div>
            )}
          </div>
        </motion.section>

        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.4 }}
          className="pt-8"
        >
          <button
            onClick={onLogout}
            className="w-full py-4 border-2 border-gray-200 text-gray-400 font-bold uppercase tracking-widest text-xs hover:border-red-200 hover:text-red-500 hover:bg-red-50 transition-all rounded-2xl flex items-center justify-center gap-2"
          >
            <LogOut size={16} />
            Sign Out
          </button>
        </motion.div>
      </div>
    </div>
  );
}
