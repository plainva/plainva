import { describe, expect, it } from "vitest";
import { chat, mcpSession, NOTES } from "./mcpSessionHarness";

/**
 * The setup's first "Hello" (plan Oberfläche O7, T9; review O7, O7): it sends the greeting alone — not the note that
 * is open, not a note a search would find, not a pin — also where the send overview for this recipient was approved
 * before. The conversation it begins is the user's own from the next message on.
 */
async function withOpenNote(script: Parameters<typeof mcpSession>[0]) {
  const session = await mcpSession(script);
  const host = session.vault.host;
  const open = { path: "Projects/Offer.md", title: "Offer", kind: "note" as const };
  host.situation = async () => ({ now: "2026-10-07 10:00", weekday: "Wednesday", calendarDay: "2026-10-07", journalDay: "2026-10-07", active: open, tabs: [], tasks: [], events: [], dailyNote: null });
  host.activeNote = async () => ({ path: open.path, title: open.title, text: NOTES[open.path]! }) as never;
  host.readNote = async (path: string) => (NOTES[path] !== undefined ? ({ path, title: path, text: NOTES[path]! } as never) : null);
  return session;
}

describe("the setup's first Hello", () => {
  it("an ordinary message takes the open note along — the greeting does not", async () => {
    const { s, fake } = await withOpenNote([chat({ text: "It is for Northwind." }), chat({ text: "Hello! How can I help?" }), chat({ text: "For Northwind." })]);
    expect(await s.send("Who is the offer for?")).toEqual({ kind: "answered" });
    expect(JSON.stringify(fake.sent[0]!.body)).toContain("Northwind");

    // The overview for this recipient was approved above; a new conversation begins with the greeting.
    s.newConversation();
    expect(await s.sendGreeting("Hello!")).toEqual({ kind: "answered" });
    const greeting = JSON.stringify(fake.sent[1]!.body);
    expect(greeting).toContain("Hello!");
    expect(greeting).not.toContain("Northwind");
    const run = s.getState().active!.runs[0]!;
    expect(run.sent).toEqual([]);
    expect(run.manifest?.sources ?? []).toEqual([]);
    expect(s.getState().active!.pins).toEqual([]);

    // From the next message on it is an ordinary conversation: the open note goes along again.
    expect(await s.send("And who is the offer for?")).toEqual({ kind: "answered" });
    expect(JSON.stringify(fake.sent[2]!.body)).toContain("Northwind");
  });
});
