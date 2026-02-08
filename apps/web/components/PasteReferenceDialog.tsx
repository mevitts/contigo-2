import React, { useState } from "react";
import { X } from "lucide-react";
import type { ReferenceType, CreateReferenceRequest } from "../lib/types";

interface PasteReferenceDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (data: Omit<CreateReferenceRequest, 'userId' | 'conversationId'>) => void;
}

const REFERENCE_TYPES: { value: ReferenceType; label: string }[] = [
  { value: "SONG", label: "Song" },
  { value: "LYRICS", label: "Lyrics" },
  { value: "ARTICLE", label: "Article" },
  { value: "VIDEO", label: "Video" },
  { value: "BOOK_EXCERPT", label: "Book Excerpt" },
  { value: "CULTURAL", label: "Cultural Reference" },
  { value: "OTHER", label: "Other" },
];

export function PasteReferenceDialog({ isOpen, onClose, onSave }: PasteReferenceDialogProps) {
  const [title, setTitle] = useState("");
  const [referenceType, setReferenceType] = useState<ReferenceType>("OTHER");
  const [url, setUrl] = useState("");
  const [contentText, setContentText] = useState("");
  const [source, setSource] = useState("");
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!title.trim()) {
      setError("Title is required");
      return;
    }

    if (!url.trim() && !contentText.trim()) {
      setError("Please provide either a URL or content");
      return;
    }

    onSave({
      title: title.trim(),
      referenceType,
      url: url.trim() || null,
      contentText: contentText.trim() || null,
      source: source.trim() || null,
      detectionMethod: "manual",
    });

    // Reset form
    setTitle("");
    setReferenceType("OTHER");
    setUrl("");
    setContentText("");
    setSource("");
    onClose();
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="bg-[#1a1a2e] rounded-2xl border border-white/10 w-full max-w-md mx-4 shadow-2xl">
        <div className="flex items-center justify-between p-4 border-b border-white/10">
          <h2 className="text-lg font-semibold text-white">Add Reference</h2>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg hover:bg-white/10 text-white/60 hover:text-white transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-4 space-y-4">
          {error && (
            <div className="p-3 rounded-lg bg-red-500/20 border border-red-500/30 text-red-300 text-sm">
              {error}
            </div>
          )}

          <div>
            <label className="block text-sm font-medium text-white/80 mb-1.5">
              Title <span className="text-red-400">*</span>
            </label>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g., La Bamba, Don Quixote"
              className="w-full px-3 py-2 rounded-lg bg-white/5 border border-white/10 text-white placeholder-white/40 focus:outline-none focus:border-white/30 transition-colors"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-white/80 mb-1.5">
              Type
            </label>
            <select
              value={referenceType}
              onChange={(e) => setReferenceType(e.target.value as ReferenceType)}
              className="w-full px-3 py-2 rounded-lg bg-white/5 border border-white/10 text-white focus:outline-none focus:border-white/30 transition-colors"
            >
              {REFERENCE_TYPES.map((type) => (
                <option key={type.value} value={type.value} className="bg-[#1a1a2e]">
                  {type.label}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-white/80 mb-1.5">
              URL
            </label>
            <input
              type="url"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://..."
              className="w-full px-3 py-2 rounded-lg bg-white/5 border border-white/10 text-white placeholder-white/40 focus:outline-none focus:border-white/30 transition-colors"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-white/80 mb-1.5">
              Content (lyrics, excerpt, notes)
            </label>
            <textarea
              value={contentText}
              onChange={(e) => setContentText(e.target.value)}
              placeholder="Paste lyrics, excerpt, or notes here..."
              rows={4}
              className="w-full px-3 py-2 rounded-lg bg-white/5 border border-white/10 text-white placeholder-white/40 focus:outline-none focus:border-white/30 transition-colors resize-none"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-white/80 mb-1.5">
              Artist / Author / Source
            </label>
            <input
              type="text"
              value={source}
              onChange={(e) => setSource(e.target.value)}
              placeholder="e.g., Ritchie Valens, Cervantes"
              className="w-full px-3 py-2 rounded-lg bg-white/5 border border-white/10 text-white placeholder-white/40 focus:outline-none focus:border-white/30 transition-colors"
            />
          </div>

          <div className="flex gap-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 px-4 py-2.5 rounded-lg bg-white/5 text-white/80 hover:bg-white/10 transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="flex-1 px-4 py-2.5 rounded-lg bg-emerald-500 text-white font-medium hover:bg-emerald-600 transition-colors"
            >
              Save
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
