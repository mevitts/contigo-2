import { Calendar, Trash2, RefreshCcw, Book } from "lucide-react";
import { motion } from "motion/react";
import type { SessionRecord } from "../lib/types";

interface SessionHistoryProps {
  sessions: SessionRecord[];
  isLoading?: boolean;
  error?: string | null;
  onRefresh?: () => void;
  onDelete?: (sessionId: string) => void;
  onSelectSession?: (session: SessionRecord) => void;
}

const titleDateFormatter = new Intl.DateTimeFormat(undefined, {
  weekday: "long",
  month: "long",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
});

export function SessionHistory({
  sessions,
  isLoading = false,
  error,
  onRefresh,
  onDelete,
  onSelectSession,
}: SessionHistoryProps) {
  return (
    <div className="min-h-screen bg-plaster pb-24 px-4 py-8 font-sans">
      <div className="max-w-4xl mx-auto space-y-8">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-14 h-14 bg-pink rounded-full flex items-center justify-center shadow-lg">
               <Book className="w-7 h-7 text-white" />
            </div>
            <div>
              <h1 className="text-4xl md:text-5xl font-serif text-textMain">Notebook</h1>
              <p className="text-textSoft uppercase tracking-widest text-sm font-bold">Your conversation history</p>
            </div>
          </div>
          <button
            onClick={onRefresh}
            className="flex items-center gap-2 px-4 py-2 rounded-full border-2 border-sky text-sky hover:bg-sky/10 transition-colors font-bold uppercase text-sm tracking-widest"
            disabled={isLoading}
          >
            <RefreshCcw className={`w-5 h-5 ${isLoading ? "animate-spin" : ""}`} />
            Refresh
          </button>
        </div>

        {error && (
          <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-2xl">
            {error}
          </div>
        )}

        {sessions.length === 0 && !isLoading ? (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="bg-white border-2 border-dashed border-pink/20 rounded-3xl p-12 text-center space-y-4"
          >
            <Calendar className="w-16 h-16 text-pink/40 mx-auto" />
            <h2 className="text-2xl font-serif text-textMain">No sessions yet</h2>
            <p className="text-base text-textSoft">
              Start a conversation to see it appear here.
            </p>
          </motion.div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {sessions.map((session, index) => (
              <motion.div
                key={session.id}
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: index * 0.1 }}
                className="group bg-white rounded-3xl p-6 shadow-sm hover:shadow-xl transition-all border-l-8 border-l-pink hover:-translate-y-1 cursor-pointer relative overflow-hidden"
                onClick={() => onSelectSession?.(session)}
              >
                <div className="absolute top-0 right-0 w-24 h-24 bg-yellow opacity-10 rounded-bl-full -mr-8 -mt-8 transition-transform group-hover:scale-150" />
                
                <div className="relative z-10">
                  <div className="flex justify-between items-start mb-4">
                    <span className="text-sm font-bold uppercase tracking-widest text-pink bg-pink/10 px-2 py-1 rounded">
                      {session.language?.toUpperCase() ?? "ES"}
                    </span>
                    {onDelete && (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          onDelete(session.id);
                        }}
                        className="text-gray-400 hover:text-red-500 transition-colors p-1"
                      >
                        <Trash2 size={16} />
                      </button>
                    )}
                  </div>
                  
                  <h3 className="font-serif text-2xl text-textMain mb-2 line-clamp-2">
                    {titleDateFormatter.format(new Date(session.createdAt))}
                  </h3>
                  <p className="text-sm font-bold uppercase tracking-widest text-textSoft">
                    {session.agentDisplayName ?? "Contigo Coach"}
                  </p>
                </div>
              </motion.div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
