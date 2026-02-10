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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
      <div className="bg-white rounded-2xl border border-black/10 w-full max-w-md mx-4 shadow-2xl">
        <div className="flex items-center justify-between p-5 border-b border-black/10">
          <h2 className="text-xl font-semibold text-textMain">Add Reference</h2>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg hover:bg-black/5 text-textSoft hover:text-textMain transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-5 space-y-4">
          {error && (
            <div className="p-3 rounded-xl bg-red-50 border border-red-200 text-red-600 text-sm">
              {error}
            </div>
          )}

          <div>
            <label className="block text-sm font-medium text-textMain mb-1.5">
              Title <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g., La Bamba, Don Quixote"
              className="w-full px-3 py-2.5 rounded-xl bg-plaster/50 border border-black/10 text-textMain placeholder-textSoft focus:outline-none focus:border-pink/40 transition-colors"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-textMain mb-1.5">
              Type
            </label>
            <select
              value={referenceType}
              onChange={(e) => setReferenceType(e.target.value as ReferenceType)}
              className="w-full px-3 py-2.5 rounded-xl bg-plaster/50 border border-black/10 text-textMain focus:outline-none focus:border-pink/40 transition-colors"
            >
              {REFERENCE_TYPES.map((type) => (
                <option key={type.value} value={type.value}>
                  {type.label}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-textMain mb-1.5">
              URL
            </label>
            <input
              type="url"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://..."
              className="w-full px-3 py-2.5 rounded-xl bg-plaster/50 border border-black/10 text-textMain placeholder-textSoft focus:outline-none focus:border-pink/40 transition-colors"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-textMain mb-1.5">
              Content (lyrics, excerpt, notes)
            </label>
            <textarea
              value={contentText}
              onChange={(e) => setContentText(e.target.value)}
              placeholder="Paste lyrics, excerpt, or notes here..."
              rows={4}
              className="w-full px-3 py-2.5 rounded-xl bg-plaster/50 border border-black/10 text-textMain placeholder-textSoft focus:outline-none focus:border-pink/40 transition-colors resize-none"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-textMain mb-1.5">
              Artist / Author / Source
            </label>
            <input
              type="text"
              value={source}
              onChange={(e) => setSource(e.target.value)}
              placeholder="e.g., Ritchie Valens, Cervantes"
              className="w-full px-3 py-2.5 rounded-xl bg-plaster/50 border border-black/10 text-textMain placeholder-textSoft focus:outline-none focus:border-pink/40 transition-colors"
            />
          </div>

          <div className="flex gap-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 px-4 py-2.5 rounded-xl bg-plaster text-textSoft hover:bg-plaster/80 transition-colors font-medium"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="flex-1 px-4 py-2.5 rounded-xl bg-pink text-white font-semibold hover:bg-pink/90 transition-colors"
            >
              Save
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
