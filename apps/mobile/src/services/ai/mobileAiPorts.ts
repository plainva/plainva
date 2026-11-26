import { useEffect, useSyncExternalStore } from "react";
import { useAiOn, type AreaOrder } from "@plainva/ui";
import type { MobileAiNavigation as AiNavigation } from "./mobileAi";
import { mobileAiLoader, useMobileAiSession } from "./mobileAiLoader";
import { openLink } from "../openLink";
import type { MobileVault } from "../vaultService";

/*
 * What the phone's shell and its screens know of the AI without loading it (performance plan L5): the note the AI
 * sheet stands over, the events that open the sheet and the note picker, the review a settings page asks for, the
 * navigation the AI is handed, and whether the switch is on. The AI itself (`mobileAi.ts`) loads with its session and
 * reads the same state from here.
 */

/** The note the KI sheet was opened over — the context chip and the host's active note. */
let sheetNote: string | null = null;
/** The event that opens the KI sheet; the AI's host listens for it. */
export const AI_SHEET_EVENT = "plainva-ai-sheet";

export function aiSheetNote(): string | null {
  return sheetNote;
}

export function setAiSheetNote(path: string | null): void {
  sheetNote = path;
}

/** Makes a note the AI's open note without opening the sheet (the AI segment of the note's context). */
export function focusAiNote(path: string | null): void {
  sheetNote = path;
}

/**
 * A review the vault's AI settings ask for on the way into the workshop (plan
 * KI-Harness P3-5): taken once by the AI screen's skills segment.
 */
let pendingSkillReview: string | null = null;

export function requestSkillReview(id: string | null): void {
  pendingSkillReview = id;
}

export function takeSkillReview(): string | null {
  const id = pendingSkillReview;
  pendingSkillReview = null;
  return id;
}

/**
 * What a note is picked for when the AI asks for one (plan KI-Harness P9-3): to pin it to the conversation, or as an
 * example of the writing style. The phone's form of the desktop's quick switcher: one sheet, opened by an event from
 * wherever a conversation or the memory shows, rendered once in the AI shell.
 */
export type AiNotePick = "pin" | "style";
/** The event that opens the note picker; the AI's host listens for it. */
export const AI_PICK_EVENT = "plainva-ai-pick";

export function openAiNotePick(purpose: AiNotePick): void {
  window.dispatchEvent(new CustomEvent(AI_PICK_EVENT, { detail: { purpose } }));
}

/** Opens the KI sheet over a note (the note's ⋮ menu, the palette). */
export function openAiSheet(path: string | null): void {
  sheetNote = path;
  window.dispatchEvent(new CustomEvent(AI_SHEET_EVENT, { detail: { path } }));
}

/** The areas without the KI screen while the switch is off: no entry leads to a surface that is off. */
export function withoutAiArea(order: AreaOrder, enabled: boolean): AreaOrder {
  const index = order.order.indexOf("ai");
  if (enabled || index < 0) return order;
  return { order: order.order.filter((id) => id !== "ai"), visibleCount: index < order.visibleCount ? order.visibleCount - 1 : order.visibleCount };
}

/** True while the per-device switch is on: entries that lead to the AI exist only then. Off while the AI is not loaded. */
export function aiEnabled(): boolean {
  const state = mobileAiLoader.session()?.getState();
  return Boolean(state?.loaded && state.settings.enabled);
}

/**
 * Hands the shell's navigation to the AI: rendered below App's vault gate,
 * where `openNote` exists, and kept current after every render.
 */
export function MobileAiNavigation({ navRef, nav }: { navRef: { current: AiNavigation }; nav: AiNavigation }) {
  useEffect(() => {
    navRef.current = nav;
    latestNav = nav;
  });
  return null;
}

/** The shell's navigation as last rendered, for surfaces outside App (the note's context). */
let latestNav: AiNavigation | null = null;

/** Opens the skills and the memory from any surface (F71 of release 0.9.0). */
export function openAiSkills(): void {
  latestNav?.openSkills?.();
}

/** Opens the AI settings screen from any surface. */
export function openAiSettings(): void {
  latestNav?.openSettings?.();
}

/** True while the AI is switched on, re-rendering when that changes; off while the AI is not loaded. */
export function useMobileAiEnabled(): boolean {
  return useAiOn(useMobileAiSession());
}

/**
 * A link in an answer opens as every link of the app does (`planLinkOpen` through `openLink`), by the way it is
 * written — the same function the source check under the answer asks (review O7, fifth round). A missing note is
 * not created: the answer is not the user's own text.
 */
export function openAiNoteTarget(vault: MobileVault, target: string, openNote: (path: string) => void, kind?: "wiki" | "markdown"): void {
  void openLink({ text: target, kind: kind ?? "wiki" }, { vault, onOpenNote: openNote, createMissing: false });
}

/**
 * What waits for the user's decision in the AI (plan KI-Oberflächen K11): the number and the dot the bar's and the
 * areas' AI entry carry. The AI's host counts them and leaves them here; nothing waits while the AI is not loaded.
 */
export interface AiBadge {
  waiting: number;
  attention: boolean;
}
const NO_BADGE: AiBadge = { waiting: 0, attention: false };
let badge: AiBadge = NO_BADGE;
const badgeListeners = new Set<() => void>();

export function setAiBadge(next: AiBadge): void {
  if (next.waiting === badge.waiting && next.attention === badge.attention) return;
  badge = next.waiting === 0 && !next.attention ? NO_BADGE : next;
  for (const listener of badgeListeners) listener();
}

const subscribeBadge = (listener: () => void) => {
  badgeListeners.add(listener);
  return () => {
    badgeListeners.delete(listener);
  };
};
const currentBadge = () => badge;

export function useAiBadge(): AiBadge {
  return useSyncExternalStore(subscribeBadge, currentBadge, currentBadge);
}
