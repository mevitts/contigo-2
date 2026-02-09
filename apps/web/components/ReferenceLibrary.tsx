import React, { useState, useEffect, useCallback } from "react";
import { Plus, Search, Pin, BookOpen, Filter, Trash2, ExternalLink, PinOff } from "lucide-react";
import { motion } from "motion/react";
import type { Reference, ReferenceType, CreateReferenceRequest } from "../lib/types";
import {
  listReferences,
  createReference,
  updateReference,
  deleteReference,
} from "../lib/api";
import { PasteReferenceDialog } from "./PasteReferenceDialog";

interface ReferenceLibraryProps {
  userId: string;
}

const TYPE_CONFIG: Record<ReferenceType, { color: string; label: string; accent: string; cardBg: string }> = {
  SONG: { color: "bg-[#fce4f0] text-[#e6007e] border-[#e6007e]/20", label: "Song", accent: "border-l-[#e6007e]", cardBg: "bg-[#fef8fb]" },
  LYRICS: { color: "bg-[#e0f7fa] text-[#00bdd0] border-[#00bdd0]/20", label: "Lyrics", accent: "border-l-[#00bdd0]", cardBg: "bg-[#f6fdfe]" },
  ARTICLE: { color: "bg-[#e3f2fd] text-[#2d9fec] border-[#2d9fec]/20", label: "Article", accent: "border-l-[#2d9fec]", cardBg: "bg-[#f7faff]" },
  VIDEO: { color: "bg-[#f1f8e9] text-[#7cb342] border-[#a7dc41]/20", label: "Video", accent: "border-l-[#a7dc41]", cardBg: "bg-[#f9fcf5]" },
  BOOK_EXCERPT: { color: "bg-[#fff9e6] text-[#c9a800] border-[#fcd53a]/20", label: "Book", accent: "border-l-[#fcd53a]", cardBg: "bg-[#fffdf5]" },
  CULTURAL: { color: "bg-[#e8f5e9] text-[#00b876] border-[#00d891]/20", label: "Cultural", accent: "border-l-[#00d891]", cardBg: "bg-[#f5fef8]" },
  OTHER: { color: "bg-[#f5f0ea] text-[#8c8c8c] border-[#8c8c8c]/20", label: "Other", accent: "border-l-[#8c8c8c]", cardBg: "bg-[#faf8f5]" },
};

const FILTER_OPTIONS: { value: ReferenceType | "ALL"; label: string }[] = [
  { value: "ALL", label: "All" },
  { value: "SONG", label: "Songs" },
  { value: "LYRICS", label: "Lyrics" },
  { value: "ARTICLE", label: "Articles" },
  { value: "VIDEO", label: "Videos" },
  { value: "BOOK_EXCERPT", label: "Books" },
  { value: "CULTURAL", label: "Cultural" },
  { value: "OTHER", label: "Other" },
];

