import React from "react";
import {
  Music,
  FileText,
  Video,
  BookOpen,
  Globe,
  MoreHorizontal,
  Pin,
  PinOff,
  Trash2,
  ExternalLink,
  Save
} from "lucide-react";
import type { DetectedReference, Reference, ReferenceType } from "../lib/types";

interface ReferenceCardProps {
  reference: Reference | DetectedReference;
  isDetected?: boolean;
  onSave?: (ref: DetectedReference) => void;
  onPin?: (ref: Reference) => void;
  onUnpin?: (ref: Reference) => void;
  onDelete?: (ref: Reference) => void;
}

const TYPE_CONFIG: Record<ReferenceType, { icon: React.ElementType; color: string; label: string }> = {
  SONG: { icon: Music, color: "text-purple-400 bg-purple-400/20", label: "Song" },
  LYRICS: { icon: FileText, color: "text-pink-400 bg-pink-400/20", label: "Lyrics" },
  ARTICLE: { icon: FileText, color: "text-blue-400 bg-blue-400/20", label: "Article" },
  VIDEO: { icon: Video, color: "text-red-400 bg-red-400/20", label: "Video" },
  BOOK_EXCERPT: { icon: BookOpen, color: "text-amber-400 bg-amber-400/20", label: "Book" },
  CULTURAL: { icon: Globe, color: "text-emerald-400 bg-emerald-400/20", label: "Cultural" },
  OTHER: { icon: MoreHorizontal, color: "text-gray-400 bg-gray-400/20", label: "Other" },
};

export function ReferenceCard({
  reference,
  isDetected = false,
  onSave,
  onPin,
  onUnpin,
  onDelete
}: ReferenceCardProps) {
  const type = isDetected
    ? (reference as DetectedReference).type
    : (reference as Reference).referenceType;
  const config = TYPE_CONFIG[type] || TYPE_CONFIG.OTHER;
  const Icon = config.icon;

  const title = reference.title;
  const source = reference.source;
  const context = isDetected
    ? (reference as DetectedReference).context
    : (reference as Reference).detectedContext;
  const url = !isDetected ? (reference as Reference).url : undefined;
  const isPinned = !isDetected && (reference as Reference).isPinned;

  return (
    <div className="bg-white/5 backdrop-blur-sm rounded-lg p-3 border border-white/10 hover:border-white/20 transition-colors">
      <div className="flex items-start gap-3">
        <div className={`p-2 rounded-lg ${config.color.split(' ')[1]}`}>
          <Icon className={`w-4 h-4 ${config.color.split(' ')[0]}`} />
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <h4 className="text-sm font-medium text-white truncate">{title}</h4>
            {isPinned && (
              <Pin className="w-3 h-3 text-amber-400 flex-shrink-0" />
            )}
          </div>

          {source && (
            <p className="text-xs text-white/60 mt-0.5">{source}</p>
          )}

          {context && (
            <p className="text-xs text-white/40 mt-1 line-clamp-2">{context}</p>
          )}

          <div className="flex items-center gap-1 mt-2">
            <span className={`text-[10px] px-1.5 py-0.5 rounded ${config.color}`}>
              {config.label}
            </span>
          </div>
        </div>

        <div className="flex items-center gap-1">
          {isDetected && onSave ? (
            <button
              onClick={() => onSave(reference as DetectedReference)}
              className="p-1.5 rounded-lg bg-emerald-500/20 text-emerald-400 hover:bg-emerald-500/30 transition-colors"
              title="Save to library"
            >
              <Save className="w-4 h-4" />
            </button>
          ) : (
            <>
              {url && (
                <a
                  href={url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="p-1.5 rounded-lg hover:bg-white/10 text-white/60 hover:text-white transition-colors"
                  title="Open link"
                >
                  <ExternalLink className="w-4 h-4" />
                </a>
              )}

              {isPinned && onUnpin ? (
                <button
                  onClick={() => onUnpin(reference as Reference)}
                  className="p-1.5 rounded-lg hover:bg-white/10 text-amber-400 hover:text-amber-300 transition-colors"
                  title="Unpin"
                >
                  <PinOff className="w-4 h-4" />
                </button>
              ) : onPin ? (
                <button
                  onClick={() => onPin(reference as Reference)}
                  className="p-1.5 rounded-lg hover:bg-white/10 text-white/60 hover:text-white transition-colors"
                  title="Pin to library"
                >
                  <Pin className="w-4 h-4" />
                </button>
              ) : null}

              {onDelete && (
                <button
                  onClick={() => onDelete(reference as Reference)}
                  className="p-1.5 rounded-lg hover:bg-red-500/20 text-white/60 hover:text-red-400 transition-colors"
                  title="Delete"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
