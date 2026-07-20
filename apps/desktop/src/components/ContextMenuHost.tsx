import { useTranslation } from "react-i18next";
import { Scissors, Copy, ClipboardPaste, Download } from "lucide-react";
import { ICON, MenuItem, MenuSurface } from "@plainva/ui";
import { useContextMenu, closeContextMenu, type ImageContextTarget } from "../services/contextMenuStore";
import { insertIntoEditable, deleteEditableSelection } from "@plainva/ui";
import { toast } from "@plainva/ui";

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
  const { selection, editable, image } = state;
  const hasSelection = selection.length > 0;

  const onCopy = () => {
    writeClipboard(selection).catch(() => toast.error(t("contextMenu.copyFailed")));
  };
  const onCopyImage = () => {
    if (!image) return;
    copyImageToClipboard(image).catch(() => toast.error(t("contextMenu.copyImageFailed", { defaultValue: "Bild konnte nicht kopiert werden" })));
  };
  const onSaveImageAs = () => {
    if (!image) return;
    void saveImageToDisk(image).catch((e) => toast.error(String((e as { message?: string })?.message ?? e)));
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
      {image ? (
        <>
          <MenuItem icon={<Copy size={ICON.ui} />} onSelect={onCopyImage}>
            {t("contextMenu.copyImage", { defaultValue: "Bild kopieren" })}
          </MenuItem>
          <MenuItem icon={<Download size={ICON.ui} />} onSelect={onSaveImageAs}>
            {t("contextMenu.saveImageAs", { defaultValue: "Bild speichern unter…" })}
          </MenuItem>
        </>
      ) : editable ? (
        <>
          <MenuItem icon={<Scissors size={ICON.ui} />} onSelect={onCut} disabled={!hasSelection}>
            {t("contextMenu.cut")}
          </MenuItem>
          <MenuItem icon={<Copy size={ICON.ui} />} onSelect={onCopy} disabled={!hasSelection}>
            {t("contextMenu.copy")}
          </MenuItem>
          <MenuItem icon={<ClipboardPaste size={ICON.ui} />} onSelect={onPaste}>
            {t("contextMenu.paste")}
          </MenuItem>
        </>
      ) : (
        <MenuItem icon={<Copy size={ICON.ui} />} onSelect={onCopy}>
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

async function copyImageToClipboard(image: ImageContextTarget): Promise<void> {
  const bytes = await image.loadBytes();
  let blob = new Blob([new Uint8Array(bytes)], { type: image.mime });
  // ClipboardItem reliably accepts PNG across WebViews; re-encode other formats.
  if (image.mime !== "image/png") blob = await reencodeToPng(blob);
  await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
}

async function reencodeToPng(blob: Blob): Promise<Blob> {
  const url = URL.createObjectURL(blob);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error("image decode failed"));
      el.src = url;
    });
    const canvas = document.createElement("canvas");
    canvas.width = img.naturalWidth;
    canvas.height = img.naturalHeight;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("no 2d context");
    ctx.drawImage(img, 0, 0);
    return await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("png encode failed"))), "image/png"),
    );
  } finally {
    URL.revokeObjectURL(url);
  }
}

async function saveImageToDisk(image: ImageContextTarget): Promise<void> {
  const { save } = await import("@tauri-apps/plugin-dialog");
  const ext = (image.filename.split(".").pop() || "png").toLowerCase();
  const target = await save({ defaultPath: image.filename, filters: [{ name: "Image", extensions: [ext] }] });
  if (!target) return;
  const { writeFile } = await import("@tauri-apps/plugin-fs");
  await writeFile(target, await image.loadBytes());
}