export function ReferenceLibrary({ userId }: ReferenceLibraryProps) {
  const [references, setReferences] = useState<Reference[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [filterType, setFilterType] = useState<ReferenceType | "ALL">("ALL");
  const [showAddDialog, setShowAddDialog] = useState(false);
  const [selectedReference, setSelectedReference] = useState<Reference | null>(null);

  const loadReferences = useCallback(async () => {
    if (!userId) return;

    setLoading(true);
    setError(null);
    try {
      const data = await listReferences(userId);
      setReferences(data);
    } catch (err) {
      setError("Failed to load references");
      console.error("Failed to load references:", err);
    } finally {
      setLoading(false);
    }
  }, [userId]);

  useEffect(() => {
    loadReferences();
  }, [loadReferences]);

  const handleAddReference = useCallback(
    async (data: Omit<CreateReferenceRequest, 'userId' | 'conversationId'>) => {
      try {
        const saved = await createReference({
          ...data,
          userId,
          conversationId: null,
        });
        setReferences((prev) => [saved, ...prev]);
        setShowAddDialog(false);
      } catch (err) {
        console.error("Failed to add reference:", err);
      }
    },
    [userId]
  );

  const handlePin = useCallback(async (ref: Reference) => {
    try {
      await updateReference(ref.id, { isPinned: true });
      setReferences((prev) =>
        prev.map((r) => (r.id === ref.id ? { ...r, isPinned: true } : r))
      );
    } catch (err) {
      console.error("Failed to pin reference:", err);
    }
  }, []);

  const handleUnpin = useCallback(async (ref: Reference) => {
    try {
      await updateReference(ref.id, { isPinned: false });
      setReferences((prev) =>
        prev.map((r) => (r.id === ref.id ? { ...r, isPinned: false } : r))
      );
    } catch (err) {
      console.error("Failed to unpin reference:", err);
    }
  }, []);

  const handleDelete = useCallback(async (ref: Reference) => {
    try {
      await deleteReference(ref.id);
      setReferences((prev) => prev.filter((r) => r.id !== ref.id));
      if (selectedReference?.id === ref.id) {
        setSelectedReference(null);
      }
    } catch (err) {
      console.error("Failed to delete reference:", err);
    }
  }, [selectedReference?.id]);

  // Filter and search
  const filteredReferences = React.useMemo(() => {
    let result = references;

    if (filterType !== "ALL") {
      result = result.filter((r) => r.referenceType === filterType);
    }

    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase();
      result = result.filter(
        (r) =>
          r.title.toLowerCase().includes(query) ||
          r.source?.toLowerCase().includes(query) ||
          r.contentText?.toLowerCase().includes(query)
      );
    }

    // Sort: pinned first, then by date
    return result.sort((a, b) => {
      if (a.isPinned && !b.isPinned) return -1;
      if (!a.isPinned && b.isPinned) return 1;
      return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
    });
  }, [references, filterType, searchQuery]);

  const pinnedCount = references.filter((r) => r.isPinned).length;

  return (
    <div className="min-h-screen bg-plaster">
      {/* Header */}
      <div className="bg-white/80 backdrop-blur-md border-b-2 border-b-transparent sticky top-0 z-10" style={{ borderImage: "linear-gradient(to right, #e6007e, #2d9fec, #00bdd0, #00d891) 1" }}>
        <div className="max-w-6xl mx-auto px-6 py-5">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-3">
              <BookOpen className="w-7 h-7 text-[#00bdd0]" />
              <h1 className="text-3xl font-serif text-textMain">Reference Library</h1>
              {pinnedCount > 0 && (
                <span className="px-2.5 py-1 rounded-full bg-[#fcd53a]/20 text-[#c9a800] text-sm font-medium">
                  {pinnedCount} pinned
                </span>
              )}
            </div>
            <button
              onClick={() => setShowAddDialog(true)}
              className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-pink text-white font-semibold hover:bg-pink/90 transition-colors text-base"
            >
              <Plus className="w-5 h-5" />
              Add Reference
            </button>
          </div>

          <div className="flex items-center gap-4">
            {/* Search */}
            <div className="relative flex-1 max-w-md">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-textSoft" />
              <input
                type="text"
                placeholder="Search references..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full pl-10 pr-4 py-2.5 rounded-xl bg-white border border-black/10 text-textMain placeholder-textSoft focus:outline-none focus:border-pink/40 transition-colors text-base"
              />
            </div>

            {/* Filter */}
            <div className="flex items-center gap-2">
              <Filter className="w-5 h-5 text-textSoft" />
              <select
                value={filterType}
                onChange={(e) => setFilterType(e.target.value as ReferenceType | "ALL")}
                className="px-3 py-2.5 rounded-xl bg-white border border-black/10 text-textMain focus:outline-none focus:border-pink/40 transition-colors text-base"
              >
                {FILTER_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </div>
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="max-w-6xl mx-auto px-6 py-8">
        {loading ? (
          <div className="text-center py-12">
            <div className="animate-spin w-8 h-8 border-2 border-black/10 border-t-pink rounded-full mx-auto" />
            <p className="text-textSoft mt-4 text-base">Loading your references...</p>
          </div>
        ) : error ? (
          <div className="text-center py-12">
            <p className="text-red-500 text-base">{error}</p>
            <button
              onClick={loadReferences}
              className="mt-4 px-5 py-2.5 rounded-xl bg-white border border-black/10 text-textMain hover:bg-gray-50 transition-colors"
            >
              Try Again
            </button>
          </div>
        ) : filteredReferences.length === 0 ? (
          <div className="text-center py-12">
            <BookOpen className="w-16 h-16 text-textSoft/30 mx-auto mb-4" />
            <h3 className="text-xl font-medium text-textMain mb-2">
              {searchQuery || filterType !== "ALL"
                ? "No matching references"
                : "Your library is empty"}
            </h3>
            <p className="text-textSoft mb-6 text-base">
              {searchQuery || filterType !== "ALL"
                ? "Try adjusting your search or filter"
                : "Add songs, lyrics, and cultural references you want to remember"}
            </p>
            {!searchQuery && filterType === "ALL" && (
              <button
                onClick={() => setShowAddDialog(true)}
                className="px-5 py-2.5 rounded-xl bg-pink text-white font-semibold hover:bg-pink/90 transition-colors"
              >
                Add Your First Reference
              </button>
            )}
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {filteredReferences.map((ref, index) => {
              const config = TYPE_CONFIG[ref.referenceType] || TYPE_CONFIG.OTHER;
              return (
                <motion.div
                  key={ref.id}
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: index * 0.05 }}
                  className={`${config.cardBg} rounded-2xl p-5 border-l-4 ${config.accent} border border-black/8 hover:border-pink/30 cursor-pointer transition-colors shadow-sm ${
                    selectedReference?.id === ref.id ? "border-pink/50 shadow-md" : ""
                  }`}
                  onClick={() => setSelectedReference(ref)}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <h3 className="font-medium text-textMain truncate text-lg">{ref.title}</h3>
                        {ref.isPinned && (
                          <Pin className="w-4 h-4 text-[#fcd53a] flex-shrink-0" />
                        )}
                      </div>
                      {ref.source && (
                        <p className="text-base text-textSoft truncate">{ref.source}</p>
                      )}
                      <div className="flex items-center gap-2 mt-2">
                        <span className={`text-sm px-2.5 py-1 rounded-lg border ${config.color}`}>
                          {config.label}
                        </span>
                        <span className="text-sm text-textSoft">
                          {new Date(ref.createdAt).toLocaleDateString()}
                        </span>
                      </div>
                    </div>
                  </div>

                  {ref.contentText && (
                    <p className="text-base text-textSoft mt-3 line-clamp-2">
                      {ref.contentText}
                    </p>
                  )}

                  <div className="flex items-center justify-end gap-1 mt-3 pt-3 border-t border-black/5">
                    {ref.url && (
                      <a
                        href={ref.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        onClick={(e) => e.stopPropagation()}
                        className="p-1.5 rounded-lg hover:bg-black/5 text-textSoft hover:text-textMain transition-colors"
                        title="Open link"
                      >
                        <ExternalLink className="w-4 h-4" />
                      </a>
                    )}
                    {ref.isPinned ? (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          handleUnpin(ref);
                        }}
                        className="p-1.5 rounded-lg hover:bg-[#fcd53a]/10 text-[#fcd53a] hover:text-[#c9a800] transition-colors"
                        title="Unpin"
                      >
                        <PinOff className="w-4 h-4" />
                      </button>
                    ) : (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          handlePin(ref);
                        }}
                        className="p-1.5 rounded-lg hover:bg-black/5 text-textSoft hover:text-textMain transition-colors"
                        title="Pin"
                      >
                        <Pin className="w-4 h-4" />
                      </button>
                    )}
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        handleDelete(ref);
                      }}
                      className="p-1.5 rounded-lg hover:bg-red-50 text-textSoft hover:text-red-500 transition-colors"
                      title="Delete"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </motion.div>
              );
            })}
          </div>
        )}
      </div>

      {/* Detail Panel */}
      {selectedReference && (
        <div className="fixed inset-y-0 right-0 w-full max-w-md bg-white border-l border-black/10 shadow-2xl z-20 overflow-y-auto">
          <div className="p-6">
            <div className="flex items-start justify-between mb-6">
              <div className="flex-1">
                <div className="flex items-center gap-2 mb-1">
                  <h2 className="text-2xl font-semibold text-textMain">{selectedReference.title}</h2>
                  {selectedReference.isPinned && (
                    <Pin className="w-4 h-4 text-[#fcd53a]" />
                  )}
                </div>
                {selectedReference.source && (
                  <p className="text-base text-textSoft">{selectedReference.source}</p>
                )}
              </div>
              <button
                onClick={() => setSelectedReference(null)}
                className="p-2 rounded-lg hover:bg-black/5 text-textSoft hover:text-textMain transition-colors"
              >
                <span className="sr-only">Close</span>
                &times;
              </button>
            </div>

            <div className="space-y-4">
              <div className="flex items-center gap-2">
                <span
                  className={`text-base px-2.5 py-1 rounded-lg border ${
                    TYPE_CONFIG[selectedReference.referenceType]?.color || TYPE_CONFIG.OTHER.color
                  }`}
                >
                  {TYPE_CONFIG[selectedReference.referenceType]?.label || "Other"}
                </span>
                <span className="text-base text-textSoft">
                  Added {new Date(selectedReference.createdAt).toLocaleDateString()}
                </span>
              </div>

              {selectedReference.url && (
                <a
                  href={selectedReference.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-2 text-[#2d9fec] hover:text-[#2d9fec]/80 transition-colors"
                >
                  <ExternalLink className="w-4 h-4" />
                  <span className="text-base underline">{selectedReference.url}</span>
                </a>
              )}

              {selectedReference.contentText && (
                <div className="bg-plaster/50 rounded-xl p-4">
                  <h4 className="text-base font-medium text-textSoft uppercase tracking-wider mb-2">
                    Content
                  </h4>
                  <p className="text-textMain whitespace-pre-wrap">
                    {selectedReference.contentText}
                  </p>
                </div>
              )}

              {selectedReference.detectedContext && (
                <div className="bg-plaster/50 rounded-xl p-4">
                  <h4 className="text-base font-medium text-textSoft uppercase tracking-wider mb-2">
                    Context
                  </h4>
                  <p className="text-textSoft text-base">
                    {selectedReference.detectedContext}
                  </p>
                </div>
              )}

              {selectedReference.notes && (
                <div className="bg-plaster/50 rounded-xl p-4">
                  <h4 className="text-base font-medium text-textSoft uppercase tracking-wider mb-2">
                    Notes
                  </h4>
                  <p className="text-textMain text-base">{selectedReference.notes}</p>
                </div>
              )}
            </div>

            <div className="flex items-center gap-2 mt-6 pt-6 border-t border-black/10">
              {selectedReference.isPinned ? (
                <button
                  onClick={() => handleUnpin(selectedReference)}
                  className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-[#fcd53a]/15 text-[#c9a800] hover:bg-[#fcd53a]/25 transition-colors font-medium"
                >
                  <PinOff className="w-4 h-4" />
                  Unpin
                </button>
              ) : (
                <button
                  onClick={() => handlePin(selectedReference)}
                  className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-plaster text-textMain hover:bg-plaster/80 transition-colors font-medium"
                >
                  <Pin className="w-4 h-4" />
                  Pin to Library
                </button>
              )}
              <button
                onClick={() => handleDelete(selectedReference)}
                className="px-4 py-2.5 rounded-xl bg-red-50 text-red-500 hover:bg-red-100 transition-colors"
              >
                <Trash2 className="w-4 h-4" />
              </button>
            </div>
          </div>
        </div>
      )}

      <PasteReferenceDialog
        isOpen={showAddDialog}
        onClose={() => setShowAddDialog(false)}
        onSave={handleAddReference}
      />
    </div>
  );
}
