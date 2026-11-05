import { useEffect, useLayoutEffect, useState, useSyncExternalStore, type CSSProperties } from "react";
import { chromeNow, getChromeScroll, noteChromeTucked, readerScrollSource, subscribeChromeScroll } from "../services/chromeScroll";
import { useAutoHideChrome } from "./useAutoHideChrome";
import { useSoftKeyboard } from "./useSoftKeyboard";

/** Retreat only the current reader's controls. The navigator can scroll on its
 * own on a tablet without taking this note's Back button away. */
export function useReaderChrome(vaultId: string, path: string, overlay: boolean, blocked: boolean, editing = false) {
  const scroll = useSyncExternalStore(subscribeChromeScroll, getChromeScroll);
  const enabled = useAutoHideChrome();
  const [keyboard, setKeyboard] = useState(false);
  const [focused, setFocused] = useState(false);
  const [height, setHeight] = useState<number | null>(null);
  const [chromeNode, setChromeNode] = useState<HTMLDivElement | null>(null);
  const [keyboardAt, setKeyboardAt] = useState(0);
  useSoftKeyboard((open) => {
    setKeyboard(open);
    if (open) setKeyboardAt(chromeNow());
  });
  useLayoutEffect(() => {
    const node = chromeNode;
    if (!node) return;
    const read = () => setHeight(node.offsetHeight);
    read(); const observer = new ResizeObserver(read); observer.observe(node);
    return () => observer.disconnect();
  }, [chromeNode]);
  // A focused control that leaves the page fires no blur: the pencil goes the
  // moment writing starts, and in a Chromium WebView a tapped button holds the
  // focus. The chrome then stayed "focused" for good and never stepped aside
  // for the keyboard (Android). The next focus anywhere ends that hold.
  useEffect(() => {
    if (!focused) return;
    const next = (event: FocusEvent) => setFocused(!!chromeNode?.contains(event.target as Node | null));
    document.addEventListener("focusin", next);
    return () => document.removeEventListener("focusin", next);
  }, [focused, chromeNode]);
  const active = scroll.source === readerScrollSource(vaultId, path);
  return {
    chromeRef: setChromeNode,
    away: overlay && enabled && active && scroll.away && !blocked && !keyboard && !focused,
    /** Writing with the keyboard up: the bar gives the text its room (F8). */
    tucked: noteChromeTucked({ editing, enabled, keyboard, keyboardAt, active, blocked: blocked || focused, scroll }),
    scroll: active ? scroll : { scrolled: false, away: false },
    pageStyle: height ? { "--m-reader-chrome-height": `${height}px` } as CSSProperties : undefined,
    onFocusCapture: () => setFocused(true),
    onBlurCapture: () => { queueMicrotask(() => setFocused(!!chromeNode?.contains(document.activeElement))); },
  };
}
