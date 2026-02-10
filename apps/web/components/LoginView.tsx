import { Globe, LogIn } from "lucide-react";

interface LoginViewProps {
  onGoogleLogin: () => void;
  isLoading?: boolean;
  error?: string | null;
}

export function LoginView({ onGoogleLogin, isLoading = false, error }: LoginViewProps) {
  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-plaster px-6 py-12 text-center">
      <div className="flex items-center gap-2 mb-8 text-textSoft uppercase tracking-[0.5em] font-bold text-base">
        <Globe size={22} />
        <span>Contigo</span>
      </div>

      <div className="max-w-xl w-full space-y-6">
        <h1 className="text-5xl md:text-6xl font-serif text-textMain">Bienvenido</h1>
        <p className="text-textSoft font-sans leading-relaxed text-lg">
          Your personal Spanish tutor, powered by AI. Sign in to start practicing.
        </p>

        {error && (
          <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-2xl">
            {error}
          </div>
        )}

        <div className="space-y-3">
          <button
            onClick={onGoogleLogin}
            disabled={isLoading}
            className="w-full h-14 rounded-2xl bg-black text-white font-bold tracking-widest uppercase flex items-center justify-center gap-2 shadow-lg hover:scale-[1.01] active:scale-[0.99] transition disabled:opacity-70"
          >
            <LogIn size={18} />
            {isLoading ? "Starting..." : "Sign in with Google"}
          </button>
        </div>

        <p className="text-sm text-textSoft uppercase tracking-[0.4em]">Secured by Google</p>
      </div>
    </div>
  );
}
