import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type RefObject } from "react";
import type { NoteCardData } from "@plainva/core";
import { cardRevision, pinboardCache, type CardRow, type CardSource, type PinboardCache } from "./pinboardCache";
import { scrollerOf } from "../lib/scrollerOf";

/**
 * Loads indexed text only for visible cards (plus one screen of overscan).
 *
 * "Visible" is measured against the element that really scrolls the board
 * (`scrollerOf`), not against `root` as handed in: on the phone `root` is as
 * tall as its cards, so every card of a large board counted as visible, the
 * whole board was read at once - and with notes of real length the cache then
 * threw out the first cards to make room for the last ones. The cards on
 * screen were left as placeholders until something else re-ran the load
 * (TestFlight 2026-10-04). What is on screen is also reported to the cache
 * (`keep`), so no budget can take a card away while it is shown.
 */
export function usePinboardCards(owner: object, source: CardSource | null | undefined, rows: CardRow[], root: RefObject<HTMLElement | null>) {
  const cache = useMemo(() => pinboardCache(owner), [owner]);
  const [visible, setVisible] = useState<Set<string>>(() => new Set());
  const [attempt, setAttempt] = useState(0);
  const [settled, setSettled] = useState<Record<string, { revision: string; state: "missing" | "error" }>>({});
  const [version, setVersion] = useState(0);
  const elements = useRef(new Map<string, HTMLElement>());
  const observer = useRef<IntersectionObserver | null>(null);
  const registerPreview = useCallback((path: string, el: HTMLElement | null) => {
    const old = elements.current.get(path);
    if (old === el) return;
    if (old) observer.current?.unobserve(old);
    if (el) { elements.current.set(path, el); observer.current?.observe(el); }
    else elements.current.delete(path);
  }, []);
  useEffect(() => {
    if (typeof IntersectionObserver === "undefined") { setVisible(new Set(elements.current.keys())); return; }
    const io = new IntersectionObserver((entries) => {
      setVisible((old) => {
        const next = new Set(old);
        for (const entry of entries) {
          const path = (entry.target as HTMLElement).dataset.pinboardPath;
          if (path) { if (entry.isIntersecting) next.add(path); else next.delete(path); }
        }
        return next.size === old.size && [...next].every((path) => old.has(path)) ? old : next;
      });
    }, { root: scrollerOf(root.current), rootMargin: "400px 0px" });
    observer.current = io;
    for (const el of elements.current.values()) io.observe(el);
    return () => { io.disconnect(); observer.current = null; };
  }, [root]);
  useEffect(() => {
    let alive = true;
    const shown = rows.filter((row) => visible.has(String(row["file.path"])));
    cache.keep(shown.map((row) => String(row["file.path"])));
    const needed = shown.filter((row) => !cache.get(row));
    if (!needed.length) return;
    const complete = (failed: boolean) => {
      if (!alive) return;
      setSettled((old) => {
        const next = { ...old };
        for (const row of needed) {
          const path = String(row["file.path"]);
          if (cache.get(row)) delete next[path];
          else next[path] = { revision: cardRevision(row), state: failed ? "error" : "missing" };
        }
        return next;
      });
      setVersion((v) => v + 1);
    };
    if (source) void cache.load(source, needed).then(() => complete(false), () => complete(true));
    else complete(false);
    return () => { alive = false; };
  }, [cache, source, rows, visible, attempt]);
  const data = useMemo(() => {
    const result: Record<string, NoteCardData> = {};
    for (const row of rows) { const value = cache.get(row); if (value) result[String(row["file.path"])] = value; }
    return result;
    // Cache completion is deliberately a version signal, not a global subscription.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cache, rows, version]);
  const status = (row: CardRow) => {
    const path = String(row["file.path"]);
    if (data[path]) return "ready";
    const entry = settled[path];
    return entry?.revision === cardRevision(row) ? entry.state : "loading";
  };
  return { data, status, registerPreview, failed: rows.some((row) => status(row) === "error"), retry: () => { setSettled({}); setAttempt((a) => a + 1); } };
}

export function usePinboardScroll(root: RefObject<HTMLElement | null>, cache: PinboardCache, key: string) {
  useLayoutEffect(() => {
    const session = cache.session(key);
    // The element whose scrollTop means something (see `scrollerOf`); a board
    // short enough not to scroll has no position to keep.
    const el = scrollerOf(root.current) ?? root.current;
    if (!el) return;
    el.scrollTo({ top: session.scrollTop });
    if (session.anchor) {
      const card = [...el.querySelectorAll<HTMLElement>("[data-pinboard-path]")].find((node) => node.dataset.pinboardPath === session.anchor!.path);
      if (card) el.scrollBy({ top: card.getBoundingClientRect().top - el.getBoundingClientRect().top - session.anchor.offset });
    }
    let frame = 0;
    const save = () => {
      session.scrollTop = el.scrollTop;
      const top = el.getBoundingClientRect().top;
      const card = [...el.querySelectorAll<HTMLElement>("[data-pinboard-path]")].find((node) => node.getBoundingClientRect().bottom > top);
      session.anchor = card ? { path: card.dataset.pinboardPath!, offset: card.getBoundingClientRect().top - top } : null;
    };
    const scroll = () => { if (!frame) frame = requestAnimationFrame(() => { frame = 0; save(); }); };
    el.addEventListener("scroll", scroll, { passive: true });
    return () => { if (frame) cancelAnimationFrame(frame); save(); el.removeEventListener("scroll", scroll); };
  }, [root, cache, key]);
}

/** Each image retains its space, but binary reads start only on visibility. */
const imageSizes = new WeakMap<object, Map<string, { width: number; height: number }>>();
export function useVisibleImage(owner: object, key: string) {
  const known = imageSizes.get(owner)?.get(key);
  const placeholderStyle = known ? { width: known.width, maxWidth: "100%", height: "auto", aspectRatio: `${known.width} / ${known.height}` } : undefined;
  const loaded = (event: React.SyntheticEvent<HTMLImageElement>) => {
    let sizes = imageSizes.get(owner);
    if (!sizes) { sizes = new Map(); imageSizes.set(owner, sizes); }
    const el = event.currentTarget;
    if (el.naturalWidth && el.naturalHeight) sizes.set(key, { width: el.naturalWidth, height: el.naturalHeight });
    while (sizes.size > 384) sizes.delete(sizes.keys().next().value!);
  };
  const ref = useRef<HTMLSpanElement>(null);
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    if (!ref.current || typeof IntersectionObserver === "undefined") { setVisible(true); return; }
    const io = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) { setVisible(true); io.disconnect(); }
    });
    io.observe(ref.current);
    return () => io.disconnect();
  }, []);
  return { ref, visible, loaded, placeholderStyle };
}
