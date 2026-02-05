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

const TYPE_CONFIG: Record<ReferenceType, { color: string; label: string }> = {
  SONG: { color: "bg-purple-400/20 text-purple-400 border-purple-400/30", label: "Song" },
  LYRICS: { color: "bg-pink-400/20 text-pink-400 border-pink-400/30", label: "Lyrics" },
  ARTICLE: { color: "bg-blue-400/20 text-blue-400 border-blue-400/30", label: "Article" },
  VIDEO: { color: "bg-red-400/20 text-red-400 border-red-400/30", label: "Video" },
  BOOK_EXCERPT: { color: "bg-amber-400/20 text-amber-400 border-amber-400/30", label: "Book" },
  CULTURAL: { color: "bg-emerald-400/20 text-emerald-400 border-emerald-400/30", label: "Cultural" },
  OTHER: { color: "bg-gray-400/20 text-gray-400 border-gray-400/30", label: "Other" },
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
    <div className="min-h-screen bg-gradient-to-b from-[#1a1a2e] to-[#16162a]">
      {/* Header */}
      <div className="bg-[#1a1a2e]/80 backdrop-blur-md border-b border-white/10 sticky top-0 z-10">
        <div className="max-w-6xl mx-auto px-6 py-4">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-3">
              <BookOpen className="w-6 h-6 text-emerald-400" />
              <h1 className="text-xl font-semibold text-white">Reference Library</h1>
              {pinnedCount > 0 && (
                <span className="px-2 py-0.5 rounded-full bg-amber-400/20 text-amber-400 text-xs">
                  {pinnedCount} pinned
                </span>
              )}
            </div>
            <button
              onClick={() => setShowAddDialog(true)}
              className="flex items-center gap-2 px-4 py-2 rounded-lg bg-emerald-500 text-white font-medium hover:bg-emerald-600 transition-colors"
            >
              <Plus className="w-4 h-4" />
              Add Reference
            </button>
          </div>

          <div className="flex items-center gap-4">
            {/* Search */}
            <div className="relative flex-1 max-w-md">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-white/40" />
              <input
                type="text"
                placeholder="Search references..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full pl-10 pr-4 py-2 rounded-lg bg-white/5 border border-white/10 text-white placeholder-white/40 focus:outline-none focus:border-white/30 transition-colors"
              />
            </div>

            {/* Filter */}
            <div className="flex items-center gap-2">
              <Filter className="w-4 h-4 text-white/40" />
              <select
                value={filterType}
                onChange={(e) => setFilterType(e.target.value as ReferenceType | "ALL")}
                className="px-3 py-2 rounded-lg bg-white/5 border border-white/10 text-white focus:outline-none focus:border-white/30 transition-colors"
              >
                {FILTER_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value} className="bg-[#1a1a2e]">
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
            <div className="animate-spin w-8 h-8 border-2 border-white/20 border-t-emerald-400 rounded-full mx-auto" />
            <p className="text-white/40 mt-4">Loading your references...</p>
          </div>
        ) : error ? (
          <div className="text-center py-12">
            <p className="text-red-400">{error}</p>
            <button
              onClick={loadReferences}
              className="mt-4 px-4 py-2 rounded-lg bg-white/10 text-white hover:bg-white/20 transition-colors"
            >
              Try Again
            </button>
          </div>
        ) : filteredReferences.length === 0 ? (
          <div className="text-center py-12">
            <BookOpen className="w-16 h-16 text-white/10 mx-auto mb-4" />
            <h3 className="text-lg font-medium text-white/60 mb-2">
              {searchQuery || filterType !== "ALL"
                ? "No matching references"
                : "Your library is empty"}
            </h3>
            <p className="text-white/40 mb-6">
              {searchQuery || filterType !== "ALL"
                ? "Try adjusting your search or filter"
                : "Add songs, lyrics, and cultural references you want to remember"}
            </p>
            {!searchQuery && filterType === "ALL" && (
              <button
                onClick={() => setShowAddDialog(true)}
                className="px-4 py-2 rounded-lg bg-emerald-500 text-white font-medium hover:bg-emerald-600 transition-colors"
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
                  className={`bg-white/5 rounded-xl p-4 border border-white/10 hover:border-white/20 cursor-pointer transition-colors ${
                    selectedReference?.id === ref.id ? "border-emerald-400/50" : ""
                  }`}
                  onClick={() => setSelectedReference(ref)}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <h3 className="font-medium text-white truncate">{ref.title}</h3>
                        {ref.isPinned && (
                          <Pin className="w-3.5 h-3.5 text-amber-400 flex-shrink-0" />
                        )}
                      </div>
                      {ref.source && (
                        <p className="text-sm text-white/60 truncate">{ref.source}</p>
                      )}
                      <div className="flex items-center gap-2 mt-2">
                        <span className={`text-xs px-2 py-0.5 rounded border ${config.color}`}>
                          {config.label}
                        </span>
                        <span className="text-xs text-white/30">
                          {new Date(ref.createdAt).toLocaleDateString()}
                        </span>
                      </div>
                    </div>
                  </div>

                  {ref.contentText && (
                    <p className="text-sm text-white/40 mt-3 line-clamp-2">
                      {ref.contentText}
                    </p>
                  )}

                  <div className="flex items-center justify-end gap-1 mt-3 pt-3 border-t border-white/5">
                    {ref.url && (
                      <a
                        href={ref.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        onClick={(e) => e.stopPropagation()}
                        className="p-1.5 rounded-lg hover:bg-white/10 text-white/40 hover:text-white transition-colors"
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
                        className="p-1.5 rounded-lg hover:bg-white/10 text-amber-400 hover:text-amber-300 transition-colors"
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
                        className="p-1.5 rounded-lg hover:bg-white/10 text-white/40 hover:text-white transition-colors"
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
                      className="p-1.5 rounded-lg hover:bg-red-500/20 text-white/40 hover:text-red-400 transition-colors"
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
        <div className="fixed inset-y-0 right-0 w-full max-w-md bg-[#1a1a2e] border-l border-white/10 shadow-2xl z-20 overflow-y-auto">
          <div className="p-6">
            <div className="flex items-start justify-between mb-6">
              <div className="flex-1">
                <div className="flex items-center gap-2 mb-1">
                  <h2 className="text-xl font-semibold text-white">{selectedReference.title}</h2>
                  {selectedReference.isPinned && (
                    <Pin className="w-4 h-4 text-amber-400" />
                  )}
                </div>
                {selectedReference.source && (
                  <p className="text-white/60">{selectedReference.source}</p>
                )}
              </div>
              <button
                onClick={() => setSelectedReference(null)}
                className="p-2 rounded-lg hover:bg-white/10 text-white/40 hover:text-white transition-colors"
              >
                <span className="sr-only">Close</span>
                &times;
              </button>
            </div>

            <div className="space-y-4">
              <div className="flex items-center gap-2">
                <span
                  className={`text-xs px-2 py-1 rounded border ${
                    TYPE_CONFIG[selectedReference.referenceType]?.color || TYPE_CONFIG.OTHER.color
                  }`}
                >
                  {TYPE_CONFIG[selectedReference.referenceType]?.label || "Other"}
                </span>
                <span className="text-xs text-white/40">
                  Added {new Date(selectedReference.createdAt).toLocaleDateString()}
                </span>
              </div>

              {selectedReference.url && (
                <a
                  href={selectedReference.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-2 text-emerald-400 hover:text-emerald-300 transition-colors"
                >
                  <ExternalLink className="w-4 h-4" />
                  <span className="text-sm underline">{selectedReference.url}</span>
                </a>
              )}

              {selectedReference.contentText && (
                <div className="bg-white/5 rounded-lg p-4">
                  <h4 className="text-xs font-medium text-white/60 uppercase tracking-wider mb-2">
                    Content
                  </h4>
                  <p className="text-white/80 whitespace-pre-wrap">
                    {selectedReference.contentText}
                  </p>
                </div>
              )}

              {selectedReference.detectedContext && (
                <div className="bg-white/5 rounded-lg p-4">
                  <h4 className="text-xs font-medium text-white/60 uppercase tracking-wider mb-2">
                    Context
                  </h4>
                  <p className="text-white/60 text-sm">
                    {selectedReference.detectedContext}
                  </p>
                </div>
              )}

              {selectedReference.notes && (
                <div className="bg-white/5 rounded-lg p-4">
                  <h4 className="text-xs font-medium text-white/60 uppercase tracking-wider mb-2">
                    Notes
                  </h4>
                  <p className="text-white/80 text-sm">{selectedReference.notes}</p>
                </div>
              )}
            </div>

            <div className="flex items-center gap-2 mt-6 pt-6 border-t border-white/10">
              {selectedReference.isPinned ? (
                <button
                  onClick={() => handleUnpin(selectedReference)}
                  className="flex-1 flex items-center justify-center gap-2 px-4 py-2 rounded-lg bg-amber-400/20 text-amber-400 hover:bg-amber-400/30 transition-colors"
                >
                  <PinOff className="w-4 h-4" />
                  Unpin
                </button>
              ) : (
                <button
                  onClick={() => handlePin(selectedReference)}
                  className="flex-1 flex items-center justify-center gap-2 px-4 py-2 rounded-lg bg-white/10 text-white hover:bg-white/20 transition-colors"
                >
                  <Pin className="w-4 h-4" />
                  Pin to Library
                </button>
              )}
              <button
                onClick={() => handleDelete(selectedReference)}
                className="px-4 py-2 rounded-lg bg-red-500/20 text-red-400 hover:bg-red-500/30 transition-colors"
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
