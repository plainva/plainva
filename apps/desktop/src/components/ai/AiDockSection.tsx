import { editorSelectionReader } from "../../services/editorSelection";
import { AiConversation } from "@plainva/ui";

export interface AiDockProps {
  activeNote: { path: string; title: string } | null;
  onNewConversation: () => void;
  onOpenNote: (target: string) => void;
  /** Opens a note the conversation just made — an answer kept as a note — in a tab of its own, beside what is open. */
  onOpenCreated?: (path: string) => void;
  /** `composed`: the model put the address together itself (plan KI-Harness P4); the question before opening says so. */
  onOpenUrl: (url: string, composed?: boolean) => void;
  onOpenSettings: () => void;
  onPickNote?: () => void;
}

/**
 * The dock (plan KI-Harness §19.1, dress B): the conversation as the last
 * section of the right sidebar, beside the note it is about. The same one
 * conversation the companion and the AI tab show — docking changes the dress,
 * never the conversation. A 250-px column: the thread keeps a bounded height,
 * so the section scrolls inside and the sidebar around it stays put.
 */
export function AiDockSection({ activeNote, onOpenNote, onOpenCreated, onOpenUrl, onOpenSettings, onPickNote }: AiDockProps) {
  return (
    <div className="pv-ai-dock" data-testid="ai-dock">
      <AiConversation selection={editorSelectionReader} dress="dock" activeNote={activeNote} onOpenNote={onOpenNote} onOpenCreated={onOpenCreated} onOpenUrl={onOpenUrl} onOpenSettings={onOpenSettings} onPickNote={onPickNote} />
    </div>
  );
}
