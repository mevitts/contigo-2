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
  SONG: { icon: Music, color: "text-[#e6007e] bg-[#fce4f0]", label: "Song" },
  LYRICS: { icon: FileText, color: "text-[#00bdd0] bg-[#e0f7fa]", label: "Lyrics" },
  ARTICLE: { icon: FileText, color: "text-[#2d9fec] bg-[#e3f2fd]", label: "Article" },
  VIDEO: { icon: Video, color: "text-[#7cb342] bg-[#f1f8e9]", label: "Video" },
  BOOK_EXCERPT: { icon: BookOpen, color: "text-[#c9a800] bg-[#fff9e6]", label: "Book" },
  CULTURAL: { icon: Globe, color: "text-[#00b876] bg-[#e8f5e9]", label: "Cultural" },
  OTHER: { icon: MoreHorizontal, color: "text-[#8c8c8c] bg-[#f5f0ea]", label: "Other" },
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
    <div className="bg-white rounded-xl p-4 border border-black/8 hover:border-pink/30 transition-colors shadow-sm">
      <div className="flex items-start gap-3">
        <div className={`p-2 rounded-lg ${config.color.split(' ')[1]}`}>
          <Icon className={`w-5 h-5 ${config.color.split(' ')[0]}`} />
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <h4 className="text-base font-medium text-textMain truncate">{title}</h4>
            {isPinned && (
              <Pin className="w-3.5 h-3.5 text-[#fcd53a] flex-shrink-0" />
            )}
          </div>

          {source && (
            <p className="text-sm text-textSoft mt-0.5">{source}</p>
          )}

          {context && (
            <p className="text-sm text-textSoft/70 mt-1 line-clamp-2">{context}</p>
          )}

          <div className="flex items-center gap-1 mt-2">
            <span className={`text-xs px-2 py-0.5 rounded-lg ${config.color}`}>
              {config.label}
            </span>
          </div>
        </div>

        <div className="flex items-center gap-1">
          {isDetected && onSave ? (
            <button
              onClick={() => onSave(reference as DetectedReference)}
              className="p-1.5 rounded-lg bg-[#00d891]/15 text-[#00b876] hover:bg-[#00d891]/25 transition-colors"
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
                  className="p-1.5 rounded-lg hover:bg-black/5 text-textSoft hover:text-textMain transition-colors"
                  title="Open link"
                >
                  <ExternalLink className="w-4 h-4" />
                </a>
              )}

              {isPinned && onUnpin ? (
                <button
                  onClick={() => onUnpin(reference as Reference)}
                  className="p-1.5 rounded-lg hover:bg-[#fcd53a]/10 text-[#fcd53a] hover:text-[#c9a800] transition-colors"
                  title="Unpin"
                >
                  <PinOff className="w-4 h-4" />
                </button>
              ) : onPin ? (
                <button
                  onClick={() => onPin(reference as Reference)}
                  className="p-1.5 rounded-lg hover:bg-black/5 text-textSoft hover:text-textMain transition-colors"
                  title="Pin to library"
                >
                  <Pin className="w-4 h-4" />
                </button>
              ) : null}

              {onDelete && (
                <button
                  onClick={() => onDelete(reference as Reference)}
                  className="p-1.5 rounded-lg hover:bg-red-50 text-textSoft hover:text-red-500 transition-colors"
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
