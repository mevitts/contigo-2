import { ArrowRight, Sparkles } from "lucide-react";
import type { WeeklyArticle } from "../lib/types";

interface SpotlightCardProps {
  article: WeeklyArticle;
  onReadArticle: (article: WeeklyArticle) => void;
}

export function SpotlightCard({ article, onReadArticle }: SpotlightCardProps) {
  const difficultyColors: Record<string, string> = {
    beginner: "bg-emerald-400/20 text-emerald-300",
    intermediate: "bg-amber-400/20 text-amber-300",
    advanced: "bg-red-400/20 text-red-300",
  };
  const diffLabel = article.difficultyLevel || "intermediate";
  const diffClass = difficultyColors[diffLabel] || difficultyColors.intermediate;

  return (
    <div
      onClick={() => onReadArticle(article)}
      className="group relative cursor-pointer overflow-hidden rounded-2xl bg-gradient-to-br from-sky/80 to-sky/60 shadow-[4px_4px_0px_rgba(0,0,0,0.15)] hover:shadow-[6px_6px_0px_rgba(0,0,0,0.15)] hover:scale-[1.02] active:scale-[0.98] active:shadow-none transition-all duration-300"
    >
      {/* Decorative corner */}
      <div className="absolute top-0 right-0 w-24 h-24 bg-black opacity-[0.06] rotate-45 translate-x-8 -translate-y-10 pointer-events-none" />

      <div className="flex flex-col md:flex-row">
        {/* Image */}
        {article.imageUrl && (
          <div className="md:w-48 lg:w-56 h-40 md:h-auto overflow-hidden flex-shrink-0">
            <img
              src={article.imageUrl}
              alt={article.title}
              className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
            />
          </div>
        )}

        {/* Content */}
        <div className="flex-1 p-5 md:p-6 flex flex-col gap-3">
          {/* Badge row */}
          <div className="flex items-center gap-2">
            <span className="flex items-center gap-1 text-[10px] font-sans font-bold uppercase tracking-[0.15em] text-white/70">
              <Sparkles size={12} />
              Weekly Spotlight
            </span>
            <span className={`text-[10px] px-2 py-0.5 rounded-full font-sans font-bold uppercase tracking-wider ${diffClass}`}>
              {diffLabel}
            </span>
          </div>

          {/* Title */}
          <h3 className="text-lg md:text-xl font-serif text-white leading-snug line-clamp-2">
            {article.title}
          </h3>

          {/* Author / Source */}
          {(article.author || article.sourceName) && (
            <p className="text-xs text-white/60 font-sans">
              {article.author && <span>{article.author}</span>}
              {article.author && article.sourceName && <span> · </span>}
              {article.sourceName && <span>{article.sourceName}</span>}
            </p>
          )}

          {/* Summary teaser */}
          {article.summary && (
            <p className="text-sm text-white/80 font-sans leading-relaxed line-clamp-2">
              {article.summary}
            </p>
          )}

          {/* Tags */}
          {article.tags.length > 0 && (
            <div className="flex flex-wrap gap-1.5 mt-1">
              {article.tags.slice(0, 4).map((tag) => (
                <span
                  key={tag}
                  className="text-[10px] px-2 py-0.5 rounded-full bg-white/10 text-white/70 font-sans"
                >
                  {tag}
                </span>
              ))}
            </div>
          )}

          {/* CTA */}
          <div className="flex items-center gap-2 mt-auto pt-2">
            <span className="text-sm font-sans font-bold text-white/90 group-hover:text-white transition-colors tracking-wide uppercase">
              Leer Ahora
            </span>
            <ArrowRight size={16} className="text-white/70 group-hover:text-white group-hover:translate-x-1 transition-all" />
          </div>
        </div>
      </div>
    </div>
  );
}
