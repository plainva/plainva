import { useEffect } from "react";
import { AiConversation, AiSessionContext, noteDisplayName } from "@plainva/ui";
import { focusAiNote, getMobileAiSession, openAiLink, openAiNoteTarget, openAiSettings } from "../services/ai/mobileAi";
import type { MobileVault } from "../services/vaultService";
import { editorSelectionReader } from "../services/editorSelection";

/**
 * The AI segment of the note's context (plan KI-Harness §19.1): the desktop
 * dock's counterpart — docked beside the note from a tablet's width, over it
 * on a phone. The same one conversation the KI sheet and the KI screen show;
 * the note it opens beside is the AI's open note.
 */
export function NoteAiSegment({ vault, path, onOpenNote }: { vault: MobileVault; path: string; onOpenNote: (path: string) => void }) {
  useEffect(() => {
    focusAiNote(path);
  }, [path]);
  return (
    <AiSessionContext.Provider value={getMobileAiSession()}>
      <div className="m-ai-segment" data-testid="ai-context-segment">
        <AiConversation
          selection={editorSelectionReader}
          dress="sheet"
          activeNote={{ path, title: noteDisplayName(path) }}
          onOpenNote={(target) => openAiNoteTarget(vault, target, onOpenNote)}
          onOpenUrl={openAiLink}
          onOpenSettings={openAiSettings}
        />
      </div>
    </AiSessionContext.Provider>
  );
}
