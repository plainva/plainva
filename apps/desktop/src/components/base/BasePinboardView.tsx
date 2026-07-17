import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Check, Columns2, ExternalLink, Pin, PinOff, Tags, Trash2 } from "lucide-react";
import type { NoteCardData } from "@plainva/core";
import {
  DocIcon,
  EmptyState,
  MenuItem,
  MenuSeparator,
  MenuSurface,
  NoteCardBody,
  PALETTE_SWATCH,
  applyPin,
  applyUnpin,
  chipClass,
  distributeCards,
  dropSlotAt,
  filterCardPaths,
  isRenderableDocIcon,
  loadImageBlob,
  noteDisplayName,
  orderCards,
  parseNoteCard,
  parseSourceClause,
  pinboardColumnCount,
  resolveVaultRelative,
  spliceIntoSequence,
  splitMultiValue,
  toast,
  toggleTaskAtIndex,
  type ParsedNoteCard,
  type PinboardDropSlot,
} from "@plainva/ui";
import { setFrontmatterPath, deleteFrontmatterPath, readFrontmatterPath } from "@plainva/core";
import type { BaseCells } from "./useBaseCells";
import { useVault } from "../../contexts/VaultContext";
import { applyIndexChanges } from "../../services/fileActions";
import { confirmDeletion } from "../../services/deleteConfirm";
import { notifyFileOps } from "../../services/indexMdAutoUpdate";

/**
 * Pinboard view (plan Pinboard P3): a Keep-style masonry of note cards.
 *
 * - Cards render the note BODY through the shared parser/renderer (E6); the
 *   data comes from the FTS index via getCardData (P2, no per-card file I/O).
 * - Sections "Angepinnt"/"Weitere" (pinned only when pins exist, Keep).
 * - Unarranged cards float on top by ctime (E5); a drag splices into the full
 *   sequence (D3) and persists through onPatchView. With an active sort rule
 *   the rule wins and dragging is disabled (§3).
 * - Interaction (D6): the card is the single click target (peek); checkboxes
 *   are the only interactive body elements. Pin toggles on hover; everything
 *   else lives in the context menu.
 */

const CARD_WIDTH = 256;
const GAP = 12;
const DRAG_THRESHOLD_PX = 5;

/** Palette offered in the card context menu; writes plainva.color (E7 — the
 * note's global header tint, deliberately shared with the editor header). */
const CARD_COLORS = Object.entries(PALETTE_SWATCH).filter(([name]) => name !== "gray");

interface CardVM {
  path: string;
  mtime: number;
  parsed: ParsedNoteCard;
  title: string | null;
  data: NoteCardData;
  /** The query row (label property values live here in property mode). */
  row: any;
}

