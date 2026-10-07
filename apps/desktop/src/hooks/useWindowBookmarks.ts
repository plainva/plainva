import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { moveBookmark as moveBookmarkEntries, moveBookmarkOnDisk, removeBookmarksOnDisk, toggleBookmarkOnDisk, toast, type BookmarkEntry, type BookmarksIO } from "@plainva/ui";
import { getWindowBus } from "../services/windowBus";
import { isOwnerWindow } from "../services/windowContext";
import { loadDesktopBookmarks, publishBookmarks } from "../services/bookmarks";

/** Every shell mirrors owner state; a client never writes a complete list. */
export function useWindowBookmarks(io: BookmarksIO | null, vaultPath: string | null) {
  const { t } = useTranslation();
  const [bookmarks, setBookmarks] = useState<BookmarkEntry[]>([]);
  const generation = useRef(0);
  useEffect(() => {
    let alive = true, updated = 0;
    const epoch = ++generation.current;
    setBookmarks([]);
    if (!io || !vaultPath) return;
    const accept = (paths: BookmarkEntry[]) => { if (alive) { updated++; setBookmarks(paths); } };
    const local = (event: Event) => {
      const detail = (event as CustomEvent<{ vaultPath: string; bookmarks: BookmarkEntry[] }>).detail;
      if (detail?.vaultPath === vaultPath) accept(detail.bookmarks);
      else if (!detail) void read().catch(() => { if (alive) toast.error(t("sidebar.bookmarkSaveFailed")); });
    };
    window.addEventListener("plainva-bookmarks-changed", local);
    const off = isOwnerWindow() ? Promise.resolve(() => {}) : getWindowBus().then(bus => bus.onBroadcast("bookmarks-changed", value => accept(value.entries)));
    const read = async () => {
      await off;
      const before = updated;
      const paths = isOwnerWindow() ? await loadDesktopBookmarks(io) : await (await getWindowBus()).request("bookmarks-list", {}, { vaultPath });
      if (alive && before === updated && generation.current === epoch) setBookmarks(paths);
    };
    void read().catch(() => { if (alive) toast.error(t("sidebar.bookmarkSaveFailed")); });
    return () => { alive = false; window.removeEventListener("plainva-bookmarks-changed", local); void off.then(unsubscribe => unsubscribe()).catch(() => {}); };
  }, [io, vaultPath, t]);
  const mutate = async (kind: "toggle" | "remove", paths: string[], type: BookmarkEntry["type"] = "file") => {
    if (!io || !vaultPath) return;
    const epoch = generation.current;
    try {
      const next = isOwnerWindow()
        ? await (kind === "toggle" ? toggleBookmarkOnDisk(io, paths[0], type) : removeBookmarksOnDisk(io, paths))
        : await (kind === "toggle"
          ? (await getWindowBus()).request("toggle-bookmark", { path: paths[0], type }, { vaultPath })
          : (await getWindowBus()).request("remove-bookmarks", { paths }, { vaultPath }));
      if (isOwnerWindow()) publishBookmarks(vaultPath, next);
      if (generation.current === epoch) setBookmarks(next);
    } catch { if (generation.current === epoch) toast.error(t("sidebar.bookmarkSaveFailed")); }
  };
  /** One entry in front of another, or to the end (plan Befunde 2026-10-06, W6). The owner writes; every window follows. */
  const moveBookmark = async (key: string, beforeKey: string | null) => {
    if (!io || !vaultPath) return;
    const epoch = generation.current;
    // The row is where it was dropped at once; the file's answer replaces this.
    setBookmarks((current) => moveBookmarkEntries(current, key, beforeKey));
    try {
      const next = isOwnerWindow()
        ? await moveBookmarkOnDisk(io, key, beforeKey)
        : await (await getWindowBus()).request("move-bookmark", { key, beforeKey }, { vaultPath });
      if (isOwnerWindow()) publishBookmarks(vaultPath, next);
      if (generation.current === epoch) setBookmarks(next);
    } catch {
      if (generation.current !== epoch) return;
      toast.error(t("sidebar.bookmarkSaveFailed"));
      window.dispatchEvent(new CustomEvent("plainva-bookmarks-changed"));
    }
  };
  return {
    bookmarks,
    toggleBookmark: (path: string, type: BookmarkEntry["type"] = "file") => { void mutate("toggle", [path], type); },
    removeBookmarks: (paths: string[]) => { void mutate("remove", paths); },
    moveBookmark: (key: string, beforeKey: string | null) => { void moveBookmark(key, beforeKey); },
  };
}
