import type { Conversation, Turn } from "./conversation.js";
import type { ContextBudget } from "./context/package.js";

/**
 * Platform models (plan KI-Harness P2c, ADR 0021 decision 5): the model the
 * operating system brings — Apple's on-device foundation model on the iPhone,
 * Gemini Nano through ML Kit on Android. No key, no download by Plainva,
 * nothing leaves the device. They answer through the same conversation as
 * every provider; what differs is their size: a context of about 4,000
 * tokens for the question, the notes and the answer together. This module
 * fits a request into that window.
 */

/** The window a platform model reports when it reports none: Apple's on-device model (TN3193). */
export const PLATFORM_CONTEXT_DEFAULT = 4_096;
/** An answer on the device: long enough for a paragraph with sources, short enough to leave room for the notes. */
export const PLATFORM_ANSWER_TOKENS = 700;
/** A small model below this window gets the smaller context package. */
const SMALL_WINDOW = 32_000;

const CJK = /[぀-ヿ㐀-䶿一-鿿가-힯豈-﫿]/g;

/**
 * Tokens of a text, estimated on the cautious side: a CJK character is about
 * one token, everything else about 3.2 characters per token. Over-counting
 * only leaves the window a little emptier; under-counting would overflow it.
 */
export function estimatePromptTokens(text: string): number {
  const cjk = text.match(CJK)?.length ?? 0;
  return Math.ceil(cjk + (text.length - cjk) / 3.2);
}

/**
 * The context package for a small window (plan P2c): fewer and shorter
 * sources, so the notes, the question and the answer fit together. Null for
 * a window large enough for the default package.
 */
export function contextBudgetFor(contextTokens: number | undefined): Partial<ContextBudget> | null {
  if (!contextTokens || contextTokens >= SMALL_WINDOW) return null;
  // What is left for the notes after the instructions, the situation and the answer, in characters (about 2.6 each across scripts).
  const room = Math.max(1_000, contextTokens - 1_600) * 2.6;
  const small = contextTokens < 8_192;
  return {
    evidence: 2,
    evidenceChars: Math.round(room * 0.7),
    activeChars: Math.round(room * 0.45),
    sectionChars: Math.round(room * 0.35),
    cards: small ? 2 : 4,
    map: small ? 4 : 8,
  };
}

/**
 * What a platform model reads where a picture stood (plan P4-5): these models
 * take text only, and a conversation that began with another provider may
 * carry one. Said plainly, so the model can say that it does not see it
 * instead of describing a picture it never got.
 */
export const PICTURE_NOT_VISIBLE = "[A picture stood here. This model cannot see pictures.]";

/** The words of a turn, without the context Plainva added to it. */
function wordsOf(turn: Turn): string {
  return turn.parts
    .map((part) => (part.type === "text" && !part.context ? part.text : part.type === "image" ? PICTURE_NOT_VISIBLE : ""))
    .filter(Boolean)
    .join("\n\n")
    .trim();
}

/** Everything a turn carries as text: the latest message goes whole, with its context. */
function textOf(turn: Turn): string {
  return turn.parts
    .map((part) => (part.type === "text" ? part.text : part.type === "image" ? PICTURE_NOT_VISIBLE : ""))
    .filter(Boolean)
    .join("\n\n")
    .trim();
}

/**
 * One request for a platform model: the instructions apart, the latest
 * message whole (its notes were chosen for this window), and as much of the
 * earlier conversation as still fits — the user's words and the answers, the
 * newest first, never the notes sent with them earlier. The model keeps no
 * conversation of its own between requests.
 */
export function platformPrompt(
  conversation: Conversation,
  window: { contextTokens: number; answerTokens: number },
): { instructions: string; prompt: string; dropped: number } {
  const instructions = conversation.system;
  const turns = conversation.turns;
  let last = turns.length - 1;
  while (last >= 0 && turns[last]!.role !== "user") last--;
  const latest = last >= 0 ? textOf(turns[last]!) : "";
  let room = window.contextTokens - window.answerTokens - estimatePromptTokens(instructions) - estimatePromptTokens(latest) - 64;
  const earlier: string[] = [];
  let dropped = 0;
  for (let i = last - 1; i >= 0; i--) {
    const turn = turns[i]!;
    const words = wordsOf(turn);
    if (!words) continue;
    const line = `${turn.role === "user" ? "User" : "Assistant"}: ${words}`;
    const cost = estimatePromptTokens(line) + 2;
    if (cost > room) {
      dropped = i + 1;
      break;
    }
    room -= cost;
    earlier.unshift(line);
  }
  const prompt = earlier.length ? `Earlier in this conversation:\n${earlier.join("\n\n")}\n\n---\n\n${latest}` : latest;
  return { instructions, prompt, dropped };
}
