/**
 * The conversation model (ADR 0018, §9.8 of the plan): append-only.
 *
 * A conversation is a list of immutable turns. Nothing that was sent is ever
 * rewritten: providers cache by prefix, and some reject an edited history
 * outright (the Anthropic Messages API answers HTTP 400 when a turn with
 * thinking blocks comes back changed). Context maintenance — compaction, cache
 * breakpoints — happens by APPENDING, never by editing. The tool list is fixed
 * when the conversation starts, so the prefix stays stable.
 *
 * Switching provider keeps the turns; the new provider gets a fresh transcript
 * built from them. Reasoning parts are opaque per provider and only go back to
 * the provider that produced them.
 */

export interface TextPart {
  type: "text";
  text: string;
  /**
   * Set on the part that carries the context of a user message: one stamp
   * per note sent (`path#hash`). The request codecs send only `text`; the
   * stamps let the UI tell context from the user's words and let the next
   * message resend a note only when it changed.
   */
  context?: readonly string[];
}

export interface ToolCallPart {
  type: "tool_call";
  /** The provider's call id; tool results answer it. */
  id: string;
  name: string;
  args: unknown;
  /** Provider-specific data that must come back unchanged (Gemini thought signatures). */
  providerData?: { provider: string; data: unknown };
}

export interface ToolResultPart {
  type: "tool_result";
  callId: string;
  /** The name of the call this answers, as the provider made it. */
  name: string;
  /** Already rendered for the model: tier 3 content arrives fenced. */
  content: string;
  isError?: boolean;
  /** The tool that ran, where the call went through the dispatcher (`call_tool`) and names another. Never sent. */
  tool?: string;
}

/** Opaque reasoning (thinking blocks, encrypted reasoning items). */
export interface ReasoningPart {
  type: "reasoning";
  provider: string;
  data: unknown;
}

/** The two encodings a picture is ever sent in: every provider with an image route takes both. */
export type ImageMediaType = "image/jpeg" | "image/png";

/**
 * A picture in a user turn (plan KI-Harness P4-5). `data` is the picture as
 * it is sent — scaled down and encoded anew, so nothing of the file but its
 * pixels goes along: no EXIF, no place, no camera. It stays in the record
 * like every part that was sent: the next request of the conversation carries
 * it again, and the reader can see what went.
 *
 * A request codec sends `mime` and `data` and nothing else. Only user turns
 * carry pictures; a model's answer never does.
 */
export interface ImagePart {
  type: "image";
  mime: ImageMediaType;
  /** Base64, without a `data:` prefix. */
  data: string;
  /** For the reader of the conversation. Never sent. */
  name: string;
  /** The size of what is sent, in pixels. */
  width: number;
  height: number;
  /** Where it came from in the vault. Never sent as part of the picture. */
  path?: string;
}

export type Part = TextPart | ToolCallPart | ToolResultPart | ReasoningPart | ImagePart;

export interface Turn {
  role: "user" | "assistant";
  parts: readonly Part[];
  /** Who produced an assistant turn — needed to route reasoning back. */
  provider?: string;
  model?: string;
  at: string;
}

export interface Conversation {
  id: string;
  system: string;
  /** Tool names, fixed for the whole conversation. */
  tools: readonly string[];
  /**
   * Further tools the conversation can reach through `call_tool`, fixed like
   * `tools`. They are never part of a request's tool list — the prefix a
   * provider caches stays the same whatever is found later (ADR 0018).
   */
  more?: readonly string[];
  turns: readonly Turn[];
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const inner of Object.values(value as Record<string, unknown>)) deepFreeze(inner);
  }
  return value;
}

export function startConversation(id: string, system: string, tools: readonly string[], more: readonly string[] = []): Conversation {
  return deepFreeze({ id, system, tools: [...tools], ...(more.length ? { more: [...more] } : {}), turns: [] });
}

/**
 * Returns the conversation with one more turn. The existing turns are the
 * same frozen objects — nothing that was sent can change afterwards.
 */
export function appendTurn(conversation: Conversation, turn: Turn): Conversation {
  if (turn.parts.length === 0) throw new Error("a turn needs at least one part");
  const last = conversation.turns[conversation.turns.length - 1];
  if (last && last.role === turn.role && turn.role === "assistant") {
    throw new Error("two assistant turns in a row: append the tool results as a user turn first");
  }
  return deepFreeze({ ...conversation, turns: [...conversation.turns, structuredClone(turn)] });
}

/** Tool calls of the last assistant turn that no user turn has answered yet. */
export function openToolCalls(conversation: Conversation): ToolCallPart[] {
  const last = conversation.turns[conversation.turns.length - 1];
  if (!last || last.role !== "assistant") return [];
  return last.parts.filter((p): p is ToolCallPart => p.type === "tool_call");
}

/**
 * A conversation as a model that takes no tools reads it (plan KI-Harness
 * P7, ADR 0030): its words and its pictures. What was called earlier and
 * what came back stay in the record and are not sent again — a request
 * cannot name tools to a model that calls none, and a result without its
 * call is a message no chat endpoint takes. The system's own model reads a
 * conversation the same way (`platformPrompt`).
 *
 * Two turns of one role that a call stood between become one message: a
 * chat template wants the roles to alternate. A conversation that was begun
 * without tools and holds nothing but words is returned as it is.
 */
export function withoutTools(conversation: Conversation): Conversation {
  const said = (part: Part): boolean => part.type === "text" || part.type === "image";
  if (!conversation.tools.length && !conversation.more?.length && conversation.turns.every((turn) => turn.parts.every(said))) return conversation;
  const turns: Turn[] = [];
  for (const turn of conversation.turns) {
    const parts = turn.parts.filter(said);
    if (!parts.length) continue;
    const before = turns[turns.length - 1];
    if (before && before.role === turn.role) turns[turns.length - 1] = { ...before, parts: [...before.parts, ...parts] };
    else turns.push(parts.length === turn.parts.length ? turn : { ...turn, parts });
  }
  return { id: conversation.id, system: conversation.system, tools: [], turns };
}
