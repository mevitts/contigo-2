import React, { useState } from "react";
import { Plus, BookOpen, Pin, Sparkles } from "lucide-react";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "./ui/sheet";
import { ReferenceCard } from "./ReferenceCard";
import { PasteReferenceDialog } from "./PasteReferenceDialog";
import type { DetectedReference, Reference, CreateReferenceRequest } from "../lib/types";

interface ReferencePanelProps {
  isOpen: boolean;
  onClose: () => void;
  detectedReferences: DetectedReference[];
  sessionReferences: Reference[];
  pinnedReferences: Reference[];
  userId: string;
  conversationId?: string;
  onSaveDetected: (ref: DetectedReference) => void;
  onPin: (ref: Reference) => void;
  onUnpin: (ref: Reference) => void;
  onDelete: (ref: Reference) => void;
  onManualAdd: (data: Omit<CreateReferenceRequest, 'userId' | 'conversationId'>) => void;
}

export function ReferencePanel({
  isOpen,
  onClose,
  detectedReferences,
  sessionReferences,
  pinnedReferences,
  onSaveDetected,
  onPin,
  onUnpin,
  onDelete,
  onManualAdd,
}: ReferencePanelProps) {
  const [showPasteDialog, setShowPasteDialog] = useState(false);

  return (
    <>
      <Sheet open={isOpen} onOpenChange={(open) => !open && onClose()}>
        <SheetContent side="right" className="bg-white border-black/10 overflow-y-auto">
          <SheetHeader className="border-b border-black/10 pb-4">
            <SheetTitle className="flex items-center gap-2 text-textMain">
              <BookOpen className="w-5 h-5 text-[#00bdd0]" />
              Reference Library
            </SheetTitle>
          </SheetHeader>

          <div className="py-4 space-y-6">
            {/* Detected References Section */}
            {detectedReferences.length > 0 && (
              <section>
                <div className="flex items-center gap-2 mb-3">
                  <Sparkles className="w-4 h-4 text-[#fcd53a]" />
                  <h3 className="text-base font-medium text-textMain">
                    Just Detected ({detectedReferences.length})
                  </h3>
                </div>
                <div className="space-y-2">
                  {detectedReferences.map((ref, idx) => (
                    <ReferenceCard
                      key={`detected-${idx}`}
                      reference={ref}
                      isDetected
                      onSave={onSaveDetected}
                    />
                  ))}
                </div>
              </section>
            )}

            {/* Session References Section */}
            {sessionReferences.length > 0 && (
              <section>
                <h3 className="text-base font-medium text-textMain mb-3">
                  This Session ({sessionReferences.length})
                </h3>
                <div className="space-y-2">
                  {sessionReferences.map((ref) => (
                    <ReferenceCard
                      key={ref.id}
                      reference={ref}
                      onPin={onPin}
                      onUnpin={onUnpin}
                      onDelete={onDelete}
                    />
                  ))}
                </div>
              </section>
            )}

            {/* Pinned Library Section */}
            {pinnedReferences.length > 0 && (
              <section>
                <div className="flex items-center gap-2 mb-3">
                  <Pin className="w-4 h-4 text-[#fcd53a]" />
                  <h3 className="text-base font-medium text-textMain">
                    Pinned ({pinnedReferences.length})
                  </h3>
                </div>
                <div className="space-y-2">
                  {pinnedReferences.map((ref) => (
                    <ReferenceCard
                      key={ref.id}
                      reference={ref}
                      onPin={onPin}
                      onUnpin={onUnpin}
                      onDelete={onDelete}
                    />
                  ))}
                </div>
              </section>
            )}

            {/* Empty State */}
            {detectedReferences.length === 0 &&
              sessionReferences.length === 0 &&
              pinnedReferences.length === 0 && (
                <div className="text-center py-8">
                  <BookOpen className="w-12 h-12 text-textSoft/30 mx-auto mb-3" />
                  <p className="text-textSoft text-base">
                    No references yet. Songs, lyrics, and cultural references mentioned during your session will appear here.
                  </p>
                </div>
              )}

            {/* Add Manually Button */}
            <button
              onClick={() => setShowPasteDialog(true)}
              className="w-full flex items-center justify-center gap-2 px-4 py-3 rounded-xl bg-plaster/50 border border-dashed border-black/15 text-textSoft hover:text-textMain hover:border-pink/40 hover:bg-plaster transition-colors"
            >
              <Plus className="w-4 h-4" />
              <span>Paste Content Manually</span>
            </button>
          </div>
        </SheetContent>
      </Sheet>

      <PasteReferenceDialog
        isOpen={showPasteDialog}
        onClose={() => setShowPasteDialog(false)}
        onSave={onManualAdd}
      />
    </>
  );
}
