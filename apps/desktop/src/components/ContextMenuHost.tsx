import { useTranslation } from "react-i18next";
import { Scissors, Copy, ClipboardPaste } from "lucide-react";
import { MenuSurface, MenuItem } from "@plainva/ui";
import { useContextMenu, closeContextMenu } from "../services/contextMenuStore";
import { insertIntoEditable, deleteEditableSelection } from "@plainva/ui";
import { toast } from "../services/toastStore";

/**
 * The app's own right-click menu (webview hardening, 2026-07-07). The native
 * WebView menu is suppressed; instead this offers Cut/Copy/Paste over an
 * editable field (input/textarea/CodeMirror) or just Copy over a plain text
 * selection. Mounted once at the app root next to DialogHost/ToastHost.
 */
export function ContextMenuHost() {
  const { t } = useTranslation();
  const state = useContextMenu();
  if (!state) return null;
  const { selection, editable } = state;
  const hasSelection = selection.length > 0;

  const onCopy = () => {
    writeClipboard(selection).catch(() => toast.error(t("contextMenu.copyFailed")));
  };
  const onCut = () => {
    if (!editable) return;
    // Delete only after the copy succeeds, so a clipboard failure never loses text.
    writeClipboard(selection)
      .then(() => deleteEditableSelection(editable))
      .catch(() => toast.error(t("contextMenu.copyFailed")));
  };
  const onPaste = () => {
    if (!editable) return;
    readClipboard()
      .then((text) => {
        if (text) insertIntoEditable(editable, text);
      })
      .catch(() => toast.error(t("contextMenu.pasteFailed")));
  };

  return (
    <MenuSurface
      open
      onClose={closeContextMenu}
      at={{ x: state.x, y: state.y }}
      minWidth={160}
      ariaLabel={t("contextMenu.label")}
    >
      {editable ? (
        <>
          <MenuItem icon={<Scissors size={15} />} onSelect={onCut} disabled={!hasSelection}>
            {t("contextMenu.cut")}
          </MenuItem>
          <MenuItem icon={<Copy size={15} />} onSelect={onCopy} disabled={!hasSelection}>
            {t("contextMenu.copy")}
          </MenuItem>
          <MenuItem icon={<ClipboardPaste size={15} />} onSelect={onPaste}>
            {t("contextMenu.paste")}
          </MenuItem>
        </>
      ) : (
        <MenuItem icon={<Copy size={15} />} onSelect={onCopy}>
          {t("contextMenu.copy")}
        </MenuItem>
      )}
    </MenuSurface>
  );
}

async function writeClipboard(text: string): Promise<void> {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }
  // Fallback for webviews that reject the async clipboard API; copies the live selection.
  if (!document.execCommand("copy")) throw new Error("copy failed");
}

async function readClipboard(): Promise<string> {
  if (navigator.clipboard?.readText) return navigator.clipboard.readText();
  throw new Error("clipboard read unavailable");
}