function CardImage({ target, alt, notePath }: { target: string; alt: string; notePath: string }) {
  const { vaultAdapter } = useVault();
  const [url, setUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    if (!vaultAdapter) return;
    let alive = true;
    let objectUrl: string | null = null;
    setUrl(null);
    setFailed(false);
    const noteDir = notePath.includes("/") ? notePath.slice(0, notePath.lastIndexOf("/")) : "";
    const candidates = [resolveVaultRelative(target), noteDir ? resolveVaultRelative(`${noteDir}/${target}`) : null]
      .filter((p): p is string => !!p);
    void (async () => {
      for (const p of candidates) {
        try {
          const blob = await loadImageBlob(vaultAdapter, p);
          if (!alive) return;
          objectUrl = URL.createObjectURL(blob);
          setUrl(objectUrl);
          return;
        } catch {
          /* try the next candidate */
        }
      }
      if (alive) setFailed(true);
    })();
    return () => {
      alive = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [vaultAdapter, target, notePath]);
  if (failed) return <span style={{ color: "var(--text-muted)", fontStyle: "italic", fontSize: "var(--text-xs)" }}>{alt || target}</span>;
  if (!url) return <span aria-hidden="true" style={{ display: "block", height: 48 }} />;
  return <img src={url} alt={alt} style={{ maxWidth: "100%", borderRadius: "var(--radius-xs)", display: "block" }} />;
}

export function BasePinboardView({
  dbData,
  dbConfig,
  activeView,
  visibleColumns,
  cells,
  onPatchView,
  onOpenNote,
  onOpenInSplit,
  onQuickCapture,
  embedded,
}: {
  dbData: any[];
  /** Full config (sources for the source-tag exclusion, columns for label options). */
  dbConfig: any;
  /** The active view object (pinboardOrder/pinboardPinned/sort live here). */
  activeView: any;
  /** Enabled properties of the view — rendered on the cards (maintainer 2026-07-17). */
  visibleColumns?: string[];
  /** Shared cell helpers (typed display + labels) for the property lines. */
  cells?: BaseCells;
  onPatchView: (patch: Record<string, unknown>) => void;
  onOpenNote: (path: string, ev?: { ctrlKey?: boolean; metaKey?: boolean }) => void;
  onOpenInSplit?: (path: string) => void;
  /** Quick capture (P4/title popup): resolves true when the note was created. */
  onQuickCapture?: (input: { title: string; text: string }) => Promise<boolean>;
  /** Embedded boards are read-mostly (D5): no drag reorder, no capture. */
  embedded?: boolean;
}) {
  const { t } = useTranslation();
  const { vaultAdapter, queryService, indexer, triggerFileTreeUpdate, syncWorker } = useVault();

  // ── Card data (body/tags/ctime) from the FTS index (P2) ──
  const [cardData, setCardData] = useState<Record<string, NoteCardData>>({});
  const paths = useMemo(() => dbData.map((r) => String(r["file.path"] ?? "")).filter(Boolean), [dbData]);
  useEffect(() => {
    if (!queryService || paths.length === 0) {
      setCardData({});
      return;
    }
    let alive = true;
    queryService.getCardData(paths).then((d) => { if (alive) setCardData(d); }).catch(() => {});
    return () => { alive = false; };
  }, [queryService, paths]);

  // ── View model: parse each card once per content change ──
  const cards = useMemo(() => {
    const map = new Map<string, CardVM>();
    for (const row of dbData) {
      const path = String(row["file.path"] ?? "");
      if (!path) continue;
      const data = cardData[path] ?? { content: "", tags: [], ctime: null };
      const parsed = parseNoteCard(data.content, { dropLeadingH1: true });
      const title = parsed.fmTitle ?? parsed.leadingH1 ?? null; // titleless like Keep otherwise
      map.set(path, { path, mtime: Number(row["file.mtime"] ?? 0), parsed, title, data, row });
    }
    return map;
  }, [dbData, cardData]);

  // ── Sections: manual order, or the view's sort rule when one is set (§3) ──
  const hasSort = Array.isArray(activeView?.sort) && activeView.sort.length > 0;
  const order: string[] | undefined = Array.isArray(activeView?.pinboardOrder) ? activeView.pinboardOrder : undefined;
  const pinnedList: string[] | undefined = Array.isArray(activeView?.pinboardPinned) ? activeView.pinboardPinned : undefined;
  const sections = useMemo(() => {
    if (hasSort) {
      const pinnedSet = new Set(pinnedList ?? []);
      return {
        pinned: paths.filter((p) => pinnedSet.has(p)),
        unpinned: paths.filter((p) => !pinnedSet.has(p)),
      };
    }
    const rows = paths.map((p) => ({ path: p, ctime: cards.get(p)?.data.ctime ?? null, mtime: cards.get(p)?.mtime ?? 0 }));
    return orderCards(rows, order, pinnedList);
  }, [hasSort, paths, cards, order, pinnedList]);

  // ── Labels & chip bar (P4): tags (default) or a multiselect property ──
  const filterByRaw = typeof activeView?.pinboardFilterBy === "string" ? activeView.pinboardFilterBy : "tags";
  const labelProp = filterByRaw !== "tags" ? filterByRaw.replace(/^note\./, "") : null;
  // Tags that ARE the board's source sit on every card — useless as chips.
  const sourceTags = useMemo(() => {
    const set = new Set<string>();
    const scan = (list: any[]) => {
      for (const f of Array.isArray(list) ? list : []) {
        const s = parseSourceClause(f);
        if (s?.type === "tag") set.add(s.value);
      }
    };
    scan(dbConfig?.filters?.and);
    scan(dbConfig?.filters?.or);
    return set;
  }, [dbConfig]);
  const labelsByPath = useMemo(() => {
    const m = new Map<string, string[]>();
    for (const [p, vm] of cards) {
      if (labelProp) {
        m.set(p, splitMultiValue(vm.row?.[labelProp]).map(String));
      } else {
        m.set(p, vm.data.tags.filter((t) => !sourceTags.has(t)));
      }
    }
    return m;
  }, [cards, labelProp, sourceTags]);
  const [selectedLabels, setSelectedLabels] = useState<string[]>([]);
  const labelOptions: { value: string; color?: string }[] = useMemo(
    () => (labelProp && Array.isArray(dbConfig?.columns?.[labelProp]?.options) ? dbConfig.columns[labelProp].options : []),
    [dbConfig, labelProp],
  );
  const chipEntries = useMemo(() => {
    const counts = new Map<string, number>();
    for (const labels of labelsByPath.values()) for (const l of labels) counts.set(l, (counts.get(l) ?? 0) + 1);
    // Curated options keep their configured order (property mode), the rest
    // sorts by frequency then name.
    const curated = labelOptions.map((o) => o.value).filter((v) => counts.has(v));
    const rest = [...counts.keys()].filter((v) => !curated.includes(v)).sort((a, b) => (counts.get(b)! - counts.get(a)!) || a.localeCompare(b));
    return [...curated, ...rest].map((value) => ({ value, count: counts.get(value) ?? 0, color: labelOptions.find((o) => o.value === value)?.color }));
  }, [labelsByPath, labelOptions]);
  const visibleSections = useMemo(
    () => ({
      pinned: filterCardPaths(sections.pinned, labelsByPath, selectedLabels),
      unpinned: filterCardPaths(sections.unpinned, labelsByPath, selectedLabels),
    }),
    [sections, labelsByPath, selectedLabels],
  );

  // ── Masonry: container width -> column count; card heights via ONE observer ──
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [containerWidth, setContainerWidth] = useState(0);
  useEffect(() => {
    const el = containerRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver((entries) => {
      for (const e of entries) setContainerWidth(e.contentRect.width);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  // Card heights: ONE ResizeObserver, measurements collected in a ref and
  // flushed into state once per frame — measurement never feeds back into
  // itself synchronously (the mathMermaidLive observer lesson), and render
  // only ever reads the state map (react-compiler ref rules).
  const [heights, setHeights] = useState<ReadonlyMap<string, number>>(new Map());
  const heightsRef = useRef<Map<string, number>>(new Map());
  const rafRef = useRef<number | null>(null);
  const cardObserverRef = useRef<ResizeObserver | null>(null);
  const cardElsRef = useRef<Map<string, HTMLElement>>(new Map());
  useEffect(() => {
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver((entries) => {
      let changed = false;
      for (const e of entries) {
        const path = (e.target as HTMLElement).dataset.pinboardPath;
        if (!path) continue;
        const h = Math.round(e.contentRect.height);
        if (heightsRef.current.get(path) !== h) {
          heightsRef.current.set(path, h);
          changed = true;
        }
      }
      if (changed && rafRef.current === null) {
        rafRef.current = requestAnimationFrame(() => {
          rafRef.current = null;
          setHeights(new Map(heightsRef.current));
        });
      }
    });
    cardObserverRef.current = observer;
    // Cards mounted before this effect ran (first commit) join now.
    for (const el of cardElsRef.current.values()) observer.observe(el);
    return () => {
      observer.disconnect();
      cardObserverRef.current = null;
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    };
  }, []);
  const registerCard = useCallback((path: string) => (el: HTMLElement | null) => {
    const prev = cardElsRef.current.get(path);
    if (prev && prev !== el) cardObserverRef.current?.unobserve(prev);
    if (el) {
      cardElsRef.current.set(path, el);
      cardObserverRef.current?.observe(el);
    } else {
      cardElsRef.current.delete(path);
    }
  }, []);

  const columnCount = pinboardColumnCount(containerWidth, CARD_WIDTH, GAP);
  // The chip-FILTERED sequences render; ordering/drag splice into the full
  // sections so hidden cards keep their positions (D3).
  const columns = useMemo(
    () => ({
      pinned: distributeCards(visibleSections.pinned, heights, columnCount),
      unpinned: distributeCards(visibleSections.unpinned, heights, columnCount),
    }),
    [visibleSections, columnCount, heights],
  );

  // ── Writes: every card mutation re-reads the file, writes through the
  //    adapter chain, re-indexes the path and pings the board channel ──
  const afterCardWrite = useCallback(async (path: string, metaChanged: boolean) => {
    if (indexer) await applyIndexChanges(indexer, { added: [path] }).catch(() => {});
    window.dispatchEvent(new CustomEvent("plainva-note-saved", { detail: { path } }));
    if (metaChanged) triggerFileTreeUpdate([path]);
  }, [indexer, triggerFileTreeUpdate]);

  const handleToggleTask = useCallback(async (path: string, ordinal: number, checked: boolean) => {
    if (!vaultAdapter) return;
    try {
      const fresh = await vaultAdapter.readTextFile(path);
      const res = toggleTaskAtIndex(fresh, ordinal, checked);
      if (!res.changed) return;
      await vaultAdapter.writeTextFile(path, res.content);
      await afterCardWrite(path, false); // pure body change — no tree bump (fix C)
    } catch (e: any) {
      toast.error(String(e?.message ?? e));
    }
  }, [vaultAdapter, afterCardWrite]);

  const handleSetColor = useCallback(async (path: string, hex: string | null) => {
    if (!vaultAdapter) return;
    try {
      const fresh = await vaultAdapter.readTextFile(path);
      const next = hex ? setFrontmatterPath(fresh, ["plainva", "header_color"], hex) : deleteFrontmatterPath(fresh, ["plainva", "header_color"]);
      if (next !== fresh) {
        await vaultAdapter.writeTextFile(path, next);
        await afterCardWrite(path, true); // header tint mirrors into tree/tabs
      }
    } catch (e: any) {
      toast.error(String(e?.message ?? e));
    }
  }, [vaultAdapter, afterCardWrite]);

  const presentSet = useMemo(() => new Set(paths), [paths]);
  const persistSections = useCallback((next: { order?: string[]; pinned?: string[] }) => {
    const patch: Record<string, unknown> = {};
    if (next.order) patch.pinboardOrder = next.order.length > 0 ? next.order : undefined;
    if (next.pinned) patch.pinboardPinned = next.pinned.length > 0 ? next.pinned : undefined;
    onPatchView(patch);
  }, [onPatchView]);

  const handlePinToggle = useCallback((path: string, pin: boolean) => {
    const next = pin ? applyPin(order, pinnedList, path, presentSet) : applyUnpin(order, pinnedList, path, presentSet);
    persistSections(next);
  }, [order, pinnedList, presentSet, persistSections]);

  const handleDelete = useCallback(async (path: string) => {
    if (!vaultAdapter || !indexer) return;
    const ok = await confirmDeletion({
      t,
      single: { name: noteDisplayName(path.split("/").pop() ?? path), isFolder: false },
      fileCount: 1,
      vaultFileCount: 0, // a single file never triggers the bulk threshold
      syncActive: !!syncWorker,
    });
    if (!ok) return;
    syncWorker?.noteUserInitiatedDeletion([path]);
    try {
      await vaultAdapter.deleteItem(path, true);
      await applyIndexChanges(indexer, { removed: [path] });
      triggerFileTreeUpdate();
      notifyFileOps([{ type: "delete", path, isFolder: false }]);
    } catch (err: any) {
      toast.error(t("dialogs.deleteErrorMsg", { error: err?.message ?? String(err) }));
    }
  }, [vaultAdapter, indexer, syncWorker, t, triggerFileTreeUpdate]);

  // ── Label editing (P4): tags mode writes the frontmatter tags list, property
  //    mode the multiselect value — both through the surgical updater and the
  //    adapter chain. Inline #tags show but cannot be removed here (they live
  //    in the text); the popover disables them.
  const [labelEdit, setLabelEdit] = useState<{ path: string; x: number; y: number; fmTags: string[] | null } | null>(null);
  const [labelQuery, setLabelQuery] = useState("");
  const openLabelEditor = useCallback(async (path: string, at: { x: number; y: number }) => {
    setLabelQuery("");
    if (labelProp) {
      setLabelEdit({ path, x: at.x, y: at.y, fmTags: null });
      return;
    }
    let fmTags: string[] = [];
    try {
      const fresh = vaultAdapter ? await vaultAdapter.readTextFile(path) : "";
      const raw = readFrontmatterPath(fresh, ["tags"]);
      fmTags = Array.isArray(raw) ? raw.map(String) : typeof raw === "string" && raw ? [raw] : [];
    } catch {
      /* missing file — the self-heal drops the card on the next query */
    }
    setLabelEdit({ path, x: at.x, y: at.y, fmTags });
  }, [labelProp, vaultAdapter]);

  const toggleLabel = useCallback(async (path: string, label: string, add: boolean) => {
    if (!vaultAdapter) return;
    try {
      const fresh = await vaultAdapter.readTextFile(path);
      let next: string;
      if (labelProp) {
        const current = splitMultiValue(readFrontmatterPath(fresh, [labelProp])).map(String);
        const list = add ? (current.includes(label) ? current : [...current, label]) : current.filter((v) => v !== label);
        next = list.length > 0 ? setFrontmatterPath(fresh, [labelProp], list) : deleteFrontmatterPath(fresh, [labelProp]);
      } else {
        const raw = readFrontmatterPath(fresh, ["tags"]);
        const current = Array.isArray(raw) ? raw.map(String) : typeof raw === "string" && raw ? [raw] : [];
        const list = add ? (current.includes(label) ? current : [...current, label]) : current.filter((v) => v !== label);
        next = list.length > 0 ? setFrontmatterPath(fresh, ["tags"], list) : deleteFrontmatterPath(fresh, ["tags"]);
        setLabelEdit((s) => (s && s.path === path ? { ...s, fmTags: list } : s));
      }
      if (next !== fresh) {
        await vaultAdapter.writeTextFile(path, next);
        await afterCardWrite(path, true); // tags/properties are index metadata
      }
    } catch (e: any) {
      toast.error(String(e?.message ?? e));
    }
  }, [vaultAdapter, labelProp, afterCardWrite]);

  // ── Drag reorder (splice semantics, D3); disabled when a sort rule is set ──
  const canDrag = !hasSort && !embedded;
  const [dragPath, setDragPath] = useState<string | null>(null);
  const [dropSlot, setDropSlot] = useState<{ section: "pinned" | "unpinned"; slot: PinboardDropSlot } | null>(null);
  // The move/up listeners of a drag close over the sections of the pointerdown
  // render — fine, nothing mutates the arrangement mid-drag.
  const slotAt = useCallback((x: number, y: number): { section: "pinned" | "unpinned"; slot: PinboardDropSlot } | null => {
    for (const section of ["pinned", "unpinned"] as const) {
      const seq = sections[section];
      const rects = seq
        .map((p) => {
          const el = cardElsRef.current.get(p);
          if (!el) return null;
          const r = el.getBoundingClientRect();
          return { path: p, top: r.top, bottom: r.bottom, left: r.left, right: r.right };
        })
        .filter((r): r is NonNullable<typeof r> => !!r);
      const hit = rects.some((r) => x >= r.left && x <= r.right && y >= r.top && y <= r.bottom);
      if (hit) return { section, slot: dropSlotAt(rects, seq, x, y) };
    }
    return null;
  }, [sections]);

  const cardDragHandlers = (path: string, section: "pinned" | "unpinned") => ({
    onPointerDown: (e: React.PointerEvent) => {
      if (!canDrag || e.button !== 0) return;
      const target = e.target as HTMLElement | null;
      if (target && target.closest("input, textarea, select, button, a, [contenteditable='true']")) return;
      const d = { pointerId: e.pointerId, path, startX: e.clientX, startY: e.clientY, moved: false };
      let restoreUserSelect: (() => void) | null = null;
      const cleanup = () => {
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
        window.removeEventListener("pointercancel", onCancel);
        restoreUserSelect?.();
        setDragPath(null);
        setDropSlot(null);
      };
      const onMove = (ev: PointerEvent) => {
        if (ev.pointerId !== d.pointerId) return;
        if (!d.moved) {
          if (Math.hypot(ev.clientX - d.startX, ev.clientY - d.startY) < DRAG_THRESHOLD_PX) return;
          d.moved = true;
          setDragPath(d.path);
          const prev = document.body.style.userSelect;
          document.body.style.userSelect = "none";
          restoreUserSelect = () => { document.body.style.userSelect = prev; };
          window.getSelection()?.removeAllRanges();
        }
        const hit = slotAt(ev.clientX, ev.clientY);
        // Drags stay within their own section (v1): pin/unpin is the toggle.
        setDropSlot(hit && hit.section === section ? hit : null);
      };
      const onUp = (ev: PointerEvent) => {
        if (ev.pointerId !== d.pointerId) return;
        const moved = d.moved;
        const hit = moved ? slotAt(ev.clientX, ev.clientY) : null;
        cleanup();
        if (!moved) return; // plain click — open handlers run
        const suppress = (ce: MouseEvent) => { ce.preventDefault(); ce.stopPropagation(); };
        window.addEventListener("click", suppress, { capture: true, once: true });
        window.setTimeout(() => window.removeEventListener("click", suppress, { capture: true }), 0);
        if (!hit || hit.section !== section) return;
        const seq = sections[section];
        const next = spliceIntoSequence(seq, [d.path], hit.slot);
        persistSections(section === "pinned" ? { pinned: next } : { order: next });
      };
      const onCancel = (ev: PointerEvent) => { if (ev.pointerId === d.pointerId) cleanup(); };
      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
      window.addEventListener("pointercancel", onCancel);
    },
  });

  // ── Context menu ──
  const [menu, setMenu] = useState<{ x: number; y: number; path: string } | null>(null);

  // ── Quick capture (P4; Keep-style title popup 2026-07-17) ──
  const [captureOpen, setCaptureOpen] = useState(false);
  const [captureTitle, setCaptureTitle] = useState("");
  const [captureText, setCaptureText] = useState("");
  const [captureBusy, setCaptureBusy] = useState(false);
  const captureTextRef = useRef<HTMLTextAreaElement | null>(null);

  const submitCapture = () => {
    if (captureBusy || !onQuickCapture) return;
    const title = captureTitle.trim();
    const text = captureText;
    // Nothing typed — closing an empty popup is a no-op, not an error.
    if (!title && !text.trim()) {
      setCaptureOpen(false);
      return;
    }
    setCaptureBusy(true);
    void onQuickCapture({ title, text })
      .then((ok) => {
        if (ok) {
          setCaptureTitle("");
          setCaptureText("");
          setCaptureOpen(false);
        }
      })
      .finally(() => setCaptureBusy(false));
  };

  // ── Enabled view properties on the cards (maintainer 2026-07-17) ──
  const propCols = useMemo(() => {
    if (!visibleColumns || !cells) return [] as string[];
    const labelBare = labelProp ? labelProp.replace(/^note\./, "") : null;
    return visibleColumns.filter((c) => {
      if (c === "file.name") return false; // the card already IS the note
      const bare = c.replace(/^note\./, "");
      if (bare === "tags" && !labelProp) return false; // shown as label chips already
      if (labelBare && bare === labelBare) return false; // the active label property = the chips
      return true;
    });
  }, [visibleColumns, cells, labelProp]);

  const cardLabels = useMemo(
    () => ({
      table: t("pinboard.phTable", { defaultValue: "Tabelle" }),
      math: t("pinboard.phMath", { defaultValue: "Formel" }),
      embed: t("pinboard.phEmbed", { defaultValue: "Eingebetteter Inhalt" }),
    }),
    [t],
  );

  const renderCard = (path: string, section: "pinned" | "unpinned") => {
    const vm = cards.get(path);
    if (!vm) return null;
    const isPinned = section === "pinned";
    const tint = vm.parsed.color;
    const showDropBefore = dropSlot?.slot.kind === "before" && dropSlot.slot.path === path && dropSlot.section === section;
    return (
      <div
        key={path}
        ref={registerCard(path)}
        data-pinboard-path={path}
        data-pinboard-card="true"
        role="button"
        tabIndex={0}
        onClick={(e) => onOpenNote(path, { ctrlKey: e.ctrlKey, metaKey: e.metaKey })}
        onKeyDown={(e) => { if (e.key === "Enter") onOpenNote(path); }}
        onContextMenu={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setMenu({ x: e.clientX, y: e.clientY, path });
        }}
        {...cardDragHandlers(path, section)}
        className="pv-pinboard-card"
        style={{
          position: "relative",
          border: "1px solid var(--border-color)",
          borderRadius: "var(--radius-md)",
          background: tint
            ? `color-mix(in srgb, ${tint} calc(var(--pinboard-tint, 16) * 1%), var(--bg-secondary))`
            : "var(--bg-secondary)",
          padding: "10px 12px 8px",
          cursor: dragPath === path ? "grabbing" : "pointer",
          opacity: dragPath === path ? 0.45 : 1,
          boxShadow: showDropBefore ? "0 -2px 0 0 var(--accent-color)" : undefined,
          contentVisibility: "auto",
          containIntrinsicSize: "auto 180px",
        }}
      >
        {(vm.title || (vm.parsed.icon != null && isRenderableDocIcon(vm.parsed.icon))) && (
          <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 6, paddingRight: 22 }}>
            {vm.parsed.icon != null && isRenderableDocIcon(vm.parsed.icon) && <DocIcon icon={vm.parsed.icon} size={14} />}
            {vm.title && <div style={{ fontWeight: 600, fontSize: "var(--text-ui)", color: "var(--text-main)", overflowWrap: "anywhere" }}>{vm.title}</div>}
          </div>
        )}
        <div style={{ maxHeight: 300, overflow: "hidden", position: "relative" }}>
          <NoteCardBody
            blocks={vm.parsed.blocks}
            labels={cardLabels}
            onToggleTask={(ordinal, checked) => void handleToggleTask(path, ordinal, checked)}
            renderImage={(target, alt) => <CardImage target={target} alt={alt} notePath={path} />}
          />
          {vm.parsed.truncated && (
            <div aria-hidden="true" style={{ position: "absolute", left: 0, right: 0, bottom: 0, height: 28, background: "linear-gradient(transparent, var(--bg-secondary))" }} />
          )}
        </div>
        {/* Enabled view properties (maintainer 2026-07-17): the columns ticked
            under Configure -> Properties render as compact read-only lines,
            typed through the shared cell formatting (dates use the per-view
            date format). Empty values are skipped. */}
        {propCols.length > 0 && cells && (() => {
          const lines = propCols
            .map((col) => {
              let val = vm.row[col];
              if (val === undefined && col.startsWith("note.")) val = vm.row[col.slice(5)];
              const missing = val === undefined || val === null || val === "" || (Array.isArray(val) && val.length === 0);
              return missing ? null : { col, val };
            })
            .filter((x): x is { col: string; val: unknown } => x !== null);
          if (lines.length === 0) return null;
          return (
            <div data-pinboard-props="true" style={{ display: "flex", flexDirection: "column", gap: 3, marginTop: 8, paddingTop: 6, borderTop: "1px solid var(--border-color)" }}>
              {lines.map(({ col, val }) => (
                <div key={col} style={{ display: "flex", alignItems: "baseline", gap: 6, fontSize: "var(--text-xs)", minWidth: 0 }}>
                  <span style={{ color: "var(--text-muted)", flexShrink: 0 }}>{cells.columnLabel(col)}</span>
                  <span style={{ color: "var(--text-main)", overflowWrap: "anywhere", minWidth: 0 }}>{cells.formatValueForDisplay(val, col).displayVal}</span>
                </div>
              ))}
            </div>
          );
        })()}
        {(labelsByPath.get(path) ?? []).length > 0 && (
          <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginTop: 8 }}>
            {(labelsByPath.get(path) ?? []).slice(0, 4).map((l) => (
              <span key={l} className={labelProp ? chipClass(l, labelOptions.find((o) => o.value === l)?.color) : undefined} style={labelProp ? { fontSize: "var(--text-xs)" } : { fontSize: "var(--text-xs)", color: "var(--text-muted)", background: "var(--bg-primary)", border: "1px solid var(--border-color)", borderRadius: "var(--radius-pill)", padding: "0 7px" }}>
                {labelProp ? l : `#${l}`}
              </span>
            ))}
            {(labelsByPath.get(path) ?? []).length > 4 && (
              <span style={{ fontSize: "var(--text-xs)", color: "var(--text-faint)" }}>+{(labelsByPath.get(path) ?? []).length - 4}</span>
            )}
          </div>
        )}
        <button
          type="button"
          className="pv-pinboard-pin"
          aria-label={isPinned ? t("pinboard.unpin", { defaultValue: "Lösen" }) : t("pinboard.pin", { defaultValue: "Anpinnen" })}
          title={isPinned ? t("pinboard.unpin", { defaultValue: "Lösen" }) : t("pinboard.pin", { defaultValue: "Anpinnen" })}
          onClick={(e) => {
            e.stopPropagation();
            handlePinToggle(path, !isPinned);
          }}
          onPointerDown={(e) => e.stopPropagation()}
          style={{
            position: "absolute",
            top: 6,
            right: 6,
            display: "flex",
            padding: 3,
            border: "none",
            borderRadius: "var(--radius-xs)",
            background: "transparent",
            color: isPinned ? "var(--accent-color)" : "var(--text-muted)",
            cursor: "pointer",
            opacity: isPinned ? 1 : undefined,
          }}
        >
          {isPinned ? <PinOff size={14} /> : <Pin size={14} />}
        </button>
      </div>
    );
  };

  const renderSection = (section: "pinned" | "unpinned", cols: string[][]) => (
    <div style={{ display: "flex", gap: GAP, alignItems: "flex-start" }}>
      {cols.map((col, i) => (
        <div key={i} style={{ display: "flex", flexDirection: "column", gap: GAP, width: CARD_WIDTH, minWidth: 0, flexShrink: 0 }}>
          {col.map((p) => renderCard(p, section))}
        </div>
      ))}
      {/* End-of-section drop hint while dragging */}
      {dropSlot?.section === section && dropSlot.slot.kind === "end" && dragPath && (
        <div aria-hidden="true" style={{ width: 3, alignSelf: "stretch", background: "var(--accent-color)", borderRadius: "var(--radius-pill)" }} />
      )}
    </div>
  );

  const menuVm = menu ? cards.get(menu.path) : null;
  const menuPinned = menu ? sections.pinned.includes(menu.path) : false;
  const boardWidth = Math.min(containerWidth, columnCount * (CARD_WIDTH + GAP) - GAP);

  return (
    <div ref={containerRef} style={{ flex: 1, overflowY: "auto", padding: "1rem" }} title={hasSort && !embedded ? t("pinboard.sortActive", { defaultValue: "Sortierregel aktiv — manuelles Anordnen ist deaktiviert." }) : undefined}>
      {/* Quick capture (P4) — Keep's "take a note" popup (2026-07-17): the
          collapsed field expands to a title + body card. A typed title becomes
          the file name and the H1; without one the note gets a timestamp name
          and no H1. Embeds are read-mostly (D5). */}
      {!embedded && onQuickCapture && !captureOpen && (
        <button
          type="button"
          data-pinboard-capture="true"
          onClick={() => setCaptureOpen(true)}
          style={{
            display: "block",
            width: boardWidth > 0 ? boardWidth : "100%",
            maxWidth: 560,
            margin: "0 0 12px",
            padding: "9px 12px",
            border: "1px solid var(--border-color)",
            borderRadius: "var(--radius-md)",
            background: "var(--bg-secondary)",
            color: "var(--text-muted)",
            fontSize: "var(--text-ui)",
            textAlign: "left",
            cursor: "text",
          }}
        >
          {t("pinboard.capturePlaceholder", { defaultValue: "Notiz schreiben…" })}
        </button>
      )}
      {!embedded && onQuickCapture && captureOpen && (
        <div
          data-pinboard-capture-popup="true"
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              e.stopPropagation();
              setCaptureOpen(false); // keep the draft in state — nothing is lost
            }
            if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) submitCapture();
          }}
          style={{
            width: boardWidth > 0 ? boardWidth : "100%",
            maxWidth: 560,
            margin: "0 0 12px",
            border: "1px solid var(--border-color)",
            borderRadius: "var(--radius-md)",
            background: "var(--bg-secondary)",
            boxShadow: "var(--shadow-2)",
            padding: "var(--space-3)",
            display: "flex",
            flexDirection: "column",
            gap: "var(--space-3)",
          }}
        >
          <input
            type="text"
            className="pv-field"
            value={captureTitle}
            data-pinboard-capture-title="true"
            autoFocus
            placeholder={t("pinboard.captureTitle", { defaultValue: "Titel" })}
            aria-label={t("pinboard.captureTitle", { defaultValue: "Titel" })}
            onChange={(e) => setCaptureTitle(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.ctrlKey && !e.metaKey) {
                e.preventDefault();
                captureTextRef.current?.focus();
              }
            }}
            style={{ fontWeight: 600 }}
          />
          <textarea
            ref={captureTextRef}
            className="pv-field pv-field--area"
            value={captureText}
            data-pinboard-capture-text="true"
            rows={3}
            placeholder={t("pinboard.capturePlaceholder", { defaultValue: "Notiz schreiben…" })}
            aria-label={t("pinboard.capturePlaceholder", { defaultValue: "Notiz schreiben…" })}
            onChange={(e) => setCaptureText(e.target.value)}
            style={{ minHeight: 72 }}
          />
          <div style={{ display: "flex", justifyContent: "flex-end", gap: 6 }}>
            <button
              type="button"
              className="pv-btn"
              onClick={() => setCaptureOpen(false)}
            >
              {t("common.close", { defaultValue: "Schließen" })}
            </button>
            <button
              type="button"
              className="pv-btn pv-btn--primary"
              data-pinboard-capture-save="true"
              disabled={captureBusy || (!captureTitle.trim() && !captureText.trim())}
              onClick={submitCapture}
            >
              {t("common.save", { defaultValue: "Speichern" })}
            </button>
          </div>
        </div>
      )}
      {/* Label chip bar (P4): session-local AND filter; the arrangement always
          splices into the full sequence, so hidden cards keep their spots. */}
      {chipEntries.length > 0 && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6, margin: "0 0 12px" }}>
          {chipEntries.map((c) => {
            const active = selectedLabels.includes(c.value);
            return (
              <button
                key={c.value}
                type="button"
                data-pinboard-chip={c.value}
                aria-pressed={active}
                onClick={() => setSelectedLabels((sel) => (active ? sel.filter((v) => v !== c.value) : [...sel, c.value]))}
                className={labelProp && !active ? chipClass(c.value, c.color) : undefined}
                style={{
                  fontSize: "var(--text-sm)",
                  padding: "2px 10px",
                  borderRadius: "var(--radius-pill)",
                  border: active ? "1px solid var(--accent-color)" : "1px solid var(--border-color)",
                  background: active ? "var(--accent-color)" : labelProp ? undefined : "var(--bg-secondary)",
                  color: active ? "var(--accent-on)" : labelProp ? undefined : "var(--text-main)",
                  cursor: "pointer",
                }}
              >
                {labelProp ? c.value : `#${c.value}`}
                <span style={{ marginLeft: 5, opacity: 0.7, fontSize: "var(--text-xs)" }}>{c.count}</span>
              </button>
            );
          })}
        </div>
      )}
      {dbData.length === 0 && <EmptyState>{t("database.emptyView", { defaultValue: "Keine Einträge in dieser Ansicht." })}</EmptyState>}
      {visibleSections.pinned.length > 0 && (
        <>
          <div style={{ fontSize: "var(--text-xs)", fontWeight: 600, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.04em", margin: "0 0 8px 2px" }}>
            {t("pinboard.pinned", { defaultValue: "Angepinnt" })}
          </div>
          {renderSection("pinned", columns.pinned)}
          <div style={{ fontSize: "var(--text-xs)", fontWeight: 600, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.04em", margin: "14px 0 8px 2px" }}>
            {t("pinboard.others", { defaultValue: "Weitere" })}
          </div>
        </>
      )}
      {renderSection("unpinned", columns.unpinned)}

      <MenuSurface open={!!menu} onClose={() => setMenu(null)} at={menu ? { x: menu.x, y: menu.y } : undefined} ariaLabel={t("pinboard.cardMenu", { defaultValue: "Karten-Menü" })}>
        {menu && (
          <>
            <MenuItem icon={<ExternalLink size={14} />} onSelect={() => onOpenNote(menu.path)}>
              {t("pinboard.open", { defaultValue: "Öffnen" })}
            </MenuItem>
            {onOpenInSplit && (
              <MenuItem icon={<Columns2 size={14} />} onSelect={() => onOpenInSplit(menu.path)}>
                {t("pinboard.openSplit", { defaultValue: "Im Split öffnen" })}
              </MenuItem>
            )}
            <MenuItem
              icon={menuPinned ? <PinOff size={14} /> : <Pin size={14} />}
              onSelect={() => handlePinToggle(menu.path, !menuPinned)}
            >
              {menuPinned ? t("pinboard.unpin", { defaultValue: "Lösen" }) : t("pinboard.pin", { defaultValue: "Anpinnen" })}
            </MenuItem>
            <MenuItem icon={<Tags size={14} />} onSelect={() => void openLabelEditor(menu.path, { x: menu.x, y: menu.y })}>
              {t("pinboard.labels", { defaultValue: "Labels" })}
            </MenuItem>
            <MenuSeparator />
            <div role="presentation" style={{ display: "flex", alignItems: "center", gap: 5, padding: "4px 10px" }}>
              <button
                type="button"
                aria-label={t("pinboard.noColor", { defaultValue: "Keine Farbe" })}
                title={t("pinboard.noColor", { defaultValue: "Keine Farbe" })}
                onClick={() => { setMenu(null); void handleSetColor(menu.path, null); }}
                style={{ width: 16, height: 16, borderRadius: "var(--radius-pill)", border: "1px solid var(--border-color)", background: "var(--bg-primary)", cursor: "pointer", padding: 0 }}
              />
              {CARD_COLORS.map(([name, hex]) => (
                <button
                  key={name}
                  type="button"
                  aria-label={`${t("pinboard.color", { defaultValue: "Farbe" })}: ${name}`}
                  title={`${t("pinboard.color", { defaultValue: "Farbe" })}: ${name}`}
                  onClick={() => { setMenu(null); void handleSetColor(menu.path, hex); }}
                  style={{
                    width: 16,
                    height: 16,
                    borderRadius: "var(--radius-pill)",
                    border: menuVm?.parsed.color === hex ? "2px solid var(--text-main)" : "1px solid var(--border-color)",
                    background: hex,
                    cursor: "pointer",
                    padding: 0,
                  }}
                />
              ))}
            </div>
            <MenuSeparator />
            <MenuItem danger icon={<Trash2 size={14} />} onSelect={() => void handleDelete(menu.path)}>
              {t("pinboard.delete", { defaultValue: "Löschen" })}
            </MenuItem>
          </>
        )}
      </MenuSurface>

      {/* Label editor (P4): toggle list with typeahead; tags mode can create a
          new label (tags exist through use), inline-only #tags stay disabled
          (they live in the note text, not the frontmatter). */}
      <MenuSurface open={!!labelEdit} onClose={() => setLabelEdit(null)} at={labelEdit ? { x: labelEdit.x, y: labelEdit.y } : undefined} ariaLabel={t("pinboard.labels", { defaultValue: "Labels" })} minWidth={220}>
        {labelEdit && (() => {
          const current = labelsByPath.get(labelEdit.path) ?? [];
          const q = labelQuery.trim();
          const candidates = [...new Set([
            ...chipEntries.map((c) => c.value),
            ...(labelProp ? labelOptions.map((o) => o.value) : []),
            ...current,
          ])].filter((v) => !q || v.toLowerCase().includes(q.toLowerCase()));
          const canCreate = !labelProp && q.length > 0 && !candidates.some((v) => v.toLowerCase() === q.toLowerCase());
          return (
            <div style={{ display: "flex", flexDirection: "column", gap: 2, maxWidth: 280 }}>
              <input
                type="text"
                value={labelQuery}
                autoFocus
                placeholder={t("pinboard.addLabel", { defaultValue: "Label suchen…" })}
                aria-label={t("pinboard.addLabel", { defaultValue: "Label suchen…" })}
                onChange={(e) => setLabelQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && canCreate) {
                    void toggleLabel(labelEdit.path, q.replace(/^#/, ""), true);
                    setLabelQuery("");
                  }
                }}
                style={{ margin: "2px 6px 6px", padding: "5px 8px", border: "1px solid var(--border-color)", borderRadius: "var(--radius-xs)", background: "var(--bg-secondary)", color: "var(--text-main)", fontSize: "var(--text-sm)", outline: "none" }}
              />
              <div style={{ maxHeight: 220, overflowY: "auto", display: "flex", flexDirection: "column" }}>
                {candidates.map((v) => {
                  const has = current.includes(v);
                  // A tag the note carries but the frontmatter does not is inline-only.
                  const inlineOnly = !labelProp && has && labelEdit.fmTags !== null && !labelEdit.fmTags.includes(v);
                  return (
                    <MenuItem
                      key={v}
                      keepOpen
                      disabled={inlineOnly}
                      icon={has ? <Check size={13} /> : <span style={{ width: 13, display: "inline-block" }} />}
                      onSelect={() => { if (!inlineOnly) void toggleLabel(labelEdit.path, v, !has); }}
                    >
                      {labelProp ? v : `#${v}`}
                    </MenuItem>
                  );
                })}
                {canCreate && (
                  <MenuItem keepOpen icon={<Tags size={13} />} onSelect={() => { void toggleLabel(labelEdit.path, q.replace(/^#/, ""), true); setLabelQuery(""); }}>
                    {t("pinboard.newLabel", { defaultValue: "„{{name}}“ anlegen", name: q })}
                  </MenuItem>
                )}
              </div>
            </div>
          );
        })()}
      </MenuSurface>
      <style>{`
        .pv-pinboard-pin { opacity: 0; transition: opacity var(--dur-1) var(--ease-1); }
        .pv-pinboard-card:hover .pv-pinboard-pin, .pv-pinboard-pin:focus-visible { opacity: 1; }
      `}</style>
    </div>
  );
}
