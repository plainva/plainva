import {
  DEFAULT_AI_APP_SETTINGS,
  effectivePolicy,
  notePolicyFrom,
  readConversationRecord,
  type AiEgress,
  type ConversationRecord,
  type EgressChunk,
  type HttpRequestSpec,
  type LedgerEntry,
} from "@plainva/core/ai";
import { createComposerDraftStore } from "@plainva/ui";
import { AiSession, type AiVaultHost } from "@plainva/ui/ai";

/**
 * A session and a vault for the two classes of a failed request (plan Umsetzung 0.9.x, B7). The egress answers the way
 * the shells' native egress does: later, chunk by chunk, after the call returned to the event loop — never at once
 * inside `send`. The vault's AI data folder answers later too.
 */

/** An Anthropic-shaped answer: text only. */
export function answer(text: string): EgressChunk[] {
  const events: Array<[string, unknown]> = [
    ["message_start", { type: "message_start", message: { usage: { input_tokens: 50 } } }],
    ["content_block_start", { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } }],
    ["content_block_delta", { type: "content_block_delta", index: 0, delta: { type: "text_delta", text } }],
    ["content_block_stop", { type: "content_block_stop", index: 0 }],
    ["message_delta", { type: "message_delta", delta: { stop_reason: "end_turn" }, usage: { output_tokens: 7 } }],
    ["message_stop", { type: "message_stop" }],
  ];
  return [{ type: "open", status: 200 }, { type: "data", text: events.map(([e, d]) => `event: ${e}\ndata: ${JSON.stringify(d)}\n\n`).join("") }, { type: "done" }];
}

/** What the desktop's `ai_http` sends when no connection ever stood: one `failed` chunk with its code. */
export const unreachable: EgressChunk[] = [{ type: "failed", code: "unreachable", message: "error sending request: tcp connect error: Connection refused" }];
/** A connection that broke after it stood: the request may have arrived. */
export const brokeOff: EgressChunk[] = [{ type: "failed", code: "network", message: "error sending request: connection closed before message completed" }];

export const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

function fakeEgress(script: EgressChunk[][]) {
  const sent: HttpRequestSpec[] = [];
  const egress: AiEgress = {
    async send(_id, spec, onChunk) {
      sent.push(spec);
      const chunks = script.shift() ?? brokeOff;
      // As the native egress: the chunks arrive later, one by one.
      for (const chunk of chunks) {
        await tick();
        onChunk(chunk);
      }
    },
    async cancel() {},
    async setKey() {},
    async hasKey() {
      return true;
    },
    async deleteKey() {},
    async addEndpoint() {
      return true;
    },
    async removeEndpoint() {},
  };
  return { egress, sent };
}

/** The vault's AI data folder of a shell (`AiFileStore`), in memory: a file is replaced as one step. */
function memoryFiles() {
  const data = new Map<string, string>();
  return {
    data,
    async read(path: string) {
      await tick();
      return data.get(path) ?? null;
    },
    async write(path: string, text: string) {
      await tick();
      data.set(path, text);
    },
    async remove(path: string) {
      await tick();
      data.delete(path);
    },
  };
}

export function vaultHost() {
  const saved = new Map<string, ConversationRecord>();
  let ledger: LedgerEntry[] = [];
  const files = memoryFiles();
  const composerDrafts = createComposerDraftStore({ storage: files, file: "vault/composer-drafts.json" });
  const host: AiVaultHost = {
    composerDrafts,
    conversations: {
      async list() {
        return [...saved.values()].map((r) => ({ id: r.id, title: r.title, updatedAt: r.updatedAt, providerId: r.providerId, model: r.model }));
      },
      async load(id) {
        const r = saved.get(id);
        return r ? readConversationRecord(JSON.parse(JSON.stringify(r))) : null;
      },
      async save(record) {
        saved.set(record.id, JSON.parse(JSON.stringify(record)));
      },
      async remove(id) {
        saved.delete(id);
      },
      async removeAll() {
        saved.clear();
      },
    },
    ledger: {
      async load() {
        return ledger;
      },
      async save(entries) {
        ledger = [...entries];
      },
    },
    async activeNote() {
      return null;
    },
    async readNote() {
      return null;
    },
    async situation() {
      return { now: "2026-11-25 10:00", weekday: "Wednesday", calendarDay: "2026-11-25", journalDay: "2026-11-25", active: null, tabs: [], tasks: [], events: [], dailyNote: null };
    },
    async candidates() {
      return [];
    },
    policy: {
      async policyOf(path, text) {
        return effectivePolicy(path, notePolicyFrom(text?.includes("cloud: deny") ? { plainva: { ai: { cloud: "deny" } } } : {}), []);
      },
      async resolveLink() {
        return null;
      },
    },
    tools: () => null,
  };
  return { host, saved, ledger: () => ledger, files, composerDrafts };
}

export function session(script: EgressChunk[][]) {
  const fake = fakeEgress(script);
  let ids = 0;
  let stored: unknown = { ...DEFAULT_AI_APP_SETTINGS, enabled: true, profiles: { balanced: { providerId: "anthropic", model: "m-1" } } };
  const s = new AiSession({
    egress: fake.egress,
    async loadSettings() {
      return stored;
    },
    async saveSettings(settings) {
      stored = settings;
    },
    defaults: DEFAULT_AI_APP_SETTINGS,
    language: () => "English",
    today: () => "2026-11-25",
    now: () => new Date("2026-11-25T10:00:00Z"),
    newId: () => `id${++ids}`,
    label: (key) => key,
  });
  // Every send overview the session asks for, as it stood when it was answered: whom it names and why it asks.
  const consents: Array<{ providerId: string; providerLabel: string; model: string; local: boolean; growth: string[]; blind: boolean }> = [];
  s.subscribe(() => {
    const consent = s.getState().consent;
    if (!consent) return;
    const { manifest, growth } = consent;
    consents.push({ providerId: manifest.providerId, providerLabel: manifest.providerLabel, model: manifest.model, local: manifest.local, growth: growth.map((g) => g.kind), blind: consent.blind === true });
    s.answerConsent(true);
  });
  return { s, fake, consents };
}

/** Until the composer's draft store has done what it was given. */
export async function settled(): Promise<void> {
  for (let i = 0; i < 20; i++) await tick();
}

