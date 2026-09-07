/**
 * The aux bridge — what an auxiliary window answers when a shared component
 * asks for something the central window's shell would do (finding 2026-09-07).
 *
 * The content an auxiliary window renders (editor, reader, database, the
 * views) is the SAME code the central window renders, and that code talks to
 * its shell through `plainva-*` DOM events: "show the version history",
 * "reveal this in the tree", "create the note behind this link". In the
 * central window `AppShell` listens; in an auxiliary window there is no
 * `AppShell` — and until this table existed, nothing listened at all. The
 * ⋮-menu entries were there, clickable, and did nothing (maintainer finding
 * 2026-09-07: version history and "reveal in tree" in a popped-out note).
 *
 * This table is the contract, in one place: every event a shared component
 * dispatches is either bridged here (with the answer the auxiliary window
 * gives) or listed as window-local with the reason. `auxBridge.test.ts` scans
 * the component sources and fails on an event that is in neither list, so the
 * rule from multi-window P0 — whoever adds a `plainva-*` event decides in the
 * same commit what a second window does with it — finally has a guard.
 * `useAuxBridge.test.tsx` then proves each bridged event actually has a
 * handler behind it.
 */

/**
 * How the auxiliary window answers.
 *
 * - `local`: the window does it itself, with the same component the central
 *   window uses (a modal belongs to the window that opened it).
 * - `owner`: a request to the central window, which owns that surface.
 * - `window-with-tree`: routed to whichever window shows this vault WITH a
 *   file tree — the central window or a full second window.
 */
export type AuxBridgeAnswer = "local" | "owner" | "window-with-tree";

export interface AuxBridgeEntry {
  answer: AuxBridgeAnswer;
  /** Why this answer, in one sentence — the table is read more than the code. */
  why: string;
}

/** Events a shared component dispatches that the auxiliary window must answer. */
export const AUX_BRIDGED_EVENTS: Readonly<Record<string, AuxBridgeEntry>> = {
  "plainva-show-version-history": {
    answer: "local",
    why: "The comparison modal runs in client mode already (the full second window proves it): versions are read through the vault adapter, a restore writes over the bus. The note is open in THIS window (dedup), so the flush handshake is local too.",
  },
  "plainva-resolve-conflict": {
    answer: "local",
    why: "Same modal as the version history, entered from the editor's conflict banner; the three exits write through the client adapter.",
  },
  "plainva-reveal-folder": {
    answer: "window-with-tree",
    why: "An auxiliary window has no tree by design; the request goes to the window that shows this vault with one, and that window comes forward with the file selected.",
  },
  "plainva-create-note-from-link": {
    answer: "local",
    why: "The note is written through the client adapter (the owner indexes the bus write) and opened here, where the link was clicked — the same rules as in the central window (ask-first setting, note type).",
  },
  "plainva-compose-mail": {
    answer: "local",
    why: "The floating composer is hosted here like in the central window; sending and drafts already travel the bus (mail-send / mail-draft), and its pop-out button asks the owner for an OS window.",
  },
  "plainva-open-template-picker": {
    answer: "local",
    why: "The picker only reads templates through the vault adapter and hands the text to the active editor of this window.",
  },
  "plainva-reveal-properties": {
    answer: "local",
    why: "The properties section lives in this window's context sidebar; the shell only has to unfold the sidebar, the section expands itself.",
  },
  "plainva-encryption-locked": {
    answer: "owner",
    why: "The unlock prompt lives with the master key in the central window (EncryptionUnlockHost renders nothing without a backup adapter); the locked remarks column asks for it with `force`, and the owner's own host answers exactly as for a click there (N3).",
  },
  "plainva-open-sync-settings": {
    answer: "owner",
    why: "Settings bind credentials and start services, so they exist in exactly one window (owner-surface 'settings'); the mail and calendar sign-in cards dispatch this from any window.",
  },
};

/**
 * Events a shared component dispatches whose receiver is inside the SAME
 * component tree — sender and listener both live in the auxiliary window.
 * Listed with the reason so the guard does not grow a silent allowlist.
 */
export const WINDOW_LOCAL_EVENTS: Readonly<Record<string, string>> = {
  "plainva-note-saved": "Editor and base views tell the other panes of this window; the owner bridges it onto the bus itself (ownerBus.installOwnerEventBridge).",
  "plainva-external-update": "The editor tells itself that the file changed on disk; the aux editor gets it from the file-changed broadcast.",
  "plainva-pending-save-flushed": "The editor answers a flush request from a service in this window.",
  "plainva-file-restored": "The comparison modal hands the restored text to the editor of this window.",
  "plainva-open-in-new-window": "Gated on isOwnerWindow(): the entry is not rendered in an auxiliary window.",
  "plainva-insert-text": "The template picker hands its text to the editor of this window.",
};
