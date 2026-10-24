import { deleteFrontmatterPath, PLAINVA_NAMESPACE_KEY, setFrontmatterPath } from "@plainva/core";
import i18n from "i18next";
import { toast } from "../services/toastStore";
import { errorText } from "./errorText";

/**
 * A change to the properties of the note an editor holds: its icon, its colour.
 *
 * Both shells make it on the editor's own text and hand the result back to the
 * editor, which saves it. Each of them caught a refusal — a block at the top
 * of the note that is no YAML map, YAML that cannot be read — and wrote it to
 * the console: picking an icon did nothing and said nothing (finding
 * 2026-10-09).
 *
 * Answers the text after the change, or null where there is nothing to hand
 * the editor: the change left the note as it is, or the note refuses it — and
 * then the one sentence for a property that did not reach its note says why.
 * Nothing wrong is on screen then: icon and colour are drawn from the text,
 * and the text did not change.
 */
export function editedNoteProperties(text: string, change: (text: string) => string): string | null {
  try {
    const next = change(text);
    return next === text ? null : next;
  } catch (e) {
    toast.error(i18n.t("mobile.propertyWriteFailed", { message: errorText(e) }));
    return null;
  }
}

/**
 * The note's text with its icon set or removed, and with it the icon's tint:
 * an emoji clears a stale tint, an icon from the set (`lucide:<name>`) keeps
 * its colour in `plainva.icon_color`. The one write both shells make — the
 * note's colour has had its own since 2026-09-19 (`withNoteColor`).
 */
export function withNoteIcon(content: string, icon: string | null, color: string | null): string {
  const next =
    icon === null
      ? deleteFrontmatterPath(content, [PLAINVA_NAMESPACE_KEY, "icon"])
      : setFrontmatterPath(content, [PLAINVA_NAMESPACE_KEY, "icon"], icon);
  return color === null
    ? deleteFrontmatterPath(next, [PLAINVA_NAMESPACE_KEY, "icon_color"])
    : setFrontmatterPath(next, [PLAINVA_NAMESPACE_KEY, "icon_color"], color);
}
