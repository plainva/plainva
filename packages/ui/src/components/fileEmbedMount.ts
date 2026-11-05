import i18n from "../i18n";
import { formatByteSize } from "../base/computedFields";

/**
 * The card a file embed becomes (plan Rückmeldungen 05.11., P4; decision E2).
 *
 * `![[Mietvertrag.pdf]]` names a file Plainva does not draw itself — a PDF, an
 * archive, a spreadsheet, a video. It used to go down the note path, was read
 * as text and said "could not be read" about a file that was there. Now it is
 * a card with the file's name, size and folder and an "Open" that hands it to
 * the system — the same way a tap on `[[Mietvertrag.pdf]]` opens it. No viewer
 * inside the note: the system's viewer is better than one Plainva would embed.
 *
 * Plain DOM, like the sound player: one of the places an embed stands is a
 * CodeMirror widget with no React around it. `FileEmbedCard` wraps this for
 * the React surfaces, so the editor and the reading view of both shells draw
 * the same card.
 */

export interface FileEmbedCardOptions {
  /** Vault-relative path of the file. */
  path: string;
  /** Size in bytes, or null while it is unknown. */
  size: number | null;
  /** Opens the file — the shell's own open path, which hands it to the system. */
  onOpen: (path: string) => void;
}

/** What the card says, apart from the button: pure, for tests and both shells. */
export function fileEmbedCardModel(path: string, size: number | null): { name: string; badge: string; meta: string } {
  const parts = path.split("/");
  const name = parts.pop() ?? path;
  const folder = parts.length > 0 ? `${parts.join("/")}/` : "";
  const dot = name.lastIndexOf(".");
  const badge = dot > 0 ? name.slice(dot + 1).slice(0, 4).toUpperCase() : "";
  const meta = [size === null ? "" : formatByteSize(size), folder].filter(Boolean).join(" · ");
  return { name, badge, meta };
}

/** Builds the card inside `container`; returns a cleanup that removes it. */
export function mountFileEmbedCard(container: HTMLElement, options: FileEmbedCardOptions): () => void {
  const model = fileEmbedCardModel(options.path, options.size);
  const root = document.createElement("span");
  root.className = "pv-filecard";
  root.dataset.testid = "file-embed";
  root.dataset.path = options.path;

  const badge = document.createElement("span");
  badge.className = "pv-filecard-badge";
  badge.setAttribute("aria-hidden", "true");
  badge.textContent = model.badge;

  const text = document.createElement("span");
  text.className = "pv-filecard-text";
  const name = document.createElement("span");
  name.className = "pv-filecard-name";
  name.dir = "auto";
  name.textContent = model.name;
  text.appendChild(name);
  if (model.meta) {
    const meta = document.createElement("span");
    meta.className = "pv-filecard-meta";
    meta.textContent = model.meta;
    text.appendChild(meta);
  }

  const open = document.createElement("button");
  open.type = "button";
  open.className = "pv-btn pv-btn--ghost pv-btn--sm pv-filecard-open";
  open.dataset.testid = "file-embed-open";
  open.textContent = i18n.t("noteEmbed.openFile");
  open.setAttribute("aria-label", i18n.t("noteEmbed.openFileNamed", { name: model.name }));
  open.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    options.onOpen(options.path);
  });

  root.append(badge, text, open);
  container.appendChild(root);
  return () => root.remove();
}
