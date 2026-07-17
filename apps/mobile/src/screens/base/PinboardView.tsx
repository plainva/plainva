import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Pin } from "lucide-react";
import type { NoteCardData } from "@plainva/core";
import { readFrontmatterPath, setFrontmatterPath, deleteFrontmatterPath } from "@plainva/core";
import {
  DocIcon,
  NoteCardBody,
  PALETTE_SWATCH,
  applyPin,
  applyUnpin,
  chipClass,
  distributeCards,
  dropSlotAt,
  filterCardPaths,
  isRenderableDocIcon,
  noteDisplayName,
  orderCards,
  parseNoteCard,
  parseSourceClause,
  spliceIntoSequence,
  splitMultiValue,
  toast,
  toggleTaskAtIndex,
  type ParsedNoteCard,
  type PinboardDropSlot,
} from "@plainva/ui";
import { haptics } from "../../services/haptics";
import { mConfirm, mSelect } from "../../services/mobileDialogs";
import { captureBaseItem } from "../../services/baseOps";
import { vaultOps, type MobileVault } from "../../services/vaultService";

/**
 * Mobile pinboard view (plan Pinboard P6): the Keep-style board over the SAME
 * shared pieces the desktop uses — card parser/renderer, ordering, splice and
 * chip-filter semantics (E5/D3/D6). Touch model: tap opens the note,
 * long-press without movement opens the action sheet (pin/labels/color/
 * delete), long-press plus movement drags to reorder (the board card
 * pattern); checkboxes toggle right on the card.
 */

const GAP = 10;
const LONG_PRESS_MS = 350;
const MOVE_SLOP_PX = 8;

interface CardVM {
  path: string;
  mtime: number;
  parsed: ParsedNoteCard;
  title: string | null;
  data: NoteCardData;
  row: any;
}

