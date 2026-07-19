import { useEffect, useRef, useState } from "react";
import { applyIndexChanges } from "../services/fileActions";
import { useTranslation } from "react-i18next";
import { appConfirm } from "../services/appDialogs";
import { ICON, Modal, toast } from "@plainva/ui";
import {
  ArrowUpRight, Bookmark, Crop, FlipHorizontal2, FlipVertical2, Maximize, MousePointer2,
  PenLine, Redo2, RotateCcw, RotateCw, Scaling, Square, Trash2, Type, Undo2, ZoomIn, ZoomOut,
} from "lucide-react";
import { useVault } from "../contexts/VaultContext";
import { SplitButton } from "./SplitButton";
import { imageMimeType, isEditableImage, loadImageBlob, saveCanvasToVault } from "@plainva/ui";
import { notifyFileOps } from "../services/indexMdAutoUpdate";
import { copyCandidate } from "./fileTreeModel";
import {
  clampRect, emptyEditorState, pushOp, rectFrom, redoOp, renderOps, sizeAfterOps,
  toCanvasPoint, undoOp, type EditorState, type ImageOp, type Point,
} from "./imageEditorModel";

type Tool = "select" | "crop" | "pen" | "arrow" | "rect" | "text";

const ZOOM_STEPS = [0.25, 0.5, 0.75, 1, 1.5, 2, 3, 4];

/**
 * In-app viewer + simple canvas editor for vault images (plan UI-UX-Paket P10).
 * Viewing uses a blob URL (never asset:// — no canvas taint, no stale cache
 * after saving); editing replays an op list over the original bitmap. Editable
 * formats: PNG/JPG/WebP; SVG/GIF/BMP/AVIF are view-only.
 */
