import { toast } from "../services/toastStore";
import type { AiSession } from "./aiSession";

type Translate = (key: string) => string;

/**
 * Starting a conversation from a surface (Befunde 06.11., B6, B8): a skill, a
 * new conversation, an action on a selection. Each one either starts and
 * shows where it runs (`show`: the segment, the window), or says why it
 * cannot start now — an answer is still under way. Before, a start during an
 * answer did nothing, and a start from another segment ran where nobody saw it.
 */
export function aiStartBlocked(session: AiSession, t: Translate): boolean {
  if (!session.startBlocked()) return false;
  toast.info(t("ai.startBusy"));
  return true;
}

/** A skill in a new conversation, shown where it runs. Returns whether it started. */
export function startAiSkill(session: AiSession, t: Translate, skill: { id: string; start: string }, show?: () => void): boolean {
  if (aiStartBlocked(session, t)) return false;
  show?.();
  void session.runSkill(skill.id, skill.start);
  return true;
}

/** A new, empty conversation, shown where it waits for its first message. Returns whether it began. */
export function startAiConversation(session: AiSession, t: Translate, show?: () => void): boolean {
  if (aiStartBlocked(session, t)) return false;
  session.newConversation();
  show?.();
  return true;
}