function CardImage({ vault, target, alt, notePath }: { vault: MobileVault; target: string; alt: string; notePath: string }) {
  const [url, setUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let alive = true;
    let objectUrl: string | null = null;
    setUrl(null);
    setFailed(false);
    const noteDir = notePath.includes("/") ? notePath.slice(0, notePath.lastIndexOf("/")) : "";
    const candidates = [target, noteDir ? `${noteDir}/${target}` : null].filter((p): p is string => !!p);
    void (async () => {
      for (const rel of candidates) {
        try {
          const bin = await vault.adapter.readBinaryFile(rel);
          if (!alive) return;
          objectUrl = URL.createObjectURL(new Blob([bin as BlobPart]));
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
  }, [vault, target, notePath]);
  if (failed) return <span style={{ color: "var(--text-muted)", fontStyle: "italic", fontSize: "var(--text-xs)" }}>{alt || target}</span>;
  if (!url) return <span aria-hidden="true" style={{ display: "block", height: 40 }} />;
  return <img alt={alt} src={url} style={{ maxWidth: "100%", borderRadius: "var(--radius-xs)", display: "block" }} />;
}

export function PinboardView({
  vault,
  basePath,
  config,
  view,
  rows,
  onOpenNote,
  onMutated,
  onPatchView,
  onNeedsConfig,
}: {
  vault: MobileVault;
  basePath: string;
  config: any;
  view: any;
  rows: Record<string, any>[];
  onOpenNote: (path: string) => void;
  /** Re-query after a card write (toggle/label/color/capture/delete). */
  onMutated: () => void;
  /** Patch the active view (pinboardOrder/pinboardPinned) and persist. */
  onPatchView: (patch: Record<string, unknown>) => void;
  /** Capture without a folder source: open the configure sheet (createBaseItem parity). */
  onNeedsConfig: () => void;
}) {
  const { t } = useTranslation();
  const rowPath = (r: Record<string, any>) => String(r["file.path"] ?? "");
  const paths = useMemo(() => rows.map(rowPath).filter(Boolean), [rows]);

  // ── Card data from the FTS index (shared getCardData, P2) ──
  const [cardData, setCardData] = useState<Record<string, NoteCardData>>({});
  useEffect(() => {
    if (!vault.queryService || paths.length === 0) {
      setCardData({});
      return;
    }
    let alive = true;
    vault.queryService.getCardData(paths).then((d) => { if (alive) setCardData(d); }).catch(() => {});
    return () => { alive = false; };
  }, [vault, paths]);

  const cards = useMemo(() => {
    const map = new Map<string, CardVM>();
    for (const row of rows) {
      const path = rowPath(row);
      if (!path) continue;
      const data = cardData[path] ?? { content: "", tags: [], ctime: null };
      const parsed = parseNoteCard(data.content, { dropLeadingH1: true });
      map.set(path, { path, mtime: Number(row["file.mtime"] ?? 0), parsed, title: parsed.fmTitle ?? parsed.leadingH1 ?? null, data, row });
    }
    return map;
  }, [rows, cardData]);

  // ── Labels & chips (P4 semantics) ──
  const filterByRaw = typeof view?.pinboardFilterBy === "string" ? view.pinboardFilterBy : "tags";
  const labelProp = filterByRaw !== "tags" ? filterByRaw.replace(/^note\./, "") : null;
  const sourceTags = useMemo(() => {
    const set = new Set<string>();
    const scan = (list: any[]) => {
      for (const f of Array.isArray(list) ? list : []) {
        const s = parseSourceClause(f);
        if (s?.type === "tag") set.add(s.value);
      }
    };
    scan(config?.filters?.and);
    scan(config?.filters?.or);
    return set;
  }, [config]);
  const labelsByPath = useMemo(() => {
    const m = new Map<string, string[]>();
    for (const [p, vm] of cards) {
      if (labelProp) m.set(p, splitMultiValue(vm.row?.[labelProp]).map(String));
      else m.set(p, vm.data.tags.filter((tg) => !sourceTags.has(tg)));
    }
    return m;
  }, [cards, labelProp, sourceTags]);
  const labelOptions: { value: string; color?: string }[] = useMemo(
    () => (labelProp && Array.isArray(config?.columns?.[labelProp]?.options) ? config.columns[labelProp].options : []),
    [config, labelProp],
  );
  const [selectedLabels, setSelectedLabels] = useState<string[]>([]);
  const chipEntries = useMemo(() => {
    const counts = new Map<string, number>();
    for (const labels of labelsByPath.values()) for (const l of labels) counts.set(l, (counts.get(l) ?? 0) + 1);
    const curated = labelOptions.map((o) => o.value).filter((v) => counts.has(v));
    const rest = [...counts.keys()].filter((v) => !curated.includes(v)).sort((a, b) => (counts.get(b)! - counts.get(a)!) || a.localeCompare(b));
    return [...curated, ...rest].map((value) => ({ value, count: counts.get(value) ?? 0, color: labelOptions.find((o) => o.value === value)?.color }));
  }, [labelsByPath, labelOptions]);

  // ── Sections (§3) ──
  const hasSort = Array.isArray(view?.sort) && view.sort.length > 0;
  const order: string[] | undefined = Array.isArray(view?.pinboardOrder) ? view.pinboardOrder : undefined;
  const pinnedList: string[] | undefined = Array.isArray(view?.pinboardPinned) ? view.pinboardPinned : undefined;
  const sections = useMemo(() => {
    if (hasSort) {
      const pinnedSet = new Set(pinnedList ?? []);
      return { pinned: paths.filter((p) => pinnedSet.has(p)), unpinned: paths.filter((p) => !pinnedSet.has(p)) };
    }
    const rws = paths.map((p) => ({ path: p, ctime: cards.get(p)?.data.ctime ?? null, mtime: cards.get(p)?.mtime ?? 0 }));
    return orderCards(rws, order, pinnedList);
  }, [hasSort, paths, cards, order, pinnedList]);
  const visibleSections = useMemo(
    () => ({
      pinned: filterCardPaths(sections.pinned, labelsByPath, selectedLabels),
      unpinned: filterCardPaths(sections.unpinned, labelsByPath, selectedLabels),
    }),
    [sections, labelsByPath, selectedLabels],
  );

  // ── Two/three-column masonry with measured heights ──
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
  const columnCount = containerWidth >= 660 ? 3 : 2;
  const columns = useMemo(
    () => ({
      pinned: distributeCards(visibleSections.pinned, heights, columnCount),
      unpinned: distributeCards(visibleSections.unpinned, heights, columnCount),
    }),
    [visibleSections, columnCount, heights],
  );

  // ── Card writes (shared semantics with the desktop view) ──
  const afterCardWrite = useCallback(async (path: string) => {
    if (vault.indexer) {
      try {
        await vault.indexer.indexFile(await vault.adapter.getFileInfo(path));
      } catch {
        /* next full pass repairs it */
      }
    }
    onMutated();
  }, [vault, onMutated]);

  const handleToggleTask = useCallback(async (path: string, ordinal: number, checked: boolean) => {
    try {
      const fresh = await vault.files.readTextFile(path);
      const res = toggleTaskAtIndex(fresh, ordinal, checked);
      if (!res.changed) return;
      await vault.files.writeTextFile(path, res.content);
      await afterCardWrite(path);
    } catch (e: any) {
      toast.error(String(e?.message ?? e));
    }
  }, [vault, afterCardWrite]);

  const persistSections = useCallback((next: { order?: string[]; pinned?: string[] }) => {
    const patch: Record<string, unknown> = {};
    if (next.order) patch.pinboardOrder = next.order.length > 0 ? next.order : undefined;
    if (next.pinned) patch.pinboardPinned = next.pinned.length > 0 ? next.pinned : undefined;
    onPatchView(patch);
  }, [onPatchView]);
  const presentSet = useMemo(() => new Set(paths), [paths]);

  const pickColor = useCallback(async (path: string) => {
    const options = [
      { value: "", label: t("pinboard.noColor", { defaultValue: "Keine Farbe" }) },
      ...Object.entries(PALETTE_SWATCH).filter(([n]) => n !== "gray").map(([name]) => ({ value: name, label: name })),
    ];
    const picked = await mSelect({ title: t("pinboard.color", { defaultValue: "Farbe" }), options });
    if (picked === null) return;
    try {
      const fresh = await vault.files.readTextFile(path);
      const hex = picked ? PALETTE_SWATCH[picked] : null;
      const next = hex ? setFrontmatterPath(fresh, ["plainva", "color"], hex) : deleteFrontmatterPath(fresh, ["plainva", "color"]);
      if (next !== fresh) {
        await vault.files.writeTextFile(path, next);
        await afterCardWrite(path);
      }
    } catch (e: any) {
      toast.error(String(e?.message ?? e));
    }
  }, [vault, t, afterCardWrite]);

  const editLabels = useCallback(async (path: string) => {
    const current = labelsByPath.get(path) ?? [];
    let fmTags: string[] | null = null;
    let fresh: string;
    try {
      fresh = await vault.files.readTextFile(path);
      if (!labelProp) {
        const raw = readFrontmatterPath(fresh, ["tags"]);
        fmTags = Array.isArray(raw) ? raw.map(String) : typeof raw === "string" && raw ? [raw] : [];
      }
    } catch {
      return;
    }
    const candidates = [...new Set([...chipEntries.map((c) => c.value), ...(labelProp ? labelOptions.map((o) => o.value) : []), ...current])];
    // One toggle per opening (v1): picked = flip; inline-only #tags cannot be
    // removed here (they live in the note text) and say so in the label.
    const options = candidates.map((v) => {
      const has = current.includes(v);
      const inlineOnly = !labelProp && has && fmTags !== null && !fmTags.includes(v);
      const base = labelProp ? v : `#${v}`;
      return { value: v, label: `${has ? "✓ " : ""}${base}${inlineOnly ? ` (${t("pinboard.inlineTag", { defaultValue: "im Text" })})` : ""}` };
    });
    const picked = await mSelect({ title: t("pinboard.labels", { defaultValue: "Labels" }), options });
    if (picked === null) return;
    const has = current.includes(picked);
    const inlineOnly = !labelProp && has && fmTags !== null && !fmTags.includes(picked);
    if (inlineOnly) return;
    try {
      let next: string;
      if (labelProp) {
        const cur = splitMultiValue(readFrontmatterPath(fresh, [labelProp])).map(String);
        const list = has ? cur.filter((v) => v !== picked) : [...cur, picked];
        next = list.length > 0 ? setFrontmatterPath(fresh, [labelProp], list) : deleteFrontmatterPath(fresh, [labelProp]);
      } else {
        const cur = fmTags ?? [];
        const list = has ? cur.filter((v) => v !== picked) : [...cur, picked];
        next = list.length > 0 ? setFrontmatterPath(fresh, ["tags"], list) : deleteFrontmatterPath(fresh, ["tags"]);
      }
      if (next !== fresh) {
        await vault.files.writeTextFile(path, next);
        await afterCardWrite(path);
      }
    } catch (e: any) {
      toast.error(String(e?.message ?? e));
    }
  }, [vault, labelProp, labelsByPath, chipEntries, labelOptions, t, afterCardWrite]);

  const openActions = useCallback(async (path: string) => {
    const isPinned = sections.pinned.includes(path);
    const picked = await mSelect({
      title: noteDisplayName(path.split("/").pop() ?? path),
      options: [
        { value: "pin", label: isPinned ? t("pinboard.unpin", { defaultValue: "Lösen" }) : t("pinboard.pin", { defaultValue: "Anpinnen" }) },
        { value: "labels", label: t("pinboard.labels", { defaultValue: "Labels" }) },
        { value: "color", label: t("pinboard.color", { defaultValue: "Farbe" }) },
        { value: "delete", label: t("pinboard.delete", { defaultValue: "Löschen" }) },
      ],
    });
    if (picked === "pin") {
      const next = isPinned ? applyUnpin(order, pinnedList, path, presentSet) : applyPin(order, pinnedList, path, presentSet);
      persistSections(next);
    } else if (picked === "labels") {
      await editLabels(path);
    } else if (picked === "color") {
      await pickColor(path);
    } else if (picked === "delete") {
      const ok = await mConfirm({
        title: t("pinboard.delete", { defaultValue: "Löschen" }),
        message: noteDisplayName(path.split("/").pop() ?? path),
        danger: true,
      });
      if (!ok) return;
      // vaultOps.remove is the established mobile delete path (sync chain,
      // bookmark cleanup) — same flow the note screens use.
      await vaultOps.remove(vault, path).catch((e: any) => toast.error(String(e?.message ?? e)));
      onMutated();
    }
  }, [sections, order, pinnedList, presentSet, persistSections, editLabels, pickColor, vault, t, onMutated]);

  // ── Long-press: no movement = action sheet, movement = drag reorder ──
  const [drag, setDrag] = useState<{ path: string; x: number; y: number } | null>(null);
  const [dropSlot, setDropSlot] = useState<{ section: "pinned" | "unpinned"; slot: PinboardDropSlot } | null>(null);
  const canDrag = !hasSort;
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
      if (rects.some((r) => x >= r.left && x <= r.right && y >= r.top && y <= r.bottom)) {
        return { section, slot: dropSlotAt(rects, seq, x, y) };
      }
    }
    return null;
  }, [sections]);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const d: { timer: number | null; armed: boolean; startX: number; startY: number; path: string; section: "pinned" | "unpinned"; moved: boolean } = {
      timer: null,
      armed: false,
      startX: 0,
      startY: 0,
      path: "",
      section: "unpinned",
      moved: false,
    };
    const clear = () => {
      if (d.timer !== null) window.clearTimeout(d.timer);
      d.timer = null;
      d.armed = false;
      d.moved = false;
      setDrag(null);
      setDropSlot(null);
    };
    const onDown = (e: PointerEvent) => {
      const card = (e.target as HTMLElement).closest<HTMLElement>("[data-pinboard-path]");
      if (!card || !card.dataset.pinboardPath) return;
      if ((e.target as HTMLElement).closest("input, button, a")) return;
      d.startX = e.clientX;
      d.startY = e.clientY;
      d.path = card.dataset.pinboardPath;
      d.section = card.dataset.pinboardSection === "pinned" ? "pinned" : "unpinned";
      d.moved = false;
      d.timer = window.setTimeout(() => {
        d.armed = true;
        haptics.medium();
        setDrag({ path: d.path, x: d.startX, y: d.startY });
      }, LONG_PRESS_MS);
    };
    const onMove = (e: PointerEvent) => {
      if (!d.armed) {
        // Real movement before the arm = a scroll; give the gesture back.
        if (d.timer !== null && Math.hypot(e.clientX - d.startX, e.clientY - d.startY) > MOVE_SLOP_PX) {
          window.clearTimeout(d.timer);
          d.timer = null;
        }
        return;
      }
      if (!canDrag) return;
      if (Math.hypot(e.clientX - d.startX, e.clientY - d.startY) > MOVE_SLOP_PX) d.moved = true;
      setDrag((prev) => (prev ? { ...prev, x: e.clientX, y: e.clientY } : prev));
      const hit = slotAt(e.clientX, e.clientY);
      setDropSlot(hit && hit.section === d.section ? hit : null);
      // Auto-scroll the page near its vertical edges.
      const rect = el.getBoundingClientRect();
      if (e.clientY < rect.top + 56) el.scrollTop -= 12;
      else if (e.clientY > rect.bottom - 56) el.scrollTop += 12;
    };
    const onTouchMove = (e: TouchEvent) => {
      if (d.armed && e.cancelable) e.preventDefault();
    };
    const onUp = (e: PointerEvent) => {
      const wasArmed = d.armed;
      const moved = d.moved;
      const path = d.path;
      const section = d.section;
      const hit = wasArmed && moved ? slotAt(e.clientX, e.clientY) : null;
      clear();
      if (!wasArmed) return; // plain tap — the card's click opens the note
      if (!moved) {
        void openActions(path);
        return;
      }
      if (!hit || hit.section !== section) return;
      haptics.light();
      const next = spliceIntoSequence(sections[section], [path], hit.slot);
      persistSections(section === "pinned" ? { pinned: next } : { order: next });
    };
    el.addEventListener("pointerdown", onDown);
    el.addEventListener("pointermove", onMove);
    el.addEventListener("pointerup", onUp);
    el.addEventListener("pointercancel", clear);
    el.addEventListener("touchmove", onTouchMove, { passive: false });
    return () => {
      el.removeEventListener("pointerdown", onDown);
      el.removeEventListener("pointermove", onMove);
      el.removeEventListener("pointerup", onUp);
      el.removeEventListener("pointercancel", clear);
      el.removeEventListener("touchmove", onTouchMove);
      clear();
    };
  }, [sections, canDrag, slotAt, openActions, persistSections]);

  // ── Quick capture (P4/P6) ──
  const [captureText, setCaptureText] = useState("");
  const [captureBusy, setCaptureBusy] = useState(false);
  const submitCapture = useCallback(async () => {
    const text = captureText.trim();
    if (!text || captureBusy) return;
    setCaptureBusy(true);
    try {
      const created = await captureBaseItem(vault, basePath, config, rows.length, text);
      if (created) {
        setCaptureText("");
        onMutated();
      } else {
        onNeedsConfig(); // no folder source yet — same move as the + button
      }
    } catch (e: any) {
      toast.error(String(e?.message ?? e));
    } finally {
      setCaptureBusy(false);
    }
  }, [captureText, captureBusy, vault, basePath, config, rows.length, onMutated, onNeedsConfig]);

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
    const tint = vm.parsed.color;
    const isPinned = section === "pinned";
    const showDropBefore = dropSlot?.slot.kind === "before" && dropSlot.slot.path === path && dropSlot.section === section;
    const labels = labelsByPath.get(path) ?? [];
    return (
      <div
        key={path}
        ref={registerCard(path)}
        data-pinboard-path={path}
        data-pinboard-section={section}
        data-pinboard-card="true"
        role="button"
        tabIndex={0}
        onClick={() => onOpenNote(path)}
        onKeyDown={(e) => { if (e.key === "Enter") onOpenNote(path); }}
        style={{
          position: "relative",
          border: "1px solid var(--border-color)",
          borderRadius: "var(--radius-md)",
          background: tint
            ? `color-mix(in srgb, ${tint} calc(var(--pinboard-tint, 16) * 1%), var(--bg-secondary))`
            : "var(--bg-secondary)",
          padding: "10px 12px",
          opacity: drag?.path === path ? 0.45 : 1,
          boxShadow: showDropBefore ? "0 -2px 0 0 var(--accent-color)" : undefined,
          contentVisibility: "auto",
          containIntrinsicSize: "auto 160px",
        }}
      >
        {isPinned && (
          <span aria-hidden="true" style={{ position: "absolute", top: 6, right: 6, color: "var(--accent-color)" }}>
            <Pin size={13} />
          </span>
        )}
        {(vm.title || (vm.parsed.icon != null && isRenderableDocIcon(vm.parsed.icon))) && (
          <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 6, paddingRight: isPinned ? 18 : 0 }}>
            {vm.parsed.icon != null && isRenderableDocIcon(vm.parsed.icon) && <DocIcon icon={vm.parsed.icon} size={13} />}
            {vm.title && <div style={{ fontWeight: 600, fontSize: "var(--text-sm)", color: "var(--text-main)", overflowWrap: "anywhere" }}>{vm.title}</div>}
          </div>
        )}
        <div style={{ maxHeight: 260, overflow: "hidden", position: "relative" }}>
          <NoteCardBody
            blocks={vm.parsed.blocks}
            labels={cardLabels}
            onToggleTask={(ordinal, checked) => void handleToggleTask(path, ordinal, checked)}
            renderImage={(target, alt) => <CardImage vault={vault} target={target} alt={alt} notePath={path} />}
          />
          {vm.parsed.truncated && (
            <div aria-hidden="true" style={{ position: "absolute", left: 0, right: 0, bottom: 0, height: 24, background: "linear-gradient(transparent, var(--bg-secondary))" }} />
          )}
        </div>
        {labels.length > 0 && (
          <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginTop: 8 }}>
            {labels.slice(0, 3).map((l) => (
              <span key={l} className={labelProp ? chipClass(l, labelOptions.find((o) => o.value === l)?.color) : undefined} style={labelProp ? { fontSize: "var(--text-xs)" } : { fontSize: "var(--text-xs)", color: "var(--text-muted)", background: "var(--bg-primary)", border: "1px solid var(--border-color)", borderRadius: "var(--radius-pill)", padding: "0 6px" }}>
                {labelProp ? l : `#${l}`}
              </span>
            ))}
            {labels.length > 3 && <span style={{ fontSize: "var(--text-xs)", color: "var(--text-faint)" }}>+{labels.length - 3}</span>}
          </div>
        )}
      </div>
    );
  };

  const renderSection = (section: "pinned" | "unpinned", cols: string[][]) => (
    <div style={{ display: "flex", gap: GAP, alignItems: "flex-start" }}>
      {cols.map((col, i) => (
        <div key={i} style={{ display: "flex", flexDirection: "column", gap: GAP, flex: 1, minWidth: 0 }}>
          {col.map((p) => renderCard(p, section))}
        </div>
      ))}
    </div>
  );

  return (
    <div ref={containerRef} style={{ flex: 1, overflowY: "auto", padding: "0 16px 96px" }}>
      <input
        type="text"
        value={captureText}
        data-pinboard-capture="true"
        enterKeyHint="done"
        placeholder={t("pinboard.capturePlaceholder", { defaultValue: "Notiz schreiben…" })}
        aria-label={t("pinboard.capturePlaceholder", { defaultValue: "Notiz schreiben…" })}
        onChange={(e) => setCaptureText(e.target.value)}
        onKeyDown={(e) => { if (e.key === "Enter") void submitCapture(); }}
        style={{
          display: "block",
          width: "100%",
          margin: "4px 0 10px",
          padding: "11px 14px",
          border: "1px solid var(--border-color)",
          borderRadius: "var(--radius-pill)",
          background: "var(--bg-secondary)",
          color: "var(--text-main)",
          fontSize: "var(--text-ui)",
          outline: "none",
        }}
      />
      {chipEntries.length > 0 && (
        <div style={{ display: "flex", gap: 6, overflowX: "auto", padding: "0 0 10px", WebkitOverflowScrolling: "touch" }}>
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
                  flexShrink: 0,
                  fontSize: "var(--text-sm)",
                  padding: "4px 12px",
                  borderRadius: "var(--radius-pill)",
                  border: active ? "1px solid var(--accent-color)" : "1px solid var(--border-color)",
                  background: active ? "var(--accent-color)" : labelProp ? undefined : "var(--bg-secondary)",
                  color: active ? "var(--accent-on)" : labelProp ? undefined : "var(--text-main)",
                }}
              >
                {labelProp ? c.value : `#${c.value}`}
                <span style={{ marginLeft: 5, opacity: 0.7, fontSize: "var(--text-xs)" }}>{c.count}</span>
              </button>
            );
          })}
        </div>
      )}
      {visibleSections.pinned.length > 0 && (
        <>
          <div style={{ fontSize: "var(--text-xs)", fontWeight: 600, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.04em", margin: "2px 0 8px" }}>
            {t("pinboard.pinned", { defaultValue: "Angepinnt" })}
          </div>
          {renderSection("pinned", columns.pinned)}
          <div style={{ fontSize: "var(--text-xs)", fontWeight: 600, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.04em", margin: "12px 0 8px" }}>
            {t("pinboard.others", { defaultValue: "Weitere" })}
          </div>
        </>
      )}
      {renderSection("unpinned", columns.unpinned)}
      {drag && (
        <div aria-hidden className="m-board-ghost" style={{ left: drag.x + 10, top: drag.y + 10 }}>
          {cards.get(drag.path)?.title ?? noteDisplayName(drag.path.split("/").pop() ?? drag.path)}
        </div>
      )}
    </div>
  );
}