export function ImageViewer({ path, onOpenPath, isBookmarked, onToggleBookmark, onDelete, onSplit, activeSplitDirection }: {
  path: string;
  onOpenPath?: (p: string, newTab?: boolean) => void;
  isBookmarked?: boolean;
  onToggleBookmark?: () => void;
  onDelete?: () => void;
  onSplit?: (direction: "vertical" | "horizontal") => void;
  activeSplitDirection?: "vertical" | "horizontal";
}) {
  const { t } = useTranslation();
  const { vaultAdapter, indexer, triggerFileTreeUpdate } = useVault();
  const [bitmap, setBitmap] = useState<ImageBitmap | null>(null);
  const [objectUrl, setObjectUrl] = useState<string | null>(null);
  const [byteSize, setByteSize] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [zoom, setZoom] = useState<number | "fit">("fit");
  const [editing, setEditing] = useState(false);
  const [state, setState] = useState<EditorState>(emptyEditorState);
  const [tool, setTool] = useState<Tool>("select");
  // Default pen color: this is DATA — it gets painted into the saved bitmap
  // via renderOps(), not app chrome — so it is exempt from the token rule.
  const [color, setColor] = useState("#e5484d");
  const [strokeWidth, setStrokeWidth] = useState(4);
  const [busy, setBusy] = useState(false);
  const [saveAsName, setSaveAsName] = useState<string | null>(null);
  const [resizeDraft, setResizeDraft] = useState<{ width: string; height: string; keepRatio: boolean } | null>(null);
  const [textDraft, setTextDraft] = useState<{ at: Point; value: string } | null>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const dragRef = useRef<{ start: Point; points: Point[] } | null>(null);
  const saveAsInputRef = useRef<HTMLInputElement>(null);

  const fileName = path.split(/[/\\]/).pop() ?? path;
  const editable = isEditableImage(path);
  const currentSize = bitmap ? sizeAfterOps({ width: bitmap.width, height: bitmap.height }, state.ops) : null;

  useEffect(() => {
    let alive = true;
    let url: string | null = null;
    setError(null);
    setBitmap(null);
    setObjectUrl(null);
    setEditing(false);
    setState(emptyEditorState());
    setZoom("fit");
    if (!vaultAdapter) return;
    loadImageBlob(vaultAdapter, path)
      .then(async (blob) => {
        if (!alive) return;
        url = URL.createObjectURL(blob);
        setObjectUrl(url);
        setByteSize(blob.size);
        try {
          const bmp = await createImageBitmap(blob);
          if (alive) setBitmap(bmp);
          else bmp.close();
        } catch {
          // e.g. SVG without intrinsic size — the <img> viewer still works.
          if (alive) setBitmap(null);
        }
      })
      .catch((e) => {
        console.error("[ImageViewer] loading failed", path, e);
        if (alive) setError(t("imageViewer.loadError"));
      });
    return () => {
      alive = false;
      if (url) URL.revokeObjectURL(url);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path, vaultAdapter]);

  // Replay the ops whenever they change while editing.
  useEffect(() => {
    if (editing && bitmap && canvasRef.current) renderOps(bitmap, state.ops, canvasRef.current);
  }, [editing, bitmap, state]);

  const cancelEditing = async () => {
    if (state.ops.length > 0) {
      const ok = await appConfirm({ title: t("imageViewer.editTitle"), message: t("imageViewer.discardConfirm"), kind: "warning" });
      if (!ok) return;
    }
    setState(emptyEditorState());
    setTextDraft(null);
    setEditing(false);
  };

  // Escape cancels, Ctrl+Z/Y undo/redo (editing only).
  useEffect(() => {
    if (!editing) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !textDraft && saveAsName == null && !resizeDraft) {
        e.preventDefault();
        void cancelEditing();
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") {
        e.preventDefault();
        setState((s) => undoOp(s));
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "y") {
        e.preventDefault();
        setState((s) => redoOp(s));
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editing, textDraft, saveAsName, resizeDraft, state.ops.length]);

  const addOp = (op: ImageOp) => setState((s) => pushOp(s, op));

  const tempOpFor = (d: { start: Point; points: Point[] }, p: Point): ImageOp | null => {
    if (tool === "pen") return { kind: "draw", tool: "pen", points: [...d.points], color, strokeWidth };
    if (tool === "arrow") return { kind: "draw", tool: "arrow", points: [d.start, p], color, strokeWidth };
    if (tool === "rect") return { kind: "draw", tool: "rect", rect: rectFrom(d.start, p), color, strokeWidth };
    return null;
  };

  const drawCropOverlay = (canvas: HTMLCanvasElement, a: Point, b: Point) => {
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const r = rectFrom(a, b);
    // Marquee color follows the theme (canvas chrome, not saved pixel data) —
    // read the accent custom property the way the graph canvas does, instead
    // of hard-coding a color literal.
    const accent = getComputedStyle(document.documentElement).getPropertyValue("--accent-color").trim() || "white";
    ctx.save();
    ctx.strokeStyle = accent;
    ctx.lineWidth = 1.5;
    ctx.setLineDash([6, 4]);
    ctx.strokeRect(r.x, r.y, r.width, r.height);
    ctx.restore();
  };

  const onCanvasPointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!bitmap || tool === "select" || e.button !== 0) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    try { canvas.setPointerCapture(e.pointerId); } catch { /* unsupported */ }
    const p = toCanvasPoint(e, canvas);
    if (tool === "text") {
      setTextDraft({ at: p, value: "" });
      return;
    }
    dragRef.current = { start: p, points: [p] };
  };

  const onCanvasPointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!bitmap || !dragRef.current) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const p = toCanvasPoint(e, canvas);
    const d = dragRef.current;
    d.points.push(p);
    renderOps(bitmap, state.ops, canvas, tempOpFor(d, p) ?? undefined);
    if (tool === "crop") drawCropOverlay(canvas, d.start, p);
  };

  const onCanvasPointerUp = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!bitmap || !dragRef.current) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const p = toCanvasPoint(e, canvas);
    const d = dragRef.current;
    dragRef.current = null;
    if (tool === "crop") {
      const rect = clampRect(d.start, p, sizeAfterOps({ width: bitmap.width, height: bitmap.height }, state.ops));
      if (rect.width >= 4 && rect.height >= 4) addOp({ kind: "crop", rect });
      else renderOps(bitmap, state.ops, canvas);
      return;
    }
    const op = tempOpFor(d, p);
    if (op) addOp(op);
  };

  const commitText = () => {
    if (!textDraft) return;
    const value = textDraft.value.trim();
    if (value) {
      addOp({
        kind: "draw", tool: "text", points: [textDraft.at], text: value, color, strokeWidth,
        fontSize: Math.max(16, strokeWidth * 5),
      });
    }
    setTextDraft(null);
  };

  const doSave = async (targetPath: string, openAfter: boolean) => {
    if (!vaultAdapter || !bitmap) return;
    setBusy(true);
    try {
      const target = document.createElement("canvas");
      renderOps(bitmap, state.ops, target);
      let out = target;
      const mime = imageMimeType(targetPath);
      if (mime === "image/jpeg") {
        // JPEG has no alpha — flatten onto white before encoding.
        const flat = document.createElement("canvas");
        flat.width = target.width;
        flat.height = target.height;
        const ctx = flat.getContext("2d");
        if (ctx) {
          // Alpha-flatten background: this is DATA baked into the saved JPEG
          // pixels (JPEG has no alpha channel), a format necessity — not a UI
          // color choice — so it stays a literal.
          ctx.fillStyle = "#ffffff";
          ctx.fillRect(0, 0, flat.width, flat.height);
          ctx.drawImage(target, 0, 0);
          out = flat;
        }
      }
      await saveCanvasToVault(vaultAdapter, targetPath, out, mime, mime === "image/jpeg" ? 0.92 : undefined);
      if (indexer) await applyIndexChanges(indexer, { added: [targetPath] });
      triggerFileTreeUpdate();
      notifyFileOps([{ type: "create", path: targetPath }]);
      if (targetPath === path) {
        const blob = await loadImageBlob(vaultAdapter, path);
        const url = URL.createObjectURL(blob);
        setObjectUrl((prev) => {
          if (prev) URL.revokeObjectURL(prev);
          return url;
        });
        setByteSize(blob.size);
        const bmp = await createImageBitmap(blob);
        setBitmap(bmp);
        setState(emptyEditorState());
        setEditing(false);
      } else if (openAfter) {
        onOpenPath?.(targetPath, true);
      }
      setSaveAsName(null);
    } catch (e) {
      console.error("[ImageViewer] saving failed", e);
      setError(String(e));
    } finally {
      setBusy(false);
    }
  };

  const confirmSaveAs = async () => {
    if (!vaultAdapter || saveAsName == null) return;
    const name = saveAsName.trim();
    if (!name) return;
    const dir = path.includes("/") ? path.slice(0, path.lastIndexOf("/") + 1) : "";
    const targetPath = dir + name;
    if (await vaultAdapter.exists(targetPath)) {
      toast.error(t("dialogs.alreadyExistsMsg"));
      return;
    }
    await doSave(targetPath, true);
  };

  const zoomBy = (dir: 1 | -1) => {
    setZoom((prev) => {
      const cur = prev === "fit" ? 1 : prev;
      const idx = ZOOM_STEPS.findIndex((z) => z >= cur - 0.001);
      const next = ZOOM_STEPS[Math.min(ZOOM_STEPS.length - 1, Math.max(0, (idx === -1 ? ZOOM_STEPS.length - 1 : idx) + dir))];
      return next;
    });
  };

  const startResize = () => {
    if (!currentSize) return;
    setResizeDraft({ width: String(currentSize.width), height: String(currentSize.height), keepRatio: true });
  };

  const applyResize = () => {
    if (!resizeDraft || !currentSize) return;
    const w = Math.round(Number(resizeDraft.width));
    const h = Math.round(Number(resizeDraft.height));
    if (!Number.isFinite(w) || !Number.isFinite(h) || w < 1 || h < 1 || w > 20000 || h > 20000) return;
    if (w !== currentSize.width || h !== currentSize.height) addOp({ kind: "resize", width: w, height: h });
    setResizeDraft(null);
  };

  const onResizeField = (field: "width" | "height", value: string) => {
    setResizeDraft((prev) => {
      if (!prev || !currentSize) return prev;
      const next = { ...prev, [field]: value };
      const n = Number(value);
      if (prev.keepRatio && Number.isFinite(n) && n > 0) {
        const ratio = currentSize.width / currentSize.height;
        if (field === "width") next.height = String(Math.max(1, Math.round(n / ratio)));
        else next.width = String(Math.max(1, Math.round(n * ratio)));
      }
      return next;
    });
  };

  const drawTools: { id: Tool; icon: React.ReactNode; label: string }[] = [
    { id: "select", icon: <MousePointer2 size={ICON.ui} />, label: t("imageViewer.toolSelect") },
    { id: "crop", icon: <Crop size={ICON.ui} />, label: t("imageViewer.toolCrop") },
    { id: "pen", icon: <PenLine size={ICON.ui} />, label: t("imageViewer.toolPen") },
    { id: "arrow", icon: <ArrowUpRight size={ICON.ui} />, label: t("imageViewer.toolArrow") },
    { id: "rect", icon: <Square size={ICON.ui} />, label: t("imageViewer.toolRect") },
    { id: "text", icon: <Type size={ICON.ui} />, label: t("imageViewer.toolText") },
  ];

  const cssZoom = zoom === "fit" ? null : zoom;

  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden", background: "var(--bg-primary)" }}>
      {/* Toolbar */}
      <div style={{ padding: "0.5rem 0.75rem", borderBottom: "1px solid var(--border-color)", display: "flex", alignItems: "center", flexWrap: "wrap", gap: "4px" }}>
        <button type="button" className="pv-iconbtn" onClick={() => zoomBy(-1)} data-tip={t("imageViewer.zoomOut")} aria-label={t("imageViewer.zoomOut")}><ZoomOut size={ICON.ui} /></button>
        <span style={{ fontSize: "var(--text-sm)", color: "var(--text-muted)", minWidth: 40, textAlign: "center", fontVariantNumeric: "tabular-nums" }}>
          {zoom === "fit" ? t("imageViewer.zoomFit") : `${Math.round(zoom * 100)}%`}
        </span>
        <button type="button" className="pv-iconbtn" onClick={() => zoomBy(1)} data-tip={t("imageViewer.zoomIn")} aria-label={t("imageViewer.zoomIn")}><ZoomIn size={ICON.ui} /></button>
        <button
          type="button"
          className="pv-iconbtn"
          onClick={() => setZoom("fit")}
          data-tip={t("imageViewer.zoomFit")}
          aria-label={t("imageViewer.zoomFit")}
          style={{ background: zoom === "fit" ? "var(--bg-active)" : "transparent", color: zoom === "fit" ? "var(--accent-color)" : "var(--text-muted)" }}
        ><Maximize size={ICON.ui} /></button>
        <button
          type="button"
          className="pv-btn pv-btn--ghost"
          onClick={() => setZoom(1)}
          data-tip={t("imageViewer.zoomActual")}
          aria-label={t("imageViewer.zoomActual")}
          style={{ background: zoom === 1 ? "var(--bg-active)" : "transparent", color: zoom === 1 ? "var(--accent-color)" : "var(--text-muted)" }}
        >1:1</button>

        {editing && (
          <>
            <div style={{ width: 1, alignSelf: "stretch", background: "var(--border-color)", margin: "0 4px" }} />
            {drawTools.map((d) => (
              <button
                key={d.id}
                type="button"
                className="pv-iconbtn"
                onClick={() => setTool(d.id)}
                data-tip={d.label}
                aria-label={d.label}
                style={{ background: tool === d.id ? "var(--bg-active)" : "transparent", color: tool === d.id ? "var(--accent-color)" : "var(--text-muted)" }}
              >{d.icon}</button>
            ))}
            <div style={{ width: 1, alignSelf: "stretch", background: "var(--border-color)", margin: "0 4px" }} />
            <button type="button" className="pv-iconbtn" onClick={() => addOp({ kind: "rotate90", dir: -1 })} data-tip={t("imageViewer.rotateLeft")} aria-label={t("imageViewer.rotateLeft")}><RotateCcw size={ICON.ui} /></button>
            <button type="button" className="pv-iconbtn" onClick={() => addOp({ kind: "rotate90", dir: 1 })} data-tip={t("imageViewer.rotateRight")} aria-label={t("imageViewer.rotateRight")}><RotateCw size={ICON.ui} /></button>
            <button type="button" className="pv-iconbtn" onClick={() => addOp({ kind: "flip", axis: "h" })} data-tip={t("imageViewer.flipH")} aria-label={t("imageViewer.flipH")}><FlipHorizontal2 size={ICON.ui} /></button>
            <button type="button" className="pv-iconbtn" onClick={() => addOp({ kind: "flip", axis: "v" })} data-tip={t("imageViewer.flipV")} aria-label={t("imageViewer.flipV")}><FlipVertical2 size={ICON.ui} /></button>
            <button type="button" className="pv-iconbtn" onClick={startResize} data-tip={t("imageViewer.resize")} aria-label={t("imageViewer.resize")}><Scaling size={ICON.ui} /></button>
            <input
              type="color"
              value={color}
              onChange={(e) => setColor(e.target.value)}
              data-tip={t("imageViewer.color")}
              aria-label={t("imageViewer.color")}
              style={{ width: 26, height: 26, padding: 0, border: "1px solid var(--border-color)", borderRadius: "var(--radius-sm)", background: "transparent", cursor: "pointer" }}
            />
            <select
              value={strokeWidth}
              onChange={(e) => setStrokeWidth(Number(e.target.value))}
              data-tip={t("imageViewer.strokeWidth")}
              aria-label={t("imageViewer.strokeWidth")}
              className="pv-field pv-field--select"
              style={{ height: 26 }}
            >
              {[2, 4, 6, 10].map((w) => <option key={w} value={w}>{w} px</option>)}
            </select>
            <button type="button" className="pv-iconbtn" style={{ opacity: state.ops.length ? 1 : 0.4 }} onClick={() => setState((s) => undoOp(s))} data-tip={t("imageViewer.undo")} aria-label={t("imageViewer.undo")}><Undo2 size={ICON.ui} /></button>
            <button type="button" className="pv-iconbtn" style={{ opacity: state.redo.length ? 1 : 0.4 }} onClick={() => setState((s) => redoOp(s))} data-tip={t("imageViewer.redo")} aria-label={t("imageViewer.redo")}><Redo2 size={ICON.ui} /></button>
          </>
        )}

        <div style={{ marginLeft: "auto" }} />
        {editing ? (
          <>
            <button type="button" className="pv-btn pv-btn--ghost" onClick={() => void cancelEditing()} disabled={busy}>{t("common.cancel")}</button>
            <button type="button" className="pv-btn pv-btn--secondary" onClick={() => setSaveAsName(copyCandidate(fileName, t("fileTree.copySuffix"), 1))} disabled={busy}>{t("imageViewer.saveAs")}</button>
            <button type="button" className="pv-btn pv-btn--primary" onClick={() => void doSave(path, false)} disabled={busy || state.ops.length === 0} style={busy || state.ops.length === 0 ? { opacity: 0.5 } : undefined}>{t("imageViewer.save")}</button>
          </>
        ) : (
          <>
            {editable && bitmap && (
              <button type="button" className="pv-btn pv-btn--secondary" onClick={() => { setEditing(true); setTool("pen"); }}>{t("imageViewer.edit")}</button>
            )}
            {onToggleBookmark && (
              <button type="button" className="pv-iconbtn" onClick={onToggleBookmark} data-tip={isBookmarked ? t("editor.removeBookmark") : t("editor.addBookmark")} aria-label={isBookmarked ? t("editor.removeBookmark") : t("editor.addBookmark")}>
                <Bookmark size={ICON.ui} fill={isBookmarked ? "currentColor" : "none"} />
              </button>
            )}
            {onDelete && (
              <button type="button" className="pv-iconbtn" onClick={onDelete} data-tip={t("common.delete")} aria-label={t("common.delete")}><Trash2 size={ICON.ui} /></button>
            )}
            <SplitButton onSplit={onSplit} activeDirection={activeSplitDirection} />
          </>
        )}
      </div>

      {/* Content */}
      <div className="custom-scrollbar" data-testid="image-viewer" style={{ flex: 1, overflow: "auto", display: "flex", padding: "1rem" }}>
        {error && <div style={{ margin: "auto", color: "var(--error-text)", fontSize: "var(--text-md)" }}>{error}</div>}
        {!error && !editing && objectUrl && (
          <img
            src={objectUrl}
            alt={fileName}
            draggable={false}
            style={cssZoom == null
              ? { margin: "auto", maxWidth: "100%", maxHeight: "100%", objectFit: "contain" }
              : { margin: "auto", width: bitmap ? bitmap.width * cssZoom : undefined, maxWidth: "none" }}
          />
        )}
        {!error && editing && bitmap && (
          <div style={{ position: "relative", maxWidth: "100%", margin: "auto" }}>
            <canvas
              ref={canvasRef}
              style={{ maxWidth: "100%", display: "block", cursor: tool === "select" ? "default" : "crosshair", touchAction: "none", boxShadow: "var(--shadow-2)" }}
              onPointerDown={onCanvasPointerDown}
              onPointerMove={onCanvasPointerMove}
              onPointerUp={onCanvasPointerUp}
              onPointerCancel={() => { dragRef.current = null; if (bitmap && canvasRef.current) renderOps(bitmap, state.ops, canvasRef.current); }}
            />
            {textDraft && currentSize && (
              <input
                autoFocus
                value={textDraft.value}
                placeholder={t("imageViewer.textPlaceholder")}
                onChange={(e) => setTextDraft((prev) => (prev ? { ...prev, value: e.target.value } : prev))}
                onKeyDown={(e) => {
                  if (e.key === "Enter") commitText();
                  if (e.key === "Escape") setTextDraft(null);
                }}
                onBlur={commitText}
                className="pv-field"
                style={{
                  position: "absolute",
                  left: `${(textDraft.at.x / currentSize.width) * 100}%`,
                  top: `${(textDraft.at.y / currentSize.height) * 100}%`,
                  width: "auto",
                  minWidth: 120,
                }}
              />
            )}
          </div>
        )}
      </div>

      {/* Info bar */}
      <div style={{ padding: "4px 0.75rem", borderTop: "1px solid var(--border-color)", display: "flex", alignItems: "center", gap: "0.75rem", fontSize: "var(--text-sm)", color: "var(--text-faint)" }}>
        <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{fileName}</span>
        {currentSize && <span style={{ flexShrink: 0, fontVariantNumeric: "tabular-nums" }}>{currentSize.width}×{currentSize.height} px</span>}
        {byteSize > 0 && <span style={{ flexShrink: 0, fontVariantNumeric: "tabular-nums" }}>{(byteSize / 1024).toFixed(byteSize >= 102400 ? 0 : 1)} KB</span>}
        {!editable && <span style={{ flexShrink: 0 }}>{t("imageViewer.viewOnly")}</span>}
      </div>

      {/* Resize dialog */}
      {resizeDraft && (
        <Modal
          onClose={() => setResizeDraft(null)}
          title={t("imageViewer.resize")}
          size="sm"
          footer={
            <>
              <button type="button" className="pv-btn pv-btn--ghost" onClick={() => setResizeDraft(null)}>{t("common.cancel")}</button>
              <button type="button" className="pv-btn pv-btn--primary" onClick={applyResize}>{t("common.save")}</button>
            </>
          }
        >
          <div className="pv-modal-row">
            <label className="pv-modal-label">{t("imageViewer.widthLabel")}</label>
            <input className="pv-field" style={{ width: 110, boxSizing: "border-box" }} inputMode="numeric" value={resizeDraft.width} aria-label={t("imageViewer.widthLabel")} onChange={(e) => onResizeField("width", e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") applyResize(); }} />
          </div>
          <div className="pv-modal-row">
            <label className="pv-modal-label">{t("imageViewer.heightLabel")}</label>
            <input className="pv-field" style={{ width: 110, boxSizing: "border-box" }} inputMode="numeric" value={resizeDraft.height} aria-label={t("imageViewer.heightLabel")} onChange={(e) => onResizeField("height", e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") applyResize(); }} />
          </div>
          <label className="pv-modal-check">
            <input type="checkbox" checked={resizeDraft.keepRatio} onChange={(e) => setResizeDraft((prev) => (prev ? { ...prev, keepRatio: e.target.checked } : prev))} />
            <span>{t("imageViewer.keepRatio")}</span>
          </label>
        </Modal>
      )}

      {/* Save-as dialog */}
      {saveAsName != null && (
        <Modal
          onClose={() => setSaveAsName(null)}
          title={t("imageViewer.saveAsTitle")}
          size="sm"
          initialFocusRef={saveAsInputRef}
          footer={
            <>
              <button type="button" className="pv-btn pv-btn--ghost" onClick={() => setSaveAsName(null)}>{t("common.cancel")}</button>
              <button type="button" className="pv-btn pv-btn--primary" onClick={() => void confirmSaveAs()} disabled={busy}>{t("common.save")}</button>
            </>
          }
        >
          <div className="pv-modal-row">
            <label className="pv-modal-label">{t("imageViewer.fileNameLabel")}</label>
            <input
              ref={saveAsInputRef}
              className="pv-field"
              style={{ flex: 1, minWidth: 0, boxSizing: "border-box" }}
              value={saveAsName}
              aria-label={t("imageViewer.fileNameLabel")}
              onChange={(e) => setSaveAsName(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") void confirmSaveAs(); if (e.key === "Escape") setSaveAsName(null); }}
            />
          </div>
        </Modal>
      )}
    </div>
  );
}
