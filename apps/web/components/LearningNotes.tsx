import { Volume2, Check, BookHeart, Sparkles } from "lucide-react";
import { useState } from "react";
import { motion } from "motion/react";

type FilterType = "all" | "grammar" | "vocab" | "pronunciation";
type SortType = "recent" | "priority" | "type";

export function LearningNotes() {
  const [activeFilter, setActiveFilter] = useState<FilterType>("all");
  const [sortBy, setSortBy] = useState<SortType>("recent");

  const filters: { id: FilterType; label: string; emoji: string }[] = [
    { id: "all", label: "All", emoji: "✨" },
    { id: "grammar", label: "Grammar", emoji: "📐" },
    { id: "vocab", label: "Words", emoji: "🌟" },
    { id: "pronunciation", label: "Sounds", emoji: "🎵" },
  ];

  const notes = [
    {
      type: "grammar",
      emoji: "💡",
      title: "Gender Agreement",
      incorrect: "La problema",
      correct: "El problema",
      daysAgo: 2,
      mastered: false,
      color: "from-[#B8A5D6]/30 to-[#A8DADC]/30",
      borderColor: "border-[#B8A5D6]",
    },
    {
      type: "vocab",
      emoji: "🏛️",
      title: "tianguis",
      subtitle: "Street market - those vibrant Mexican markets!",
      daysAgo: 3,
      mastered: false,
      color: "from-[#E9C46A]/30 to-[#F4A261]/30",
      borderColor: "border-[#E9C46A]",
    },
    {
      type: "fluency",
      emoji: "🌟",
      title: "Natural flow!",
      subtitle: "You're sounding more and more natural",
      daysAgo: 3,
      mastered: true,
      color: "from-[#81B29A]/30 to-[#2A9D8F]/30",
      borderColor: "border-[#81B29A]",
    },
    {
      type: "grammar",
      emoji: "🎭",
      title: "Ser vs Estar",
      subtitle: "Context is everything",
      daysAgo: 5,
      mastered: false,
      color: "from-[#FFB5A7]/30 to-[#E07A5F]/30",
      borderColor: "border-[#FFB5A7]",
    },
    {
      type: "pronunciation",
      emoji: "🎵",
      title: "gente",
      subtitle: "Soft 'g' sound - like a whisper",
      daysAgo: 2,
      mastered: false,
      color: "from-[#A8DADC]/30 to-[#81B29A]/30",
      borderColor: "border-[#A8DADC]",
    },
    {
      type: "vocab",
      emoji: "🌵",
      title: "suculenta",
      subtitle: "Succulent plant",
      daysAgo: 1,
      mastered: true,
      color: "from-[#E9C46A]/30 to-[#F4A261]/30",
      borderColor: "border-[#E9C46A]",
    },
  ];

  return (
    <div className="min-h-screen pb-24 px-4 py-8">
      <div className="max-w-4xl mx-auto space-y-6">
        {/* Header */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="space-y-2"
        >
          <div className="flex items-center gap-3">
            <BookHeart className="w-8 h-8 text-[#E07A5F]" />
            <h1 className="text-3xl md:text-4xl">Tu Cuaderno</h1>
          </div>
          <p className="text-muted-foreground text-lg">Your personal Spanish journey, one discovery at a time</p>
        </motion.div>

        {/* Filters */}
        <div className="space-y-4">
          <div className="flex items-center gap-3 overflow-x-auto pb-2">
            {filters.map((filter, index) => (
              <motion.button
                key={filter.id}
                initial={{ opacity: 0, scale: 0.9 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ delay: index * 0.1 }}
                onClick={() => setActiveFilter(filter.id)}
                className={`flex items-center gap-2 px-5 py-2.5 rounded-full whitespace-nowrap transition-all shadow-sm ${
                  activeFilter === filter.id
                    ? "bg-gradient-to-r from-[#E07A5F] to-[#F4A261] text-white scale-105"
                    : "bg-white border-2 border-border hover:border-[#E07A5F]/50 hover:bg-muted/50"
                }`}
              >
                <span>{filter.emoji}</span>
                <span className="font-medium">{filter.label}</span>
              </motion.button>
            ))}
          </div>

          <div className="flex items-center gap-3 text-sm">
            <Sparkles className="w-4 h-4 text-[#E9C46A]" />
            <label className="text-muted-foreground">Sort:</label>
            <select
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value as SortType)}
              className="px-4 py-2 rounded-full border-2 border-border bg-white text-sm font-medium hover:border-[#E07A5F]/50 transition-colors"
            >
              <option value="recent">Most Recent</option>
              <option value="priority">Most Important</option>
              <option value="type">By Type</option>
            </select>
          </div>
        </div>

        {/* Notes Grid */}
        <div className="grid md:grid-cols-2 gap-4">
          {notes.map((note, index) => (
            <motion.div
              key={index}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.3 + index * 0.1 }}
              className={`relative bg-gradient-to-br ${note.color} border-2 ${note.borderColor} rounded-3xl p-6 space-y-4 hover:shadow-xl transition-all hover:scale-[1.02]`}
            >
              {note.mastered && (
                <div className="absolute top-4 right-4">
                  <span className="px-3 py-1 rounded-full bg-[#81B29A] text-white text-xs font-medium shadow-md">
                    Got it! ✓
                  </span>
                </div>
              )}

              <div className="space-y-3">
                <div className="flex items-start gap-3">
                  <span className="text-4xl">{note.emoji}</span>
                  <div className="flex-1 space-y-2">
                    <h3 className="spanish-text text-xl">{note.title}</h3>
                    {note.subtitle && (
                      <p className="text-sm text-muted-foreground italic">{note.subtitle}</p>
                    )}
                    {note.incorrect && note.correct && (
                      <div className="space-y-2 pt-2">
                        <div className="flex items-center gap-2">
                          <span className="text-xs text-muted-foreground">Before:</span>
                          <p className="spanish-text text-sm text-red-500 line-through">
                            "{note.incorrect}"
                          </p>
                        </div>
                        <div className="flex items-center gap-2">
                          <span className="text-xs text-muted-foreground">Now:</span>
                          <p className="spanish-text text-sm text-green-600 font-medium">
                            "{note.correct}"
                          </p>
                        </div>
                      </div>
                    )}
                  </div>
                </div>

                <p className="text-xs text-muted-foreground flex items-center gap-1">
                  <span>⏱️</span>
                  {note.daysAgo === 1 ? "Yesterday" : `${note.daysAgo} days ago`}
                </p>
              </div>

              {!note.mastered && (
                <div className="flex items-center gap-2 pt-2 border-t border-white/50">
                  {note.type !== "fluency" && (
                    <button className="flex items-center gap-2 px-4 py-2 rounded-full bg-white/80 hover:bg-white transition-colors text-sm font-medium shadow-sm">
                      <Volume2 className="w-4 h-4" />
                      Listen
                    </button>
                  )}
                  <button className="flex items-center gap-2 px-4 py-2 rounded-full bg-gradient-to-r from-[#81B29A] to-[#2A9D8F] hover:from-[#81B29A]/90 hover:to-[#2A9D8F]/90 text-white transition-all text-sm font-medium shadow-md">
                    <Check className="w-4 h-4" />
                    Got it!
                  </button>
                </div>
              )}
            </motion.div>
          ))}
        </div>

        {/* Load More */}
        <button className="w-full py-4 text-center bg-white border-2 border-[#E07A5F]/30 rounded-3xl hover:bg-gradient-to-r hover:from-[#E07A5F]/10 hover:to-[#F4A261]/10 hover:border-[#E07A5F] transition-all text-[#E07A5F] font-medium">
          Show me more discoveries ✨
        </button>
      </div>
    </div>
  );
}
