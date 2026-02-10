import React from "react";
import {
  BookOpen,
  Languages,
  Landmark,
  Lightbulb,
  Loader2,
  Save,
  ExternalLink,
} from "lucide-react";
import type {
  WeeklyArticle,
  ArticleAnalysis,
  ArticleVocabItem,
  ArticleGrammarPattern,
  ArticleCulturalNote,
} from "../lib/types";
import { getArticleDetails, getArticleAnalysis, createReference } from "../lib/api";

type AnalysisTab = "vocab" | "grammar" | "culture" | "tips";

interface ArticleViewProps {
  articleId: string;
  userId: string;
  difficulty?: string;
  initialArticle?: WeeklyArticle | null;
}

export function ArticleView({
  articleId,
  userId,
  difficulty = "intermediate",
  initialArticle,
}: ArticleViewProps) {
  const [article, setArticle] = React.useState<WeeklyArticle | null>(initialArticle ?? null);
  const [analysis, setAnalysis] = React.useState<ArticleAnalysis | null>(null);
  const [activeTab, setActiveTab] = React.useState<AnalysisTab>("vocab");
  const [loadingArticle, setLoadingArticle] = React.useState(!initialArticle);
  const [loadingAnalysis, setLoadingAnalysis] = React.useState(false);
  const [saved, setSaved] = React.useState(false);

  // Fetch full article details if we don't already have content
  React.useEffect(() => {
    if (article?.contentText) {
      setLoadingArticle(false);
      return;
    }

    let cancelled = false;
    setLoadingArticle(true);

    getArticleDetails(articleId).then((data) => {
      if (!cancelled && data) {
        setArticle(data);
      }
      if (!cancelled) setLoadingArticle(false);
    });

    return () => { cancelled = true; };
  }, [articleId, article?.contentText]);

  // Fetch analysis when article loads
  React.useEffect(() => {
    if (!article) return;

    let cancelled = false;
    setLoadingAnalysis(true);

    getArticleAnalysis(articleId, userId, difficulty).then((data) => {
      if (!cancelled && data) {
        setAnalysis(data);
      }
      if (!cancelled) setLoadingAnalysis(false);
    });

    return () => { cancelled = true; };
  }, [articleId, userId, difficulty, article]);

  const handleSaveToLibrary = React.useCallback(async () => {
    if (!article || saved) return;

    try {
      await createReference({
        userId,
        title: article.title,
        referenceType: "ARTICLE",
        url: article.url,
        contentText: article.summary || article.contentText?.slice(0, 500) || null,
        source: article.sourceName || article.author || null,
        isPinned: false,
        tags: article.tags.length > 0 ? article.tags : null,
        detectedContext: "Saved from Weekly Reading Spotlight",
        detectionMethod: "manual",
      });
      setSaved(true);
    } catch (err) {
      console.error("Failed to save article to library", err);
    }
  }, [article, userId, saved]);

  const tabs: { id: AnalysisTab; label: string; icon: React.ElementType }[] = [
    { id: "vocab", label: "Vocabulario", icon: Languages },
    { id: "grammar", label: "Gramática", icon: BookOpen },
    { id: "culture", label: "Cultura", icon: Landmark },
    { id: "tips", label: "Para Ti", icon: Lightbulb },
  ];

  if (loadingArticle) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <Loader2 className="w-8 h-8 animate-spin text-sky" />
      </div>
    );
  }

  if (!article) {
    return (
      <div className="flex items-center justify-center min-h-[60vh] text-textSoft">
        Article not found.
      </div>
    );
  }

  return (
    <div className="max-w-3xl mx-auto px-4 py-8 animate-fade-in">
      {/* Article Header */}
      <header className="mb-8">
        {article.imageUrl && (
          <div className="rounded-xl overflow-hidden mb-6 shadow-lg max-h-72">
            <img
              src={article.imageUrl}
              alt={article.title}
              className="w-full h-full object-cover"
            />
          </div>
        )}

        <h1 className="text-3xl md:text-4xl font-serif text-textMain leading-tight mb-3">
          {article.title}
        </h1>

        <div className="flex items-center gap-3 text-sm text-textSoft font-sans">
          {article.author && <span>{article.author}</span>}
          {article.author && article.sourceName && <span>·</span>}
          {article.sourceName && <span>{article.sourceName}</span>}
        </div>

        {/* Actions */}
        <div className="flex items-center gap-3 mt-4">
          <button
            onClick={handleSaveToLibrary}
            disabled={saved}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-sans font-bold transition-colors ${
              saved
                ? "bg-emerald-100 text-emerald-700"
                : "bg-sky/10 text-sky hover:bg-sky/20"
            }`}
          >
            <Save size={14} />
            {saved ? "Saved" : "Save to Library"}
          </button>

          {article.url && (
            <a
              href={article.url}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-sans font-bold bg-black/5 text-textSoft hover:bg-black/10 transition-colors"
            >
              <ExternalLink size={14} />
              Original
            </a>
          )}
        </div>
      </header>

      {/* Article Body */}
      <article className="prose prose-lg max-w-none font-serif text-textMain leading-relaxed mb-12">
        {article.contentText?.split("\n").map((paragraph, i) =>
          paragraph.trim() ? (
            <p key={i}>{paragraph}</p>
          ) : null
        )}
      </article>

      {/* Analysis Section */}
      <section className="border-t border-black/10 pt-8">
        <h2 className="text-xl font-serif text-textMain mb-6">
          Tu Análisis Personalizado
        </h2>

        {/* Tabs */}
        <div className="flex gap-1 mb-6 bg-black/5 rounded-xl p-1">
          {tabs.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              onClick={() => setActiveTab(id)}
              className={`flex-1 flex items-center justify-center gap-1.5 px-3 py-2.5 rounded-lg text-xs font-sans font-bold uppercase tracking-wider transition-all ${
                activeTab === id
                  ? "bg-white text-textMain shadow-sm"
                  : "text-textSoft hover:text-textMain"
              }`}
            >
              <Icon size={14} />
              <span className="hidden sm:inline">{label}</span>
            </button>
          ))}
        </div>

        {/* Tab Content */}
        {loadingAnalysis ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="w-6 h-6 animate-spin text-sky" />
            <span className="ml-3 text-sm text-textSoft font-sans">
              Generating your personalized analysis...
            </span>
          </div>
        ) : !analysis ? (
          <div className="text-center py-12 text-textSoft font-sans">
            Analysis unavailable. Please try again later.
          </div>
        ) : (
          <div className="space-y-3">
            {activeTab === "vocab" && (
              <VocabTab items={analysis.vocabItems} />
            )}
            {activeTab === "grammar" && (
              <GrammarTab patterns={analysis.grammarPatterns} />
            )}
            {activeTab === "culture" && (
              <CultureTab notes={analysis.culturalNotes} />
            )}
            {activeTab === "tips" && (
              <TipsTab tips={analysis.personalizedTips} />
            )}
          </div>
        )}
      </section>
    </div>
  );
}

function VocabTab({ items }: { items: ArticleVocabItem[] }) {
  if (items.length === 0) {
    return <EmptyState message="No vocabulary items found for this article." />;
  }

  return (
    <div className="space-y-3">
      {items.map((item, i) => (
        <div
          key={i}
          className="bg-white rounded-xl p-4 shadow-sm border border-black/5"
        >
          <div className="flex items-baseline gap-3 mb-1">
            <span className="text-base font-serif font-bold text-textMain">
              {item.word}
            </span>
            <span className="text-sm text-sky font-sans">
              {item.translation}
            </span>
          </div>
          {item.context && (
            <p className="text-sm text-textSoft font-sans italic mt-1">
              "{item.context}"
            </p>
          )}
          {item.levelNote && (
            <p className="text-xs text-textSoft/70 font-sans mt-2">
              {item.levelNote}
            </p>
          )}
        </div>
      ))}
    </div>
  );
}

function GrammarTab({ patterns }: { patterns: ArticleGrammarPattern[] }) {
  if (patterns.length === 0) {
    return <EmptyState message="No grammar patterns identified." />;
  }

  return (
    <div className="space-y-3">
      {patterns.map((pattern, i) => (
        <div
          key={i}
          className="bg-white rounded-xl p-4 shadow-sm border border-black/5"
        >
          <h4 className="text-sm font-sans font-bold text-textMain uppercase tracking-wide mb-2">
            {pattern.pattern}
          </h4>
          <p className="text-sm text-sky font-serif italic mb-2">
            "{pattern.example}"
          </p>
          <p className="text-sm text-textSoft font-sans">
            {pattern.explanation}
          </p>
        </div>
      ))}
    </div>
  );
}

function CultureTab({ notes }: { notes: ArticleCulturalNote[] }) {
  if (notes.length === 0) {
    return <EmptyState message="No cultural notes for this article." />;
  }

  return (
    <div className="space-y-3">
      {notes.map((note, i) => (
        <div
          key={i}
          className="bg-white rounded-xl p-4 shadow-sm border border-black/5"
        >
          <h4 className="text-sm font-sans font-bold text-textMain mb-2">
            {note.topic}
          </h4>
          <p className="text-sm text-textSoft font-sans mb-1">
            {note.explanation}
          </p>
          {note.connection && (
            <p className="text-xs text-sky/80 font-sans italic mt-2">
              {note.connection}
            </p>
          )}
        </div>
      ))}
    </div>
  );
}

function TipsTab({ tips }: { tips: string[] }) {
  if (tips.length === 0) {
    return <EmptyState message="No personalized tips available." />;
  }

  return (
    <div className="space-y-3">
      {tips.map((tip, i) => (
        <div
          key={i}
          className="bg-white rounded-xl p-4 shadow-sm border border-black/5 flex items-start gap-3"
        >
          <Lightbulb size={16} className="text-amber-400 flex-shrink-0 mt-0.5" />
          <p className="text-sm text-textMain font-sans">{tip}</p>
        </div>
      ))}
    </div>
  );
}

function EmptyState({ message }: { message: string }) {
  return (
    <div className="text-center py-8 text-textSoft font-sans text-sm">
      {message}
    </div>
  );
}
