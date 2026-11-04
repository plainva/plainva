import type { Conversation } from "./conversation.js";
import { imageTokens } from "./images.js";
import { estimatePromptTokens } from "./platform.js";
import { toolInputJsonSchema, type ToolManifest } from "./tools.js";

/**
 * The window of a model on this device, as its user stated it (plan
 * KI-Harness P7, ADR 0030). A server on the user's own computer cuts a
 * request that is longer than its window without a word — the model then
 * answers from a conversation whose beginning it never read, and nothing
 * says so. Where the window is known, a request that cannot fit is not sent,
 * and the reader is told what it would have taken.
 */

/** The room a request is held against a window with: the least a run asks an answer to have. */
export const WINDOW_ANSWER_ROOM = 256;
/**
 * What a context package leaves free in a small window beside the request
 * itself: the lines about the situation and an answer of a few paragraphs.
 */
export const WINDOW_BUDGET_ROOM = 1_000;
/** What a turn costs beside its text — its role, its frame — and a tool beside its words. */
const TURN_OVERHEAD = 4;
const TOOL_OVERHEAD = 12;

function jsonOf(value: unknown): string {
  try {
    return JSON.stringify(value) ?? "";
  } catch {
    return "";
  }
}

/**
 * The tokens a chat request of this conversation takes, estimated on the
 * cautious side like every count here: its instructions, every turn as it
 * is sent — words, calls with their arguments, results, pictures — and the
 * tools with their descriptions and schemas. Reasoning parts go to no chat
 * endpoint and count for nothing.
 */
export function estimateRequestTokens(conversation: Conversation, tools: readonly ToolManifest[]): number {
  let tokens = estimatePromptTokens(conversation.system) + TURN_OVERHEAD;
  for (const turn of conversation.turns) {
    tokens += TURN_OVERHEAD;
    for (const part of turn.parts) {
      if (part.type === "text") tokens += estimatePromptTokens(part.text);
      else if (part.type === "tool_call") tokens += estimatePromptTokens(part.name) + estimatePromptTokens(jsonOf(part.args)) + TURN_OVERHEAD;
      else if (part.type === "tool_result") tokens += estimatePromptTokens(part.content) + TURN_OVERHEAD;
      else if (part.type === "image") tokens += imageTokens(part.width, part.height);
    }
  }
  for (const tool of tools) tokens += estimatePromptTokens(tool.name) + estimatePromptTokens(tool.description) + estimatePromptTokens(jsonOf(toolInputJsonSchema(tool))) + TOOL_OVERHEAD;
  return tokens;
}

/** Whether a request fits a stated window with room for an answer; `needed` is what it would take. */
export function fitsWindow(conversation: Conversation, tools: readonly ToolManifest[], window: number): { fits: boolean; needed: number } {
  const needed = estimateRequestTokens(conversation, tools) + WINDOW_ANSWER_ROOM;
  return { fits: needed <= window, needed };
}
